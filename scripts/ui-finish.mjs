import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDebugRankProfile } from '../src/rank.js';

const out = 'qa-output';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await context.addInitScript((profile) => localStorage.setItem('haiyangqi.rank.v1', JSON.stringify(profile)), createDebugRankProfile(20));
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let failure;
let captures = 0;
let turns = 0;
try {
  await page.goto('http://127.0.0.1:8765/');
  await page.locator('#home-start').tap();
  await page.locator('#home-screen').waitFor({ state: 'hidden' });
  for (; turns < 600 && !(await page.locator('#result-overlay').isVisible()); turns++) {
    const before = +(await page.locator('#move-count').textContent());
    const action = await page.evaluate(() => {
      const faction = document.querySelector('#player-faction').dataset.faction;
      const tiles = [...document.querySelectorAll('#board button')].map((t) => ({ index: +t.dataset.index, hidden: t.classList.contains('hidden'), empty: t.classList.contains('empty'), own: t.classList.contains('faction-' + faction), rank: +t.querySelector('.piece-rank')?.textContent }));
      const hidden = tiles.find((t) => t.hidden);
      if (hidden) return { type: 'flip', to: hidden.index };
      const moves = [];
      for (const tile of tiles.filter((t) => t.own)) {
        for (const target of tiles) {
          const dx = Math.abs(tile.index % 10 - target.index % 10);
          const dy = Math.abs(Math.floor(tile.index / 10) - Math.floor(target.index / 10));
          if (dx + dy !== 1) continue;
          if (target.empty) moves.push({ type: 'move', from: tile.index, to: target.index });
          else if (!target.own && !target.hidden && ((tile.rank === 1 && target.rank === 8) || (tile.rank >= target.rank && !(tile.rank === 8 && target.rank === 1)))) return { type: 'capture', from: tile.index, to: target.index };
        }
      }
      return moves.length ? moves[Math.floor(Math.random() * moves.length)] : null;
    });
    assert(action, 'a visible legal action exists before match ends');
    if (action.from !== undefined) await page.locator(`#board button[data-index="${action.from}"]`).tap();
    await page.locator(`#board button[data-index="${action.to}"]`).tap();
    if (action.type === 'capture') {
      captures++;
      if (captures === 1) {
        await page.waitForTimeout(200);
        await page.screenshot({ path: `${out}/capture-mobile.png` });
      }
    }
    await page.waitForFunction((before) => document.querySelector('#result-overlay').classList.contains('show') || (+document.querySelector('#move-count').textContent >= before + 2 && document.querySelector('#turn-badge').dataset.turn === 'human'), before, { timeout: 15000 });
    if (turns % 20 === 0) console.log('real match', turns, 'human actions,', captures, 'human captures');
  }
  assert(await page.locator('#result-overlay').isVisible(), 'a real played match reaches settlement');
  assert(captures > 0, 'real capture input exercised the resized board');
  await page.screenshot({ path: `${out}/result-mobile.png` });
  const title = await page.locator('#result-title').textContent();
  await page.locator('#result-restart').tap();
  assert.equal(await page.locator('#move-count').textContent(), '0');
  assert.equal(await page.locator('#board .hidden').count(), 60);
  assert(!(await page.locator('#result-overlay').isVisible()));
  await page.locator('#home-return').tap();
  assert(await page.locator('#home-screen').isVisible());
  await page.locator('#home-start').tap();
  await page.locator('#home-screen').waitFor({ state: 'hidden' });
  await page.locator('#board button[data-index="59"]').tap();
  await page.waitForFunction(() => +document.querySelector('#move-count').textContent >= 2);
  assert.deepEqual(errors, []);
  await writeFile(`${out}/finish-report.json`, JSON.stringify({ title, turns, captures, errors, settlement: true, restart: true, resume: true }, null, 2));
} catch (error) {
  failure = String(error.stack || error);
  await page.screenshot({ path: `${out}/finish-failure.png`, fullPage: true });
  await writeFile(`${out}/finish-report.json`, JSON.stringify({ failure, turns, captures, errors }, null, 2));
  console.error(failure);
} finally { await browser.close(); }
if (failure) process.exitCode = 1;
