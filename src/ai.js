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

function visibleAllies(state, faction) {
  const list = [];
  state.board.forEach((piece, index) => {
    if (piece?.revealed && piece.faction === faction) list.push({ piece, index });
  });
  return list;
}

function isThreatenedAt(state, movingPiece, toIndex, fromIndex = null) {
  let worst = 0;
  for (const index of adjacentIndices(toIndex, state.rows, state.cols)) {
    if (index === fromIndex) continue;
    const enemy = state.board[index];
    if (!enemy?.revealed || enemy.faction === movingPiece.faction) continue;
    if (canCapture(enemy, movingPiece)) worst = Math.max(worst, enemy.rank);
  }
  return worst;
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

function supportAt(state, movingPiece, toIndex, fromIndex = null) {
  let support = 0;
  for (const index of adjacentIndices(toIndex, state.rows, state.cols)) {
    if (index === fromIndex) continue;
    const ally = state.board[index];
    if (ally?.revealed && ally.faction === movingPiece.faction) support += ally.rank;
  }
  return support;
}

function scoreCapture(state, action, config) {
  const attacker = state.board[action.from];
  const defender = state.board[action.to];
  let score = (defender.rank * 14 - attacker.rank * 0.65) * config.captureWeight;

  if (attacker.rank === 1 && defender.rank === 8) score += 150;
  if (defender.rank === 8) score += 45;
  if (defender.rank >= 6) score += 12 * config.positionWeight;

  const threat = isThreatenedAt(state, attacker, action.to, action.from);
  if (threat) {
    score -= (attacker.rank * 11 + threat * 4 + 8) * config.safetyWeight;
  } else {
    score += 7 * config.safetyWeight;
  }

  if (config.lookaheadDepth >= 2) {
    score += captureOpportunityAt(state, attacker, action.to, action.from) * 4.5 * config.positionWeight;
    score += supportAt(state, attacker, action.to, action.from) * 0.4 * config.positionWeight;
  }

  if (config.lookaheadDepth >= 3 && attacker.rank >= 7 && threat) {
    score -= 28 * config.threatWeight;
  }

  if (config.lookaheadDepth >= 4 && attacker.rank === 8) {
    const nearBarnacle = adjacentIndices(action.to, state.rows, state.cols).some((index) => {
      const enemy = state.board[index];
      return enemy?.revealed && enemy.faction !== attacker.faction && enemy.rank === 1;
    });
    if (nearBarnacle) score -= 120 * config.safetyWeight;
  }

  if (config.lookaheadDepth >= 5 && defender.rank <= 3 && attacker.rank >= 7 && threat) {
    score -= 45 * config.threatWeight;
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
  let score = 6.5 - distance * 0.22;

  let revealedNeighbors = 0;
  let enemyNeighbors = 0;
  for (const near of adjacentIndices(index, state.rows, state.cols)) {
    const piece = state.board[near];
    if (piece?.revealed) {
      revealedNeighbors += 1;
      if (piece.faction !== state.aiFaction) enemyNeighbors += 1;
    }
  }

  score += revealedNeighbors * 0.75 * config.informationWeight;
  if (config.lookaheadDepth >= 2) score += enemyNeighbors * 0.45 * config.informationWeight;
  return score;
}

function scoreMove(state, action, config) {
  const piece = state.board[action.from];
  const species = getSpecies(piece);
  let score = 1 + species.rank * 0.08;
  const enemies = visibleEnemies(state, piece.faction);
  const allies = visibleAllies(state, piece.faction);

  if (enemies.length) {
    const before = Math.min(...enemies.map((enemy) => manhattan(action.from, enemy.index, state.cols)));
    const after = Math.min(...enemies.map((enemy) => manhattan(action.to, enemy.index, state.cols)));
    score += (before - after) * 0.9 * config.positionWeight;
  }

  const threat = isThreatenedAt(state, piece, action.to, action.from);
  if (threat) {
    score -= (piece.rank * 5.5 + threat * 2.5 + 4) * config.safetyWeight;
  } else {
    score += 2.8 * config.safetyWeight;
  }

  if (config.lookaheadDepth >= 2) {
    score += captureOpportunityAt(state, piece, action.to, action.from) * 3.2 * config.positionWeight;
    score += supportAt(state, piece, action.to, action.from) * 0.28 * config.positionWeight;
  }

  if (config.lookaheadDepth >= 3 && piece.rank === 1) {
    const orcaDistances = enemies
      .filter((enemy) => enemy.piece.rank === 8)
      .map((enemy) => manhattan(action.to, enemy.index, state.cols));
    if (orcaDistances.length) score += (8 - Math.min(...orcaDistances)) * 0.9 * config.threatWeight;
  }

  if (config.lookaheadDepth >= 4 && piece.rank === 8) {
    const barnacles = enemies.filter((enemy) => enemy.piece.rank === 1);
    if (barnacles.length) {
      const closest = Math.min(...barnacles.map((enemy) => manhattan(action.to, enemy.index, state.cols)));
      score += closest * 1.8 * config.safetyWeight;
    }
  }

  if (config.lookaheadDepth >= 5 && allies.length) {
    const center = ((state.rows - 1) / 2) * state.cols + (state.cols - 1) / 2;
    const beforeCenter = manhattan(action.from, Math.round(center), state.cols);
    const afterCenter = manhattan(action.to, Math.round(center), state.cols);
    score += (beforeCenter - afterCenter) * 0.25 * config.positionWeight;
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

  // 段位越低，越可能从合理候选中选到次优手；段位越高，错误率严格下降。
  if (rng() < config.errorRate) {
    const maxPool = config.level <= 4 ? 5 : config.level <= 10 ? 4 : 3;
    const alternatives = scored.slice(1, Math.min(scored.length, maxPool));
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

  const scored = actions.map((action) => {
    let score = scoreAction(state, action, config);

    // 低段 AI 更容易“看到能吃就吃”或随手翻牌；高段 AI 会把所有行动放在同一评分框架中比较。
    if (config.level <= 4 && action.type === 'capture') score += 8 - config.level;
    if (config.level <= 3 && action.type === 'reveal') score += 3.5 - config.level * 0.5;

    return { action, score };
  });

  if (config.level === 1) {
    const reveals = scored.filter((item) => item.action.type === 'reveal');
    if (reveals.length && rng() < 0.28) return randomItem(reveals, rng).action;
  }

  return chooseScored(scored, config, rng);
}
