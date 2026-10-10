const CAPTURE_TIMING = Object.freeze({
  manifest: 120,
  defenderManifestDelay: 55,
  defenderManifest: 95,
  anticipation: 45,
  lunge: 150,
  hitStop: 50,
  devour: 120,
  swallow: 85,
  return: 140,
});

const BUBBLE_VECTORS = [
  [-22, -18, 7],
  [18, -24, 5],
  [-30, 8, 4],
  [27, 10, 6],
  [-11, 25, 5],
  [9, 30, 4],
  [34, -8, 3],
  [-36, -5, 3],
];

let captureLayer = null;
const activeRuns = new Set();
const activeAnimations = new Set();

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { window.clearTimeout(timer); reject(signal.reason); };
    const timer = window.setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

function reducedMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function ensureLayer() {
  if (captureLayer?.isConnected) return captureLayer;
  captureLayer = document.createElement('div');
  captureLayer.className = 'capture-fx-layer';
  captureLayer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(captureLayer);
  return captureLayer;
}

function centerOf(rect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function getPower(attacker, defender) {
  if (attacker?.type === 'barnacle' && defender?.rank === 8) return 3;
  if ((attacker?.rank ?? 0) >= 7) return 3;
  if ((attacker?.rank ?? 0) >= 4) return 2;
  return 1;
}

function getSpiritSize(rect, power, target = false) {
  const mobile = window.innerWidth <= 600;
  const max = mobile ? 94 : 132;
  const multiplier = target ? 1.12 : power === 3 ? 1.46 : power === 2 ? 1.34 : 1.24;
  return Math.min(max, Math.max(44, rect.width * multiplier));
}

function transformAt(dx, dy, scale, flip = 1, rotation = 0) {
  return 'translate(-50%, -50%) translate3d(' + dx + 'px,' + dy + 'px,0) scale(' + scale + ') scaleX(' + flip + ') rotate(' + rotation + 'deg)';
}

async function animateFrame(element, keyframes, options, signal) {
  signal?.throwIfAborted();
  const frames = Array.isArray(keyframes) ? keyframes : [keyframes];
  const finalFrame = frames[frames.length - 1] || {};
  const duration = Number(options?.duration ?? 0);
  const delay = Number(options?.delay ?? 0);

  if (!element.animate) {
    await sleep(duration + delay, signal);
    Object.assign(element.style, finalFrame);
    return;
  }

  const animation = element.animate(frames, { fill: 'forwards', ...options });
  activeAnimations.add(animation);
  let timer;
  let abort;
  try {
    await new Promise((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      // A suspended animation must not hold the game state hostage.
      timer = window.setTimeout(resolve, duration + delay + 180);
      animation.finished.then(resolve, resolve);
    });
    signal?.throwIfAborted();
    Object.assign(element.style, finalFrame);
  } catch (error) {
    if (!signal?.aborted) throw error;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    activeAnimations.delete(animation);
    animation.cancel();
  }
}

function fireAndForget(element, keyframes, options) {
  if (!element.animate) {
    window.setTimeout(() => element.remove(), Number(options?.duration ?? 0) + Number(options?.delay ?? 0));
    return;
  }
  const animation = element.animate(keyframes, { fill: 'forwards', ...options });
  activeAnimations.add(animation);
  const timer = window.setTimeout(cleanup, Number(options?.duration ?? 0) + Number(options?.delay ?? 0) + 180);
  function cleanup() {
    window.clearTimeout(timer);
    activeAnimations.delete(animation);
    animation.cancel();
    element.remove();
  }
  animation.finished.then(cleanup, cleanup);
}

function makeSpirit(species, faction, point, size, role) {
  const image = document.createElement('img');
  image.className = 'capture-spirit capture-spirit-' + role + ' capture-spirit-' + faction;
  image.src = species.art;
  image.alt = '';
  image.draggable = false;
  image.decoding = 'async';
  image.style.left = point.x + 'px';
  image.style.top = point.y + 'px';
  image.style.width = size + 'px';
  image.style.height = size + 'px';
  image.style.opacity = '0';
  image.style.transform = transformAt(0, 0, 0.82);
  ensureLayer().appendChild(image);
  return image;
}

function spawnRipple(point, faction, size, strength = 1) {
  const ripple = document.createElement('div');
  ripple.className = 'capture-ripple capture-ripple-' + faction;
  ripple.style.left = point.x + 'px';
  ripple.style.top = point.y + 'px';
  ripple.style.width = size + 'px';
  ripple.style.height = size + 'px';
  ensureLayer().appendChild(ripple);
  fireAndForget(
    ripple,
    [
      { opacity: 0.8 * strength, transform: 'translate(-50%, -50%) scale(.28)' },
      { opacity: 0.45 * strength, offset: 0.34, transform: 'translate(-50%, -50%) scale(.8)' },
      { opacity: 0, transform: 'translate(-50%, -50%) scale(1.75)' },
    ],
    { duration: 300, easing: 'cubic-bezier(.16,.7,.25,1)' },
  );
}

function spawnFlash(point, faction, size) {
  const flash = document.createElement('div');
  flash.className = 'capture-hit-flash capture-hit-flash-' + faction;
  flash.style.left = point.x + 'px';
  flash.style.top = point.y + 'px';
  flash.style.width = size + 'px';
  flash.style.height = size + 'px';
  ensureLayer().appendChild(flash);
  fireAndForget(
    flash,
    [
      { opacity: 0, transform: 'translate(-50%, -50%) scale(.2)' },
      { opacity: 0.95, offset: 0.28, transform: 'translate(-50%, -50%) scale(.82)' },
      { opacity: 0, transform: 'translate(-50%, -50%) scale(1.35)' },
    ],
    { duration: 145, easing: 'ease-out' },
  );
}

function spawnBubbles(point, faction, power) {
  const count = power === 3 ? 8 : power === 2 ? 6 : 5;
  BUBBLE_VECTORS.slice(0, count).forEach(([dx, dy, radius], index) => {
    const bubble = document.createElement('i');
    bubble.className = 'capture-bubble capture-bubble-' + faction;
    bubble.style.left = point.x + 'px';
    bubble.style.top = point.y + 'px';
    bubble.style.width = radius + 'px';
    bubble.style.height = radius + 'px';
    ensureLayer().appendChild(bubble);
    fireAndForget(
      bubble,
      [
        { opacity: 0, transform: 'translate(-50%, -50%) translate3d(0,0,0) scale(.25)' },
        { opacity: 0.86, offset: 0.22, transform: 'translate(-50%, -50%) translate3d(' + dx * 0.35 + 'px,' + dy * 0.35 + 'px,0) scale(.85)' },
        { opacity: 0, transform: 'translate(-50%, -50%) translate3d(' + dx + 'px,' + (dy - 10) + 'px,0) scale(1.15)' },
      ],
      { duration: 230 + index * 10, delay: index * 8, easing: 'cubic-bezier(.15,.65,.3,1)' },
    );
  });
}

function spawnStream(from, to, faction, className = 'capture-stream') {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 4) return;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  const stream = document.createElement('div');
  stream.className = className + ' ' + className + '-' + faction;
  stream.style.left = from.x + 'px';
  stream.style.top = from.y + 'px';
  stream.style.width = distance + 'px';
  stream.style.transform = 'translateY(-50%) rotate(' + angle + 'deg) scaleX(.15)';
  ensureLayer().appendChild(stream);
  fireAndForget(
    stream,
    [
      { opacity: 0, transform: 'translateY(-50%) rotate(' + angle + 'deg) scaleX(.12)' },
      { opacity: 0.58, offset: 0.28, transform: 'translateY(-50%) rotate(' + angle + 'deg) scaleX(.82)' },
      { opacity: 0, transform: 'translateY(-50%) rotate(' + angle + 'deg) scaleX(1)' },
    ],
    { duration: className === 'capture-return-stream' ? 175 : 205, easing: 'ease-out' },
  );
}

