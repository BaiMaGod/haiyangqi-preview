import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const target = process.env.GAME_URL || 'http://127.0.0.1:8765/';
const out = process.env.QA_OUT || 'qa-output';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const profiles = [
  ['desktop', 1455, 907, 1, false], ['laptop', 1280, 720, 1, false],
  ['mobile', 390, 844, 2, true], ['narrow', 360, 640, 2, true], ['landscape', 844, 390, 2, true],
];
const reports = [];
let failure;
let currentPage;
try {
  for (const [name, width, height, dpr, touch] of profiles) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce' });
    const page = await context.newPage();
    currentPage = page;
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('requestfailed', (r) => errors.push(r.url() + ': ' + r.failure()?.errorText));
    page.on('response', (r) => { if (r.status() >= 400) errors.push(r.url() + ': ' + r.status()); });
    const report = { name, viewport: { width, height }, dpr, errors, checks: [] };
    reports.push(report);
    const activate = async (selector) => touch ? page.locator(selector).tap() : page.locator(selector).click();
    await page.goto(target + '?debug=1&rank=20');
    await page.locator('#board button').last().waitFor({state: 'attached'});
    await page.evaluate(() => Promise.all([...document.images].map((im) => im.decode().catch(() => {}))));
    await page.screenshot({ path: `${out}/home-${name}.png` });
    const profile = await page.evaluate(() => {
      const box = document.querySelector('#home-profile').getBoundingClientRect();
      const rect = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x - box.x, y: r.y - box.y, right: r.right - box.x, bottom: r.bottom - box.y, width: r.width, height: r.height }; };
      return { w: box.width, h: box.height, nick: rect('.home-player-name'), rank: rect('.home-player-rank-line'), track: rect('#home-rank-track') };
    });
    assert(profile.nick.x >= profile.w * .39);
    assert(profile.rank.x >= profile.w * .45);
    assert(profile.nick.bottom < profile.rank.y);
    assert(profile.rank.bottom <= profile.track.y + 1);
    assert(profile.rank.right < profile.w);
    report.profile = profile;
    report.checks.push('profile nickname/rank/badge separation');
    await activate('#home-profile');
    assert(await page.locator('#rank-dialog').isVisible());
    await activate('#close-rank');
    await activate('#home-start');
    await page.locator('#home-screen').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#board button').count(), 60);
    await page.screenshot({ path: `${out}/game-${name}.png`, fullPage: true });
    const geometry = await page.evaluate(() => {
      const board = document.querySelector('#board').getBoundingClientRect();
      const tiles = [...document.querySelectorAll('#board button')].map((t) => { const r = t.getBoundingClientRect(); return { index: +t.dataset.index, x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; });
      return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, board: board.toJSON(), tiles, broken: [...document.images].filter((im) => !im.complete || !im.naturalWidth).map((im) => im.src) };
    });
    assert(geometry.scrollWidth <= width + 1);
    assert.equal(geometry.broken.length, 0);
    for (const t of geometry.tiles) {
      assert(t.x >= geometry.board.x - 1 && t.right <= geometry.board.right + 1);
      assert(t.y >= geometry.board.y - 1 && t.bottom <= geometry.board.bottom + 1);
      for (const offset of [1, 10]) {
        const other = geometry.tiles[t.index + offset];
        if (!other || (offset === 1 && t.index % 10 === 9)) continue;
        assert(Math.abs(t.x - other.x) < 1 || Math.abs(t.y - other.y) < 1, 'visual neighbors preserve logical adjacency');
      }
    }
    report.geometry = geometry;
    report.checks.push('60 tiles, no overflow or missing images, preserved adjacency');
    await activate('#board button[data-index="0"]');
    await page.waitForFunction(() => +document.querySelector('#move-count').textContent >= 2);
    assert.notEqual(await page.locator('#player-faction').textContent(), '等待首翻');
    assert.equal(await page.locator('#turn-badge').getAttribute('data-turn'), 'human');
    report.checks.push('real first flip and AI response');
    await page.screenshot({ path: `${out}/playing-${name}.png`, fullPage: true });
    const moveCount = await page.locator('#move-count').textContent();
    await activate('#home-return');
    assert(await page.locator('#home-screen').isVisible());
    await activate('#home-start');
    await page.locator('#home-screen').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#move-count').textContent(), moveCount);
    report.checks.push('home pause and resume retain match');
    await activate('#rules-button');
    assert(await page.locator('#rules-dialog').isVisible());
    await page.screenshot({ path: `${out}/rules-${name}.png` });
    await activate('#close-rules');
    await activate('#rank-button');
    assert(await page.locator('#rank-dialog').isVisible());
    await activate('#close-rank');
    for (let i = 0; i < 3; i++) {
      await activate('#restart-button');
      assert.equal(await page.locator('#move-count').textContent(), '0');
      assert.equal(await page.locator('#board .hidden').count(), 60);
    }
    report.checks.push('rules/rank dialogs and three clean restarts');
    const frames = await page.evaluate(() => new Promise((resolve) => {
      const deltas = []; let prev; const tick = (time) => { if (prev) deltas.push(time - prev); prev = time; if (deltas.length === 120) resolve(deltas); else requestAnimationFrame(tick); }; requestAnimationFrame(tick);
    }));
    frames.sort((a, b) => a - b);
    report.rafP95 = frames[Math.floor(frames.length * .95)];
    assert(report.rafP95 <= 50);
    report.checks.push('rAF p95 <= 50 ms');
    if (name === 'mobile') {
      await page.setViewportSize({ width: 844, height: 390 });
      assert.equal(await page.locator('#board button').count(), 60);
      await page.screenshot({ path: `${out}/rotation-landscape.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await activate('#board button[data-index="59"]');
      await page.waitForFunction(() => +document.querySelector('#move-count').textContent >= 2);
      report.checks.push('portrait/landscape rotation, last tile real tap');
    }
    assert.deepEqual(errors, []);
    console.log(name, 'PASS', report.checks.length, 'checks');
    await context.close();
  }
} catch (error) { failure = String(error.stack || error); console.error(failure); await currentPage?.screenshot({path: `${out}/failure.png`, fullPage: true}); }
finally {
  await writeFile(`${out}/report.json`, JSON.stringify({ target, reports, failure: failure || null }, null, 2));
  await browser.close();
}
if (failure) process.exitCode = 1;
