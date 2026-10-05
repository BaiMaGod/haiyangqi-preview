import { adjacentIndices, canCapture, getLegalActions, getSpecies } from './game.js';
import { getAiConfig } from './rank.js';

function randomItem(items, rng) {
  return items[Math.floor(rng() * items.length)];
}

function manhattan(a, b, cols) {
  const ar = Math.floor(a / cols);
  const ac = a % cols;
  const br = Math.floor(b / cols);
  const bc = b % cols;
  return Math.abs(ar - br) + Math.abs(ac - bc);
}

function visibleEnemies(state, faction) {
  const list = [];
  state.board.forEach((piece, index) => {
    if (piece?.revealed && piece.faction !== faction) list.push({ piece, index });
  });
  return list;
}

function isThreatenedAt(state, movingPiece, toIndex, fromIndex = null) {
  for (const index of adjacentIndices(toIndex, state.rows, state.cols)) {
    if (index === fromIndex) continue;
    const enemy = state.board[index];
    if (!enemy?.revealed || enemy.faction === movingPiece.faction) continue;
    if (canCapture(enemy, movingPiece)) return true;
  }
  return false;
}

function captureOpportunityAt(state, movingPiece, toIndex, fromIndex = null) {
  let best = 0;
  for (const index of adjacentIndices(toIndex, state.rows, state.cols)) {
    if (index === fromIndex) continue;
    const enemy = state.board[index];
    if (!enemy?.revealed || enemy.faction === movingPiece.faction) continue;
    if (canCapture(movingPiece, enemy)) best = Math.max(best, enemy.rank);
  }
  return best;
}

function scoreCapture(state, action, config) {
  const attacker = state.board[action.from];
  const defender = state.board[action.to];
  let score = (defender.rank * 13 - attacker.rank * 0.6) * config.captureWeight;

  if (attacker.rank === 1 && defender.rank === 8) score += 130;
  if (defender.rank === 8) score += 36;
  if (defender.rank >= 6) score += 10 * config.positionWeight;

  if (config.lookaheadDepth >= 1) {
    const threatened = isThreatenedAt(state, attacker, action.to, action.from);
    if (threatened) score -= (attacker.rank * 13 + 10) * config.safetyWeight;
    else score += 8 * config.safetyWeight;
  }

  if (config.lookaheadDepth >= 2) {
    score += captureOpportunityAt(state, attacker, action.to, action.from) * 4 * config.positionWeight;
  }

  if (config.lookaheadDepth >= 3 && attacker.rank >= 7 && isThreatenedAt(state, attacker, action.to, action.from)) {
    score -= 24 * config.safetyWeight;
  }

  if (config.lookaheadDepth >= 4 && attacker.rank === 8) {
    const nearBarnacle = adjacentIndices(action.to, state.rows, state.cols).some((index) => {
      const enemy = state.board[index];
      return enemy?.revealed && enemy.faction !== attacker.faction && enemy.rank === 1;
    });
    if (nearBarnacle) score -= 80;
  }

  return score;
}

function scoreReveal(state, action, config) {
  const index = action.index;
  const row = Math.floor(index / state.cols);
  const col = index % state.cols;
  const centerRow = (state.rows - 1) / 2;
  const centerCol = (state.cols - 1) / 2;
  const distance = Math.abs(row - centerRow) + Math.abs(col - centerCol);
  let score = 8 - distance * 0.22;

  if (config.lookaheadDepth >= 1) {
    let revealedNeighbors = 0;
    for (const near of adjacentIndices(index, state.rows, state.cols)) {
      if (state.board[near]?.revealed) revealedNeighbors += 1;
    }
    score += revealedNeighbors * 0.8 * config.informationWeight;
  }

  return score;
}

function scoreMove(state, action, config) {
  const piece = state.board[action.from];
  const species = getSpecies(piece);
  let score = 1 + species.rank * 0.08;
  const enemies = visibleEnemies(state, piece.faction);

  if (enemies.length) {
    const before = Math.min(...enemies.map((enemy) => manhattan(action.from, enemy.index, state.cols)));
    const after = Math.min(...enemies.map((enemy) => manhattan(action.to, enemy.index, state.cols)));
    score += (before - after) * 0.9 * config.positionWeight;
  }

  if (config.lookaheadDepth >= 1) {
    if (isThreatenedAt(state, piece, action.to, action.from)) {
      score -= (piece.rank * 5 + 5) * config.safetyWeight;
    } else {
      score += 2.5 * config.safetyWeight;
    }
  }

  if (config.lookaheadDepth >= 2) {
    score += captureOpportunityAt(state, piece, action.to, action.from) * 3 * config.positionWeight;
  }

  if (config.lookaheadDepth >= 3 && piece.rank === 1) {
    const orcaDistance = enemies
      .filter((enemy) => enemy.piece.rank === 8)
      .map((enemy) => manhattan(action.to, enemy.index, state.cols));
    if (orcaDistance.length) score += (8 - Math.min(...orcaDistance)) * 0.75;
  }

  if (config.lookaheadDepth >= 4 && piece.rank === 8) {
    const barnacles = enemies.filter((enemy) => enemy.piece.rank === 1);
    if (barnacles.length) {
      const closest = Math.min(...barnacles.map((enemy) => manhattan(action.to, enemy.index, state.cols)));
      score += closest * 1.5;
    }
  }

  return score;
}

function scoreAction(state, action, config) {
  if (action.type === 'capture') return scoreCapture(state, action, config);
  if (action.type === 'move') return scoreMove(state, action, config);
  return scoreReveal(state, action, config);
}

function chooseScored(scored, config, rng) {
  scored.sort((a, b) => b.score - a.score);
  if (scored.length === 1) return scored[0].action;

  if (rng() < config.errorRate) {
    const poolSize = Math.min(scored.length, config.level <= 4 ? 4 : 3);
    const alternatives = scored.slice(1, poolSize);
    if (alternatives.length) return randomItem(alternatives, rng).action;
  }

  const bestScore = scored[0].score;
  const tied = scored.filter((item) => Math.abs(item.score - bestScore) < 0.0001);
  return randomItem(tied, rng).action;
}

export function chooseAiAction(state, options = {}) {
  const normalizedOptions = typeof options === 'function' ? { rng: options } : options;
  const rng = normalizedOptions.rng || Math.random;
  const config = getAiConfig(normalizedOptions.rankId || 1);
  const actions = getLegalActions(state, 'ai');
  if (!actions.length) return null;

  const captures = actions.filter((action) => action.type === 'capture');
  const moves = actions.filter((action) => action.type === 'move');
  const reveals = actions.filter((action) => action.type === 'reveal');

  if (captures.length) {
    const scoredCaptures = captures.map((action) => ({ action, score: scoreAction(state, action, config) }));
    const bestCaptureScore = Math.max(...scoredCaptures.map((item) => item.score));
    const tacticalThreshold = 5 + config.level * 0.5;
    if (bestCaptureScore >= tacticalThreshold || config.level >= 5) {
      return chooseScored(scoredCaptures, config, rng);
    }
  }

  const scored = actions.map((action) => {
    let score = scoreAction(state, action, config);
    if (action.type === 'capture') score += 8;
    if (action.type === 'reveal') {
      const revealBias = Math.max(0.12, 0.48 - config.level * 0.014);
      score += revealBias * 8;
    }
    if (action.type === 'move' && reveals.length && !captures.length && config.level <= 4) score -= 1.5;
    return { action, score };
  });

  if (config.level <= 2 && reveals.length && moves.length && rng() < 0.38) {
    return randomItem(reveals, rng);
  }

  return chooseScored(scored, config, rng);
}
