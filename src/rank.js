export const RANK_STEP_EXP = 100;
export const MAX_RANK_EXP = 1900;
export const MAX_PEAK_EXP = 100;

const RANK_NAMES = [
  '棋士', '大棋士', '棋师', '大棋师', '棋灵', '大棋灵', '棋王', '大棋王', '棋皇', '大棋皇',
  '棋宗', '大棋宗', '棋尊', '大棋尊', '棋圣', '大棋圣', '棋帝', '大棋帝', '棋神', '大棋神',
];
const DEPTHS = [0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4];
const ERRORS = [0.35, 0.30, 0.26, 0.22, 0.18, 0.15, 0.13, 0.11, 0.09, 0.08, 0.07, 0.06, 0.05, 0.045, 0.04, 0.035, 0.03, 0.025, 0.02, 0.01];
const BEHAVIORS = [
  '基础行动', '优先吃子', '判断棋子价值', '避免立即反吃', '统计关键棋子', '重视站位', '保护虎鲸', '计算简单交换',
  '识别两步战术', '诱敌与封锁', '按剩余棋力调整策略', '估算暗牌期望', '处理连续威胁', '强化风险控制',
  '计算多步交换', '稳定概率评估', '主动战术牺牲', '强化残局封锁', '接近最优决策', '最高综合策略',
];

export const RANKS = RANK_NAMES.map((name, index) => ({
  id: index + 1,
  name,
  threshold: index * RANK_STEP_EXP,
  expToNext: index === RANK_NAMES.length - 1 ? null : RANK_STEP_EXP,
  aiLevel: index + 1,
  lookaheadDepth: DEPTHS[index],
  errorRate: ERRORS[index],
  behavior: BEHAVIORS[index],
}));

export const DEFAULT_RANK_PROFILE = Object.freeze({
  rankExp: 0,
  winStreak: 0,
  protectionMatches: 0,
  totalRankWins: 0,
  totalRankLosses: 0,
  totalRankDraws: 0,
  highestRankId: 1,
  peakExp: 0,
});