function spawnReturnStream(from, to, faction) {
  spawnStream(from, to, faction, 'capture-return-stream');
}

function shakeBoard(boardEl, power) {
  if (power < 3 || !boardEl.animate) return;
  boardEl.animate(
    [
      { transform: 'translate3d(0,0,0)' },
      { transform: 'translate3d(2px,0,0)' },
      { transform: 'translate3d(-2px,1px,0)' },
      { transform: 'translate3d(0,0,0)' },
    ],
    { duration: 68, easing: 'ease-out' },
  );
}

function clearTileState(boardEl) {
  boardEl?.classList.remove('is-resolving-capture');
  boardEl?.querySelectorAll('.capture-source, .capture-target').forEach((tile) => {
    tile.classList.remove('capture-source', 'capture-target');
  });
}

export function clearCaptureFx(boardEl = document.querySelector('#board')) {
  for (const run of activeRuns) run.abort();
  for (const animation of activeAnimations) animation.cancel();
  activeAnimations.clear();
  captureLayer?.replaceChildren();
  clearTileState(boardEl);
}

export async function playCaptureFx(options) {
  const run = new AbortController();
  activeRuns.add(run);
  const deadline = window.setTimeout(() => run.abort(), 2500);
  let completed = false;
  try {
    await runCaptureFx(options, run.signal);
    completed = !run.signal.aborted;
  } catch (error) {
    if (!run.signal.aborted) throw error;
  } finally {
    window.clearTimeout(deadline);
    activeRuns.delete(run);
    // Keep the normal final ripple; abnormal/canceled runs clean up everything.
    if (!completed && activeRuns.size === 0) clearCaptureFx(options.boardEl);
  }
}

