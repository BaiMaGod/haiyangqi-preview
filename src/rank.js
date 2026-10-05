export const MAX_PEAK_POINTS = 9999;

const RANK_NAMES = [
  '棋士', '大棋士', '棋师', '大棋师', '棋灵', '大棋灵', '棋王', '大棋王', '棋皇', '大棋皇',
  '棋宗', '大棋宗', '棋尊', '大棋尊', '棋圣', '大棋圣', '棋帝', '大棋帝', '棋神', '大棋神',
];

// 每个段位晋级到下一段所需的“净胜点”。前期严格 1/2/4/8，后续继续递增但不无限翻倍。
export const PROMOTION_WINS = [
  1, 2, 4, 8, 12, 16, 24, 32, 40, 50, 60, 75, 90, 110, 130, 150, 175, 200, 250,
];

const DEPTHS = [0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5];
const ERRORS = [0.45, 0.40, 0.36, 0.32, 0.28, 0.24, 0.21, 0.18, 0.15, 0.13, 0.11, 0.09, 0.075, 0.06, 0.05, 0.04, 0.03, 0.02, 0.01, 0];
const BEHAVIORS = [
  '认识合法行动', '更偏好直接吃子', '开始判断棋子价值', '开始规避立即反吃', '统计关键高价值棋子',
  '重视局部站位', '保护虎鲸并追踪藤壶', '计算简单交换', '识别两步战术', '主动诱敌与封锁',
  '根据剩余棋力调整攻守', '估算暗牌期望价值', '处理连续威胁', '强化风险控制', '计算多步交换',
  '稳定概率评估', '主动战术牺牲', '强化残局封锁', '深度战术与残局搜索', '最高综合策略',
];

const thresholds = [0];
for (const need of PROMOTION_WINS) thresholds.push(thresholds[thresholds.length - 1] + need);
export const MAX_RANK_POINTS = thresholds[thresholds.length - 1];

export const RANKS = RANK_NAMES.map((name, index) => ({
  id: index + 1,
  name,
  threshold: thresholds[index],
  winsToNext: index === RANK_NAMES.length - 1 ? null : PROMOTION_WINS[index],
  aiLevel: index + 1,
  lookaheadDepth: DEPTHS[index],
  errorRate: ERRORS[index],
  behavior: BEHAVIORS[index],
}));