function int(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function getRankById(rankId) {
  return RANKS[clamp(int(rankId, 1), 1, RANKS.length) - 1];
}

export function getRankIdFromExp(rankExp) {
  const exp = clamp(int(rankExp), 0, MAX_RANK_EXP);
  return Math.min(RANKS.length, Math.floor(exp / RANK_STEP_EXP) + 1);
}

export function getRankFromProfile(profile) {
  return getRankById(getRankIdFromExp(profile.rankExp));
}

export function getRankProgress(profile) {
  const normalized = normalizeRankProfile(profile);
  const rank = getRankFromProfile(normalized);
  if (rank.id === RANKS.length) {
    return { current: normalized.peakExp, max: MAX_PEAK_EXP, percent: normalized.peakExp / MAX_PEAK_EXP, isPeak: true };
  }
  const current = normalized.rankExp - rank.threshold;
  return { current, max: RANK_STEP_EXP, percent: current / RANK_STEP_EXP, isPeak: false };
}

export function normalizeRankProfile(raw = {}) {
  const rankExp = clamp(int(raw.rankExp), 0, MAX_RANK_EXP);
  const rankId = getRankIdFromExp(rankExp);
  return {
    rankExp,
    winStreak: Math.max(0, int(raw.winStreak)),
    protectionMatches: clamp(int(raw.protectionMatches), 0, 2),
    totalRankWins: Math.max(0, int(raw.totalRankWins)),
    totalRankLosses: Math.max(0, int(raw.totalRankLosses)),
    totalRankDraws: Math.max(0, int(raw.totalRankDraws)),
    highestRankId: clamp(Math.max(int(raw.highestRankId, 1), rankId), 1, RANKS.length),
    peakExp: rankId === RANKS.length ? clamp(int(raw.peakExp), 0, MAX_PEAK_EXP) : 0,
  };
}

export function getAiConfig(rankId) {
  const rank = getRankById(rankId);
  const normalized = (rank.id - 1) / (RANKS.length - 1);
  return {
    rankId: rank.id,
    rankName: rank.name,
    level: rank.aiLevel,
    lookaheadDepth: rank.lookaheadDepth,
    errorRate: rank.errorRate,
    captureWeight: 1 + normalized * 0.7,
    safetyWeight: normalized,
    positionWeight: 0.2 + normalized * 0.8,
    informationWeight: 0.25 + normalized * 0.75,
  };
}

export function chooseMatchedAiRank(playerRankId, rng = Math.random) {
  const player = clamp(int(playerRankId, 1), 1, RANKS.length);
  const roll = rng();
  if (player === 1) return roll < 0.8 ? 1 : 2;
  if (player === RANKS.length) return roll < 0.1 ? RANKS.length - 1 : RANKS.length;
  if (roll < 0.1) return player - 1;
  if (roll < 0.8) return player;
  return player + 1;
}

export function getMatchDifficultyLabel(playerRankId, aiRankId) {
  const diff = aiRankId - playerRankId;
  if (diff > 0) return '越级挑战';
  if (diff < 0) return '优势对局';
  return '同段匹配';
}

export function getBaseExpDelta(outcome, playerRankId, aiRankId) {
  if (outcome === 'draw') return 0;
  const diff = clamp(aiRankId - playerRankId, -1, 1);
  if (outcome === 'win') return diff === 1 ? 24 : diff === -1 ? 17 : 20;
  if (outcome === 'loss') return diff === 1 ? -12 : diff === -1 ? -18 : -15;
  throw new Error(`未知排位结果: ${outcome}`);
}

export function getWinStreakBonus(nextWinStreak) {
  if (nextWinStreak >= 5) return 8;
  if (nextWinStreak === 4) return 6;
  if (nextWinStreak === 3) return 4;
  if (nextWinStreak === 2) return 2;
  return 0;
}

export function settleRankedMatch(profile, outcome, aiRankId) {
  const before = normalizeRankProfile(profile);
  const oldRank = getRankFromProfile(before);
  const normalizedAiRankId = clamp(int(aiRankId, oldRank.id), 1, RANKS.length);
  const nextWinStreak = outcome === 'win' ? before.winStreak + 1 : 0;
  const streakBonus = outcome === 'win' ? getWinStreakBonus(nextWinStreak) : 0;
  const baseDelta = getBaseExpDelta(outcome, oldRank.id, normalizedAiRankId);
  const totalDelta = baseDelta + streakBonus;
  const protectionActive = before.protectionMatches > 0;
  let protectionMatches = Math.max(0, before.protectionMatches - 1);
  let rankExp = before.rankExp;
  let peakExp = before.peakExp;

  if (oldRank.id === RANKS.length) {
    const nextPeak = peakExp + totalDelta;
    if (nextPeak >= 0) {
      peakExp = clamp(nextPeak, 0, MAX_PEAK_EXP);
    } else if (protectionActive) {
      peakExp = 0;
    } else {
      rankExp = clamp(MAX_RANK_EXP + nextPeak, 0, MAX_RANK_EXP - 1);
      peakExp = 0;
    }
  } else {
    let nextExp = rankExp + totalDelta;
    const currentFloor = oldRank.threshold;
    if (protectionActive && nextExp < currentFloor) nextExp = currentFloor;

    if (nextExp >= MAX_RANK_EXP) {
      peakExp = clamp(nextExp - MAX_RANK_EXP, 0, MAX_PEAK_EXP);
      rankExp = MAX_RANK_EXP;
    } else {
      rankExp = clamp(nextExp, 0, MAX_RANK_EXP);
      peakExp = 0;
    }
  }

  const newRank = getRankById(getRankIdFromExp(rankExp));
  const promoted = newRank.id > oldRank.id;
  const demoted = newRank.id < oldRank.id;
  if (promoted) protectionMatches = 2;

  const next = normalizeRankProfile({
    ...before,
    rankExp,
    peakExp,
    winStreak: nextWinStreak,
    protectionMatches,
    totalRankWins: before.totalRankWins + (outcome === 'win' ? 1 : 0),
    totalRankLosses: before.totalRankLosses + (outcome === 'loss' ? 1 : 0),
    totalRankDraws: before.totalRankDraws + (outcome === 'draw' ? 1 : 0),
    highestRankId: Math.max(before.highestRankId, newRank.id),
  });

  return {
    profile: next,
    outcome,
    aiRankId: normalizedAiRankId,
    baseDelta,
    streakBonus,
    totalDelta,
    oldRank,
    newRank,
    promoted,
    demoted,
    protectionUsed: protectionActive,
    protectionPreventedDemotion: protectionActive && totalDelta < 0 && newRank.id === oldRank.id && (oldRank.id === RANKS.length ? before.peakExp + totalDelta < 0 : before.rankExp + totalDelta < oldRank.threshold),
  };
}

export function getRankRecord(profile) {
  const normalized = normalizeRankProfile(profile);
  const total = normalized.totalRankWins + normalized.totalRankLosses + normalized.totalRankDraws;
  const decided = normalized.totalRankWins + normalized.totalRankLosses;
  return {
    total,
    wins: normalized.totalRankWins,
    losses: normalized.totalRankLosses,
    draws: normalized.totalRankDraws,
    winRate: decided ? normalized.totalRankWins / decided : 0,
  };
}