async function runCaptureFx({
  boardEl,
  fromIndex,
  toIndex,
  attacker,
  defender,
  attackerSpecies,
  defenderSpecies,
}, signal) {
  const animateAndCommit = (element, frames, options) => animateFrame(element, frames, options, signal);
  const pause = (ms) => sleep(ms, signal);
  if (!boardEl || !attacker || !defender || !attackerSpecies || !defenderSpecies || reducedMotion()) return;

  const fromTile = boardEl.querySelector('[data-index="' + fromIndex + '"]');
  const toTile = boardEl.querySelector('[data-index="' + toIndex + '"]');
  if (!fromTile || !toTile) return;

  const fromRect = fromTile.getBoundingClientRect();
  const toRect = toTile.getBoundingClientRect();
  const start = centerOf(fromRect);
  const target = centerOf(toRect);
  const deltaX = target.x - start.x;
  const deltaY = target.y - start.y;
  const distance = Math.max(1, Math.hypot(deltaX, deltaY));
  const ux = deltaX / distance;
  const uy = deltaY / distance;
  const px = -uy;
  const py = ux;
  const power = getPower(attacker, defender);
  const attackerSize = getSpiritSize(fromRect, power, false);
  const defenderSize = getSpiritSize(toRect, power, true);
  const attackFlip = deltaX < -1 ? -1 : 1;
  const defendFlip = deltaX > 1 ? -1 : 1;
  const arc = power === 3 ? 11 : power === 2 ? 9 : 7;
  const stopDistance = Math.min(fromRect.width, toRect.width) * 0.13;
  const travelX = deltaX - ux * stopDistance;
  const travelY = deltaY - uy * stopDistance;
  const midX = travelX * 0.52 + px * arc;
  const midY = travelY * 0.52 + py * arc;
  const hitPoint = {
    x: start.x + travelX + ux * attackerSize * 0.17,
    y: start.y + travelY + uy * attackerSize * 0.17,
  };
  const preyToBiteX = hitPoint.x - target.x;
  const preyToBiteY = hitPoint.y - target.y;
  const retreatX = ux * 5;
  const retreatY = uy * 5;
  const tilt = Math.max(-10, Math.min(10, (deltaY / distance) * 10));
  const faction = attacker.faction;

  const attackerSpirit = makeSpirit(attackerSpecies, faction, start, attackerSize, 'attacker');
  const defenderSpirit = makeSpirit(defenderSpecies, defender.faction, target, defenderSize, 'defender');

  boardEl.classList.add('is-resolving-capture');
  fromTile.classList.add('capture-source');
  toTile.classList.add('capture-target');

  spawnRipple(start, faction, Math.max(32, fromRect.width * 0.72), 0.62);

  const attackerManifest = animateAndCommit(
    attackerSpirit,
    [
      { opacity: 0, transform: transformAt(0, 4, 0.82, attackFlip, 0) },
      { opacity: 0.94, transform: transformAt(0, -5, 1.22, attackFlip, tilt * 0.25) },
    ],
    { duration: CAPTURE_TIMING.manifest, easing: 'cubic-bezier(.2,.75,.25,1)' },
  );

  await pause(CAPTURE_TIMING.defenderManifestDelay);
  const defenderManifest = animateAndCommit(
    defenderSpirit,
    [
      { opacity: 0, transform: transformAt(0, 1, 0.88, defendFlip, 0) },
      { opacity: 0.76, offset: 0.7, transform: transformAt(retreatX * 0.4, retreatY * 0.4, 1.08, defendFlip, -tilt * 0.25) },
      { opacity: 0.76, transform: transformAt(retreatX, retreatY, 1.04, defendFlip, -tilt * 0.18) },
    ],
    { duration: CAPTURE_TIMING.defenderManifest, easing: 'ease-out' },
  );

  await Promise.all([attackerManifest, defenderManifest]);

  await Promise.all([
    animateAndCommit(
      attackerSpirit,
      [
        { opacity: 0.94, transform: transformAt(0, -5, 1.22, attackFlip, tilt * 0.25) },
        { opacity: 0.96, transform: transformAt(-ux * 5, -uy * 5, 1.16, attackFlip, -tilt * 0.35) },
      ],
      { duration: CAPTURE_TIMING.anticipation, easing: 'ease-in' },
    ),
    animateAndCommit(
      defenderSpirit,
      [
        { opacity: 0.76, transform: transformAt(retreatX, retreatY, 1.04, defendFlip, -tilt * 0.18) },
        { opacity: 0.78, transform: transformAt(retreatX + px * 2, retreatY + py * 2, 1.02, defendFlip, tilt * 0.35) },
      ],
      { duration: CAPTURE_TIMING.anticipation, easing: 'ease-out' },
    ),
  ]);

  spawnStream(start, { x: start.x + travelX, y: start.y + travelY }, faction);

  await animateAndCommit(
    attackerSpirit,
    [
      { opacity: 0.96, transform: transformAt(-ux * 5, -uy * 5, 1.16, attackFlip, -tilt * 0.35) },
      { opacity: 0.98, offset: 0.52, transform: transformAt(midX, midY, 1.31, attackFlip, tilt * 0.65) },
      { opacity: 1, transform: transformAt(travelX, travelY, power === 3 ? 1.43 : power === 2 ? 1.37 : 1.32, attackFlip, tilt) },
    ],
    { duration: CAPTURE_TIMING.lunge, easing: 'cubic-bezier(.45,.02,.12,1)' },
  );

  spawnFlash(hitPoint, faction, Math.max(42, fromRect.width * (power === 3 ? 1.05 : 0.86)));
  spawnRipple(hitPoint, faction, Math.max(42, fromRect.width * (power === 3 ? 1.18 : 0.92)), power === 3 ? 1 : 0.84);
  spawnBubbles(hitPoint, faction, power);
  shakeBoard(boardEl, power);

  await pause(CAPTURE_TIMING.hitStop);

  const attackerHitScale = power === 3 ? 1.43 : power === 2 ? 1.37 : 1.32;
  const devourPromise = animateAndCommit(
    defenderSpirit,
    [
      { opacity: 0.78, transform: transformAt(retreatX + px * 2, retreatY + py * 2, 1.02, defendFlip, tilt * 0.35) },
      { opacity: 0.62, offset: 0.42, transform: transformAt(preyToBiteX * 0.42, preyToBiteY * 0.42, 0.72, defendFlip, tilt * 0.15) },
      { opacity: 0, transform: transformAt(preyToBiteX, preyToBiteY, 0.18, defendFlip, 0) },
    ],
    { duration: CAPTURE_TIMING.devour, easing: 'cubic-bezier(.55,.05,.8,.3)' },
  );

  await pause(24);
  const swallowPromise = animateAndCommit(
    attackerSpirit,
    [
      { opacity: 1, transform: transformAt(travelX, travelY, attackerHitScale, attackFlip, tilt) },
      { opacity: 1, offset: 0.46, transform: transformAt(travelX + ux * 2, travelY + uy * 2, attackerHitScale + 0.07, attackFlip, tilt * 0.65) },
      { opacity: 0.96, transform: transformAt(travelX, travelY, attackerHitScale - 0.05, attackFlip, tilt * 0.25) },
    ],
    { duration: CAPTURE_TIMING.swallow, easing: 'ease-in-out' },
  );

  await Promise.all([devourPromise, swallowPromise]);

  spawnReturnStream(
    { x: start.x + travelX, y: start.y + travelY },
    start,
    faction,
  );

  await animateAndCommit(
    attackerSpirit,
    [
      { opacity: 0.96, transform: transformAt(travelX, travelY, attackerHitScale - 0.05, attackFlip, tilt * 0.25) },
      { opacity: 0.58, offset: 0.48, transform: transformAt(travelX * 0.5 + px * 3, travelY * 0.5 + py * 3, 1.03, attackFlip, 0) },
      { opacity: 0, transform: transformAt(0, 0, 0.72, attackFlip, 0) },
    ],
    { duration: CAPTURE_TIMING.return, easing: 'cubic-bezier(.25,.72,.25,1)' },
  );

  spawnRipple(start, faction, Math.max(28, fromRect.width * 0.6), 0.45);
  attackerSpirit.remove();
  defenderSpirit.remove();
  clearTileState(boardEl);
}

