import {
  adjacentIndices,
  applyAction,
  canCapture,
  getFactionForActor,
  getLegalActions,
  getSpecies,
} from './game.js';
import { getAiConfig } from './rank.js';

const WIN_SCORE = 1_000_000;
const RANK_VALUES = [0, 9, 13, 19, 28, 40, 56, 78, 108];

function randomItem(items, rng) {
  if (!items.length) return null;
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

function manhattan(a, b, cols) {
  const ar = Math.floor(a / cols);
  const ac = a % cols;
  const br = Math.floor(b / cols);
  const bc = b % cols;
  return Math.abs(ar - br) + Math.abs(ac - bc);
}

function centerDistance(index, state) {
  const row = Math.floor(index / state.cols);
  const col = index % state.cols;
  const centerRow = (state.rows - 1) / 2;
  const centerCol = (state.cols - 1) / 2;
  return Math.abs(row - centerRow) + Math.abs(col - centerCol);
}

function visiblePieces(state, faction = null) {
  const list = [];
  state.board.forEach((piece, index) => {
    // 只允许读取已经公开的棋子；暗牌身份、阵营、等级都不参与 AI 判断。
    if (!piece?.revealed) return;
    if (faction && piece.faction !== faction) return;
    list.push({ piece, index });
  });
  return list;
}

function visibleEnemies(state, faction) {
  return visiblePieces(state).filter(({ piece }) => piece.faction !== faction);
}

function countHiddenPieces(state) {
  return state.board.reduce((count, piece) => count + (piece && !piece.revealed ? 1 : 0), 0);
}

function hiddenRatio(state) {
  const occupied = state.board.reduce((count, piece) => count + (piece ? 1 : 0), 0);
  return occupied ? countHiddenPieces(state) / occupied : 0;
}

function recentActorActions(state, actor, limit = 8) {
  return (state.recentActions || []).filter((action) => action.actor === actor).slice(-limit);
}

function consecutiveQuietAiMoves(state) {
  const actions = recentActorActions(state, 'ai', 6);
  let count = 0;
  for (let i = actions.length - 1; i >= 0; i -= 1) {
    if (actions[i].type !== 'move' || actions[i].captured) break;
    count += 1;
  }
  return count;
}

function repetitionPenalty(state, action, config) {
  if (action.type !== 'move') return 0;
  const piece = state.board[action.from];
  if (!piece) return 0;

  const recent = recentActorActions(state, 'ai', 6);
  let penalty = 0;
  let samePieceMoves = 0;

  for (let i = recent.length - 1, age = 0; i >= 0 && age < 4; i -= 1, age += 1) {
    const previous = recent[i];
    if (previous.type !== 'move' || previous.pieceId !== piece.id) continue;
    samePieceMoves += 1;

    // “A→B，下一次又B→A”是最明显的无意义往返，直接重罚。
    if (previous.from === action.to && previous.to === action.from) {
      penalty += 62 * (0.75 + config.opponentModelWeight * 0.75);
    } else {
      penalty += (14 - age * 2) * config.positionWeight;
    }
  }

  if (samePieceMoves >= 2) penalty += 28 * config.threatWeight;
  if (consecutiveQuietAiMoves(state) >= 2) penalty += 18 * config.informationWeight;

  return penalty;
}

function explorationBoost(state, config) {
  const ratio = hiddenRatio(state);
  if (ratio <= 0) return 0;

  const stagnation = Math.min(8, state.noCaptureTurns || 0);
  const quietMoves = Math.min(3, consecutiveQuietAiMoves(state));

  return (
    10 +
    ratio * 34 +
    stagnation * 1.25 +
    quietMoves * 9 +
    config.informationWeight * 7
  );
}

function hasVisibleRank(state, faction, rank) {
  return visiblePieces(state, faction).some(({ piece }) => piece.rank === rank);
}

function pieceValue(state, piece) {
  let value = RANK_VALUES[piece.rank] || piece.rank * 10;

  // 藤壶在对方虎鲸已经公开时战略价值显著上升，但不读取未翻开的虎鲸。
  if (piece.rank === 1) {
    const enemyFaction = piece.faction === 'coral' ? 'abyss' : 'coral';
    if (hasVisibleRank(state, enemyFaction, 8)) value += 34;
  }

  return value;
}

function threatAt(state, movingPiece, toIndex, fromIndex = null) {
  let worstRank = 0;
  let attackers = 0;
  for (const index of adjacentIndices(toIndex, state.rows, state.cols)) {
    if (index === fromIndex) continue;
    const enemy = state.board[index];
    if (!enemy?.revealed || enemy.faction === movingPiece.faction) continue;
    if (canCapture(enemy, movingPiece)) {
      attackers += 1;
      worstRank = Math.max(worstRank, enemy.rank);
    }
  }
  return { attackers, worstRank };
}

function captureOpportunityAt(state, movingPiece, toIndex, fromIndex = null) {
  let bestRank = 0;
  let totalValue = 0;
  let count = 0;
  for (const index of adjacentIndices(toIndex, state.rows, state.cols)) {
    if (index === fromIndex) continue;
    const enemy = state.board[index];
    if (!enemy?.revealed || enemy.faction === movingPiece.faction) continue;
    if (canCapture(movingPiece, enemy)) {
      bestRank = Math.max(bestRank, enemy.rank);
      totalValue += pieceValue(state, enemy);
      count += 1;
    }
  }
  return { bestRank, totalValue, count };
}

function supportAt(state, movingPiece, toIndex, fromIndex = null) {
  let supportValue = 0;
  let count = 0;
  for (const index of adjacentIndices(toIndex, state.rows, state.cols)) {
    if (index === fromIndex) continue;
    const ally = state.board[index];
    if (!ally?.revealed || ally.faction !== movingPiece.faction) continue;
    supportValue += pieceValue(state, ally);
    count += 1;
  }
  return { supportValue, count };
}

function scoreCapture(state, action, config) {
  const attacker = state.board[action.from];
  const defender = state.board[action.to];
  const attackerValue = pieceValue(state, attacker);
  const defenderValue = pieceValue(state, defender);

  let score = defenderValue * (1.15 + config.captureWeight * 0.5);
  score -= attackerValue * 0.06;

  if (attacker.rank === 1 && defender.rank === 8) score += 180;
  if (defender.rank === 8) score += 70;
  if (defender.rank >= 6) score += 16 * config.threatWeight;

  const threat = threatAt(state, attacker, action.to, action.from);
  if (threat.attackers) {
    score -= (attackerValue * 0.88 + threat.worstRank * 5) * config.safetyWeight;
  } else {
    score += 10 * config.safetyWeight;
  }

  const nextCapture = captureOpportunityAt(state, attacker, action.to, action.from);
  score += nextCapture.totalValue * 0.13 * config.positionWeight;

  const support = supportAt(state, attacker, action.to, action.from);
  score += support.count * 4.5 * config.positionWeight;

  // 高价值棋不能为了吃小子轻易送死。
  if (attacker.rank >= 6 && defender.rank <= 3 && threat.attackers) {
    score -= attackerValue * 0.75 * config.threatWeight;
  }

  // 虎鲸尤其需要避开公开藤壶。
  if (attacker.rank === 8) {
    const exposedBarnacle = adjacentIndices(action.to, state.rows, state.cols).some((index) => {
      const enemy = state.board[index];
      return enemy?.revealed && enemy.faction !== attacker.faction && enemy.rank === 1;
    });
    if (exposedBarnacle) score -= 260 * config.safetyWeight;
  }

  return score;
}

function scoreReveal(state, action, config, actor = 'ai') {
  const index = action.index;
  const faction = getFactionForActor(state, actor);
  const row = Math.floor(index / state.cols);
  const col = index % state.cols;
  const centerRow = (state.rows - 1) / 2;
  const centerCol = (state.cols - 1) / 2;
  const distance = Math.abs(row - centerRow) + Math.abs(col - centerCol);

  // 不读取 action.index 上暗牌的任何身份信息。
  // 暗牌越多、局面越久没有进展，探索价值越高，避免 AI 用安全移动拖延翻牌。
  let score = 12 - distance * 0.45 + explorationBoost(state, config);

  let revealedNeighbors = 0;
  let friendlyNeighbors = 0;
  let enemyPressure = 0;
  for (const near of adjacentIndices(index, state.rows, state.cols)) {
    const piece = state.board[near];
    if (!piece?.revealed) continue;
    revealedNeighbors += 1;
    if (piece.faction === faction) {
      friendlyNeighbors += 1;
    } else {
      enemyPressure += pieceValue(state, piece) / 20;
    }
  }

  score += revealedNeighbors * 1.3 * config.informationWeight;
  score += friendlyNeighbors * 1.2 * config.positionWeight;
  score -= enemyPressure * 1.4 * config.safetyWeight;

  return score;
}

function scoreMove(state, action, config) {
  const piece = state.board[action.from];
  const species = getSpecies(piece);
  const enemies = visibleEnemies(state, piece.faction);
  let score = 2 + species.rank * 0.15;

  if (enemies.length) {
    const before = Math.min(...enemies.map((enemy) => manhattan(action.from, enemy.index, state.cols)));
    const after = Math.min(...enemies.map((enemy) => manhattan(action.to, enemy.index, state.cols)));
    score += (before - after) * 1.15 * config.positionWeight;
  }

  const beforeCenter = centerDistance(action.from, state);
  const afterCenter = centerDistance(action.to, state);
  score += (beforeCenter - afterCenter) * 0.55 * config.positionWeight;

  const threat = threatAt(state, piece, action.to, action.from);
  const value = pieceValue(state, piece);
  if (threat.attackers) {
    score -= (value * 0.72 + threat.worstRank * 3.5) * config.safetyWeight;
  } else {
    score += 4 * config.safetyWeight;
  }

  const opportunity = captureOpportunityAt(state, piece, action.to, action.from);
  score += opportunity.totalValue * 0.11 * config.threatWeight;

  const support = supportAt(state, piece, action.to, action.from);
  score += support.count * 3 * config.positionWeight;

  if (piece.rank === 1) {
    const orcaDistances = enemies
      .filter((enemy) => enemy.piece.rank === 8)
      .map((enemy) => manhattan(action.to, enemy.index, state.cols));
    if (orcaDistances.length) {
      score += Math.max(0, 7 - Math.min(...orcaDistances)) * 1.8 * config.threatWeight;
    }
  }

  if (piece.rank === 8) {
    const barnacleDistances = enemies
      .filter((enemy) => enemy.piece.rank === 1)
      .map((enemy) => manhattan(action.to, enemy.index, state.cols));
    if (barnacleDistances.length) {
      score += Math.min(...barnacleDistances) * 2.5 * config.safetyWeight;
    }
  }

  score -= repetitionPenalty(state, action, config);
  return score;
}

function scoreAction(state, action, config, actor = state.turn) {
  if (action.type === 'capture') return scoreCapture(state, action, config);
  if (action.type === 'move') return scoreMove(state, action, config);
  return scoreReveal(state, action, config, actor);
}

function evaluatePublicState(state, config) {
  if (state.winner) return state.winner === state.aiFaction ? WIN_SCORE : -WIN_SCORE;
  if (state.draw) return 0;

  let score = 0;
  const pieces = visiblePieces(state);

  for (const { piece, index } of pieces) {
    const sign = piece.faction === state.aiFaction ? 1 : -1;
    const value = pieceValue(state, piece);
    score += sign * value;

    // 中心控制、活动空间、可吃目标与受威胁程度。
    score += sign * Math.max(0, 5.5 - centerDistance(index, state)) * 0.7 * config.positionWeight;

    let mobility = 0;
    let captureValue = 0;
    for (const near of adjacentIndices(index, state.rows, state.cols)) {
      const target = state.board[near];
      if (!target) {
        mobility += 1;
      } else if (target.revealed && target.faction !== piece.faction && canCapture(piece, target)) {
        mobility += 1;
        captureValue = Math.max(captureValue, pieceValue(state, target));
      }
    }
    score += sign * mobility * 0.85 * config.positionWeight;
    score += sign * captureValue * 0.12 * config.threatWeight;

    const threat = threatAt(state, piece, index);
    if (threat.attackers) {
      score -= sign * value * 0.32 * config.safetyWeight;
    }
  }

  return score;
}

function visibleSearchActions(state, actor, config) {
  const actions = getLegalActions(state, actor).filter((action) => action.type !== 'reveal');
  if (actions.length <= 1) return actions;

  actions.sort((a, b) => scoreAction(state, b, config, actor) - scoreAction(state, a, config, actor));
  return actions.slice(0, config.candidateLimit);
}

function minimax(state, depth, alpha, beta, config, ctx) {
  ctx.nodes += 1;
  if (
    depth <= 0 ||
    state.winner ||
    state.draw ||
    ctx.nodes >= config.searchBudget
  ) {
    return evaluatePublicState(state, config);
  }

  const actor = state.turn;
  const actions = visibleSearchActions(state, actor, config);

  // 如果当前只能翻暗牌，则停止公开局面搜索；绝不模拟暗牌身份。
  if (!actions.length) return evaluatePublicState(state, config);

  if (actor === 'ai') {
    let best = -Infinity;
    for (const action of actions) {
      let next;
      try {
        next = applyAction(state, actor, action);
      } catch {
        continue;
      }
      const value = minimax(next, depth - 1, alpha, beta, config, ctx);
      best = Math.max(best, value);
      alpha = Math.max(alpha, best);
      if (beta <= alpha || ctx.nodes >= config.searchBudget) break;
    }
    return Number.isFinite(best) ? best : evaluatePublicState(state, config);
  }

  let best = Infinity;
  for (const action of actions) {
    let next;
    try {
      next = applyAction(state, actor, action);
    } catch {
      continue;
    }
    const value = minimax(next, depth - 1, alpha, beta, config, ctx);
    best = Math.min(best, value);
    beta = Math.min(beta, best);
    if (beta <= alpha || ctx.nodes >= config.searchBudget) break;
  }
  return Number.isFinite(best) ? best : evaluatePublicState(state, config);
}

function scoreRootAction(state, action, config) {
  const immediate = scoreAction(state, action, config, 'ai');
  const currentEval = evaluatePublicState(state, config);

  if (action.type === 'reveal') {
    // 暗牌只进行公开信息启发式评分，不执行 applyAction，避免读取真实身份。
    return currentEval + immediate * (1.8 + config.informationWeight * 0.35);
  }

  let next;
  try {
    next = applyAction(state, 'ai', action);
  } catch {
    return -Infinity;
  }

  if (next.winner === state.aiFaction) return WIN_SCORE;
  if (next.winner && next.winner !== state.aiFaction) return -WIN_SCORE;

  const ctx = { nodes: 0 };
  const future = minimax(
    next,
    Math.max(0, config.searchDepth - 1),
    -Infinity,
    Infinity,
    config,
    ctx,
  );

  // 低段更看重眼前收益；高段更多相信真实对抗搜索结果。
  const immediateWeight = 0.55 - config.opponentModelWeight * 0.3;
  return future * config.opponentModelWeight + immediate * immediateWeight;
}

function chooseScored(scored, config, rng) {
  scored.sort((a, b) => b.score - a.score);
  if (scored.length === 1) return scored[0].action;

  // 低段仍保留少量“次优手”，但 V1.6 已整体显著降低错误率。
  if (config.errorRate > 0 && rng() < config.errorRate) {
    const poolSize =
      config.level <= 5 ? Math.min(4, scored.length) :
      config.level <= 12 ? Math.min(3, scored.length) :
      Math.min(2, scored.length);
    const alternatives = scored.slice(1, poolSize);
    if (alternatives.length) return randomItem(alternatives, rng).action;
  }

  const bestScore = scored[0].score;
  const tied = scored.filter((item) => Math.abs(item.score - bestScore) < 0.0001);
  return randomItem(tied, rng)?.action || scored[0].action;
}

export function chooseAiAction(state, options = {}) {
  const normalizedOptions = typeof options === 'function' ? { rng: options } : options;
  const rng = normalizedOptions.rng || Math.random;
  const config = getAiConfig(normalizedOptions.rankId || 1);
  const actions = getLegalActions(state, 'ai');
  if (!actions.length) return null;

  const scored = actions.map((action) => ({
    action,
    score: scoreRootAction(state, action, config),
  }));

  const revealOptions = scored
    .filter((item) => item.action.type === 'reveal')
    .sort((a, b) => b.score - a.score);
  const hasCapture = actions.some((action) => action.type === 'capture');
  const quietMoves = consecutiveQuietAiMoves(state);
  const ratio = hiddenRatio(state);

  // 防止公开局面搜索陷入“安全来回移动”的局部最优。
  // 在仍有大量暗牌、又没有立即吃子机会时，连续两次纯移动后必须打破循环去探索。
  if (revealOptions.length && !hasCapture && ratio >= 0.25 && quietMoves >= 2) {
    return revealOptions[0].action;
  }

  // 高段 AI 在明显停滞的局面会更早主动获取新信息，而不是无限走位。
  if (
    revealOptions.length &&
    !hasCapture &&
    config.level >= 10 &&
    ratio >= 0.35 &&
    (state.noCaptureTurns || 0) >= 5
  ) {
    return revealOptions[0].action;
  }

  return chooseScored(scored, config, rng);
}
