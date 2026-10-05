import { getLegalActions, getSpecies } from './game.js';

function randomItem(items, rng) {
  return items[Math.floor(rng() * items.length)];
}

function scoreCapture(state, action) {
  const attacker = state.board[action.from];
  const defender = state.board[action.to];
  let score = defender.rank * 12 - attacker.rank;

  if (attacker.rank === 1 && defender.rank === 8) score += 100;
  if (defender.rank === 8) score += 30;
  if (attacker.rank >= 7) score -= 2;

  return score;
}

function scoreReveal(state, action) {
  const index = action.index;
  const cols = state.cols;
  const row = Math.floor(index / cols);
  const col = index % cols;
  const centerRow = (state.rows - 1) / 2;
  const centerCol = (state.cols - 1) / 2;
  const distance = Math.abs(row - centerRow) + Math.abs(col - centerCol);
  return 10 - distance * 0.25;
}

function scoreMove(state, action) {
  const piece = state.board[action.from];
  const species = getSpecies(piece);
  let score = 1 + species.rank * 0.05;

  const targetRow = Math.floor(action.to / state.cols);
  const targetCol = action.to % state.cols;
  for (let i = 0; i < state.board.length; i += 1) {
    const enemy = state.board[i];
    if (!enemy?.revealed || enemy.faction === piece.faction) continue;
    const row = Math.floor(i / state.cols);
    const col = i % state.cols;
    const distance = Math.abs(row - targetRow) + Math.abs(col - targetCol);
    if (distance <= 2) score += 0.6;
  }

  return score;
}

export function chooseAiAction(state, rng = Math.random) {
  const actions = getLegalActions(state, 'ai');
  if (!actions.length) return null;

  const captures = actions.filter((action) => action.type === 'capture');
  if (captures.length) {
    const scored = captures.map((action) => ({ action, score: scoreCapture(state, action) }));
    const best = Math.max(...scored.map((item) => item.score));
    return randomItem(scored.filter((item) => item.score === best), rng).action;
  }

  const reveals = actions.filter((action) => action.type === 'reveal');
  const moves = actions.filter((action) => action.type === 'move');

  if (reveals.length && (!moves.length || rng() < Math.min(0.82, 0.42 + reveals.length / 80))) {
    const scored = reveals.map((action) => ({ action, score: scoreReveal(state, action) + rng() }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0].action;
  }

  if (moves.length) {
    const scored = moves.map((action) => ({ action, score: scoreMove(state, action) + rng() }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0].action;
  }

  return randomItem(reveals, rng);
}