export const DEFAULT_RANK_PROFILE = Object.freeze({
  rankPoints: 0,
  winStreak: 0,
  protectionMatches: 0,
  totalRankWins: 0,
  totalRankLosses: 0,
  totalRankDraws: 0,
  highestRankId: 1,
  peakPoints: 0,
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

export function getRankIdFromPoints(rankPoints) {
  const points = clamp(int(rankPoints), 0, MAX_RANK_POINTS);
  let id = 1;
  for (let i = 1; i < RANKS.length; i += 1) {
    if (points >= RANKS[i].threshold) id = i + 1;
    else break;
  }
  return id;
}

export function getRankFromProfile(profile) {
  return getRankById(getRankIdFromPoints(profile.rankPoints));
}

export function getRankProgress(profile) {
  const normalized = normalizeRankProfile(profile);
  const rank = getRankFromProfile(normalized);
  if (rank.id === RANKS.length) {
    return {
      current: normalized.peakPoints,
      max: null,
      percent: Math.min(1, normalized.peakPoints / 20),
      isPeak: true,
    };
  }
  const current = normalized.rankPoints - rank.threshold;
  return {
    current,
    max: rank.winsToNext,
    percent: rank.winsToNext ? current / rank.winsToNext : 0,
    isPeak: false,
  };
}

function legacyExpToPoints(raw) {
  const legacyExp = clamp(int(raw.rankExp), 0, 1900);
  const oldRankId = Math.min(20, Math.floor(legacyExp / 100) + 1);
  if (oldRankId === 20) return MAX_RANK_POINTS;
  const fraction = (legacyExp % 100) / 100;
  const rank = getRankById(oldRankId);
  return rank.threshold + Math.floor(rank.winsToNext * fraction);
}

export function normalizeRankProfile(raw = {}) {
  const rankPoints = clamp(
    raw.rankPoints == null ? legacyExpToPoints(raw) : int(raw.rankPoints),
    0,
    MAX_RANK_POINTS,
  );
  const rankId = getRankIdFromPoints(rankPoints);
  return {
    rankPoints,
    winStreak: Math.max(0, int(raw.winStreak)),
    protectionMatches: clamp(int(raw.protectionMatches), 0, 2),
    totalRankWins: Math.max(0, int(raw.totalRankWins)),
    totalRankLosses: Math.max(0, int(raw.totalRankLosses)),
    totalRankDraws: Math.max(0, int(raw.totalRankDraws)),
    highestRankId: clamp(Math.max(int(raw.highestRankId, 1), rankId), 1, RANKS.length),
    peakPoints: rankId === RANKS.length ? clamp(int(raw.peakPoints ?? raw.peakExp), 0, MAX_PEAK_POINTS) : 0,
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
    captureWeight: 1 + normalized * 0.9,
    safetyWeight: 0.12 + normalized * 1.38,
    positionWeight: 0.2 + normalized * 1.1,
    informationWeight: 0.18 + normalized * 1.02,
    threatWeight: 0.1 + normalized * 1.3,
  };
}

// 新规则：玩家段位和 AI 段位一一对应，不再随机匹配高/低一段。
export function chooseMatchedAiRank(playerRankId) {
  return clamp(int(playerRankId, 1), 1, RANKS.length);
}

export function getMatchDifficultyLabel() {
  return '同段挑战';
}

export function settleRankedMatch(profile, outcome, aiRankId) {
  const before = normalizeRankProfile(profile);
  const oldRank = getRankFromProfile(before);
  const normalizedAiRankId = chooseMatchedAiRank(aiRankId ?? oldRank.id);
  const delta = outcome === 'win' ? 1 : outcome === 'loss' ? -1 : 0;
  if (!['win', 'loss', 'draw'].includes(outcome)) throw new Error(`未知排位结果: ${outcome}`);

  const protectionActive = before.protectionMatches > 0;
  let protectionMatches = Math.max(0, before.protectionMatches - 1);
  let rankPoints = before.rankPoints;
  let peakPoints = before.peakPoints;

  if (oldRank.id === RANKS.length) {
    if (delta > 0) {
      peakPoints = clamp(peakPoints + 1, 0, MAX_PEAK_POINTS);
    } else if (delta < 0) {
      if (peakPoints > 0) peakPoints -= 1;
      else if (!protectionActive) rankPoints = MAX_RANK_POINTS - 1;
    }
  } else if (delta !== 0) {
    let nextPoints = rankPoints + delta;
    if (protectionActive && nextPoints < oldRank.threshold) nextPoints = oldRank.threshold;
    rankPoints = clamp(nextPoints, 0, MAX_RANK_POINTS);
  }

  const newRank = getRankById(getRankIdFromPoints(rankPoints));
  const promoted = newRank.id > oldRank.id;
  const demoted = newRank.id < oldRank.id;
  if (promoted) protectionMatches = 2;
  if (newRank.id < RANKS.length) peakPoints = 0;

  const nextWinStreak = outcome === 'win' ? before.winStreak + 1 : 0;
  const next = normalizeRankProfile({
    ...before,
    rankPoints,
    peakPoints,
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
    pointDelta: delta,
    totalDelta: delta,
    oldRank,
    newRank,
    promoted,
    demoted,
    protectionUsed: protectionActive,
    protectionPreventedDemotion:
      protectionActive &&
      delta < 0 &&
      newRank.id === oldRank.id &&
      (oldRank.id === RANKS.length ? before.peakPoints === 0 : before.rankPoints === oldRank.threshold),
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
