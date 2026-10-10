import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const out = 'qa-output';
await mkdir(out, { recursive: true });
const target = process.env.OCEAN_QA_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch();
const reports = [];
let currentPage;
let failure;
try {
  // Force the platform animation promise to remain pending. Real capture input
  // must still advance both turns and release the board.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await context.newPage(); currentPage = page;
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const result = animate.apply(this, args);
      if (this.classList.contains('capture-spirit')) {
        Object.defineProperty(result, 'finished', { value: new Promise(() => {}) });
      }
      return result;
    };
  });
  await page.goto(target);
  await page.locator('#home-start').tap();
  let capture = false;
  for (let turn = 0; turn < 100 && !capture; turn++) {
    const before = +(await page.locator('#move-count').textContent());
    const action = await page.evaluate(() => {
      const faction = document.querySelector('#player-faction').dataset.faction;
      const tiles = [...document.querySelectorAll('#board button')].map(t => ({ index: +t.dataset.index, hidden: t.classList.contains('hidden'), own: t.classList.contains('faction-' + faction), rank: +t.querySelector('.piece-rank')?.textContent }));
      for (const a of tiles.filter(t => t.own)) {
        for (const b of tiles.filter(t => !t.own && !t.hidden && t.rank)) {
          const adjacent = Math.abs(a.index % 10 - b.index % 10) + Math.abs(Math.floor(a.index / 10) - Math.floor(b.index / 10)) === 1;
          if (adjacent && ((a.rank === 1 && b.rank === 8) || (a.rank >= b.rank && !(a.rank === 8 && b.rank === 1)))) return { from: a.index, to: b.index };
        }
      }
      return { to: tiles.find(t => t.hidden)?.index };
    });
    assert.notEqual(action.to, undefined);
    if (action.from !== undefined) await page.locator(`#board button[data-index="${action.from}"]`).tap();
    const started = Date.now();
    await page.locator(`#board button[data-index="${action.to}"]`).tap();
    if (action.from !== undefined) {
      capture = true;
      await page.waitForFunction(() => document.querySelector('#board').classList.contains('is-resolving-capture'));
      await page.screenshot({ path: `${out}/capture-timeout-mobile.png` });
    }
    await page.waitForFunction(before => +document.querySelector('#move-count').textContent >= before + 2 && document.querySelector('#turn-badge').dataset.turn === 'human', before, { timeout: 8000 });
    if (capture) {
      assert(Date.now() - started < 8000);
      assert.equal(await page.locator('.capture-spirit').count(), 0);
      assert.equal(await page.locator('#board.is-resolving-capture').count(), 0);
      await page.waitForTimeout(700);
      assert.equal(await page.locator('.capture-fx-layer > *').count(), 0);
      await page.locator('#home-return').tap();
      assert(await page.locator('#home-screen').isVisible());
      await page.locator('#home-start').tap();
      assert.equal(+(await page.locator('#move-count').textContent()), before + 2);
      reports.push({ case: 'unresolved animation finished promise', realCapture: true, recovered: true, errors });
    }
  }
  assert(capture);
  assert.deepEqual(errors, []);
  await context.close();

  const highContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const high = await highContext.newPage(); currentPage = high;
  const highErrors = [];
  high.on('pageerror', e => highErrors.push(e.message));
  high.on('console', m => { if (m.type() === 'error') highErrors.push(m.text()); });
  // Hold delivery briefly so pause/restart reliably overlaps pending rank20 work.
  // The real worker still runs the production decision function.
  await high.addInitScript(() => {
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      postMessage(data) {
        window.__qaWorkerRank = data.rankId;
        setTimeout(() => super.postMessage(data), 1800);
      }
    };
  });
  const highUrl = new URL(target); highUrl.searchParams.set('debug', '1'); highUrl.searchParams.set('rank', '20');
  await high.goto(highUrl.href);
  await high.locator('#home-start').tap();
  await high.locator('#board button[data-index="0"]').tap();
  await high.waitForFunction(() => window.__qaWorkerRank === 20);
  const started = Date.now();
  await high.locator('#home-return').tap();
  assert(Date.now() - started < 1000);
  assert(await high.locator('#home-screen').isVisible());
  await high.waitForTimeout(2200);
  assert.equal(await high.locator('#move-count').textContent(), '1');
  await high.locator('#home-start').tap();
  await high.waitForFunction(() => +document.querySelector('#move-count').textContent === 2 && document.querySelector('#turn-badge').dataset.turn === 'human');
  const hidden = high.locator('#board .hidden').first();
  await high.evaluate(() => { window.__qaWorkerRank = 0; });
  await hidden.tap();
  await high.waitForFunction(() => window.__qaWorkerRank === 20);
  await high.locator('#restart-button').tap();
  await high.waitForTimeout(2300);
  assert.equal(await high.locator('#move-count').textContent(), '0');
  assert.equal(await high.locator('#board .hidden').count(), 60);
  await high.locator('#board button[data-index="59"]').tap();
  await high.waitForFunction(() => +document.querySelector('#move-count').textContent === 2 && document.querySelector('#turn-badge').dataset.turn === 'human');
  await high.screenshot({ path: `${out}/rank20-resume-mobile.png` });
  reports.push({ case: 'rank20 real input during pending work', pause: true, resume: true, restart: true, noStaleMove: true });

  // Isolated dense-board search measures the real highest-rank computation.
  // No game state is injected and no artificial win replaces a played match.
  const benchmark = await high.evaluate(async () => {
    const { createAiClient } = await import('./src/aiClient.js');
    const { createInitialState, getLegalActions } = await import('./src/game.js');
    const state = createInitialState(() => .42);
    state.board.forEach(p => { p.revealed = true; });
    state.humanFaction = 'coral'; state.aiFaction = 'abyss'; state.turn = 'ai';
    const client = createAiClient();
    const frames = [];
    let running = true;
    let last;
    const tick = time => { if (!running) return; if (last) frames.push(time - last); last = time; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const start = performance.now();
    const action = await client.choose(state, 20);
    const elapsed = performance.now() - start;
    running = false;
    frames.sort((a, b) => a - b);
    return { elapsed, samples: frames.length, p95: frames[Math.floor(frames.length * .95)] || 0, legal: getLegalActions(state, 'ai').some(a => JSON.stringify(a) === JSON.stringify(action)), action };
  });
  assert(benchmark.legal);
  assert(benchmark.samples > 30);
  assert(benchmark.p95 <= 50, `rank20 search UI rAF p95 ${benchmark.p95}`);
  assert.deepEqual(highErrors, []);
  reports.push({ case: 'dense highest-rank worker benchmark', ...benchmark, errors: highErrors });
  await highContext.close();
} catch (error) {
  failure = String(error.stack || error);
  console.error(failure);
  await currentPage?.screenshot({ path: `${out}/lifecycle-failure.png` });
} finally {
  await writeFile(`${out}/lifecycle-report.json`, JSON.stringify({ target, reports, failure: failure || null }, null, 2));
  await browser.close();
}
console.log('lifecycle', JSON.stringify(reports));
if (failure) process.exitCode = 1;
