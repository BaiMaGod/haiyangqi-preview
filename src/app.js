import {
  COLS,
  FACTIONS,
  SPECIES,
  applyAction,
  canCapture,
  createInitialState,
  getFactionForActor,
  getSpecies,
  isAdjacent,
} from './game.js?v=ai-explore-20261006-1';
import { chooseAiAction } from './ai.js?v=ai-explore-20261006-1';
import { clearCaptureFx, playCaptureFx } from './captureFx.js?v=capture-predation-20261005-1';
import {
  RANKS,
  createDebugRankProfile,
  chooseMatchedAiRank,
  getMatchDifficultyLabel,
  getRankById,
  getRankFromProfile,
  getRankProgress,
  getRankRecord,
  normalizeRankProfile,
  settleRankedMatch,
} from './rank.js?v=ai-explore-20261006-1';

const UI_ASSET_BASE = 'assets/ui';
const RANK_STORAGE_KEY = 'haiyangqi.rank.v1';
const FLOAT_REVEAL_DURATION = 640;
const DEFAULT_AI_DELAY = 520;
const REVEAL_AI_DELAY = 700;
const DEBUG_PARAMS = new URLSearchParams(window.location.search);
const DEBUG_MODE =
  DEBUG_PARAMS.has('debug') &&
  !['0', 'false', 'off', 'no'].includes((DEBUG_PARAMS.get('debug') || '1').toLowerCase());

const boardEl = document.querySelector('#board');
const statusEl = document.querySelector('#status');
const turnBadgeEl = document.querySelector('#turn-badge');
const playerFactionEl = document.querySelector('#player-faction');
const playerRemainingEl = document.querySelector('#player-remaining');
const aiRemainingEl = document.querySelector('#ai-remaining');
const playerRemainingDetailEl = document.querySelector('#player-remaining-detail');
const aiRemainingDetailEl = document.querySelector('#ai-remaining-detail');
const moveCountEl = document.querySelector('#move-count');
const selectedInfoEl = document.querySelector('#selected-info');
const toastEl = document.querySelector('#toast');
const resultEl = document.querySelector('#result-overlay');
const resultTitleEl = document.querySelector('#result-title');
const resultDescEl = document.querySelector('#result-desc');
const resultRankChangeEl = document.querySelector('#result-rank-change');
const resultExpDeltaEl = document.querySelector('#result-exp-delta');
const resultExpBreakdownEl = document.querySelector('#result-exp-breakdown');
const resultRankProgressEl = document.querySelector('#result-rank-progress');
const resultRankProgressTextEl = document.querySelector('#result-rank-progress-text');
const resultProtectionEl = document.querySelector('#result-protection');
const resultRestartButton = document.querySelector('#result-restart');
const restartButton = document.querySelector('#restart-button');
const rulesButton = document.querySelector('#rules-button');
const rulesDialog = document.querySelector('#rules-dialog');
const closeRulesButton = document.querySelector('#close-rules');
const rankButton = document.querySelector('#rank-button');
const rankDialog = document.querySelector('#rank-dialog');
const closeRankButton = document.querySelector('#close-rank');
const rankLadderEl = document.querySelector('#rank-ladder');
const rankNameEl = document.querySelector('#rank-name');
const rankMetaEl = document.querySelector('#rank-meta');
const rankProgressEl = document.querySelector('#rank-progress');
const rankProgressTextEl = document.querySelector('#rank-progress-text');
const rankRecordEl = document.querySelector('#rank-record');
const rankProtectionEl = document.querySelector('#rank-protection');
const aiRankNameEl = document.querySelector('#ai-rank-name');
const aiMatchTypeEl = document.querySelector('#ai-match-type');
const rankDialogSummaryEl = document.querySelector('#rank-dialog-summary');
const debugPanelEl = document.querySelector('#debug-panel');
const debugRankSelectEl = document.querySelector('#debug-rank-select');
const debugApplyButtonEl = document.querySelector('#debug-apply-rank');
const debugStatusEl = document.querySelector('#debug-status');

const floatRevealLayer = document.createElement('div');
floatRevealLayer.className = 'float-reveal-layer';
floatRevealLayer.setAttribute('aria-hidden', 'true');
document.body.appendChild(floatRevealLayer);

let state = createInitialState();
let selected = null;
let aiTimer = null;
let toastTimer = null;
const persistedRankProfile = loadRankProfile();
const requestedDebugRank = Number.parseInt(DEBUG_PARAMS.get('rank'), 10);
let debugRankId = getRankById(
  Number.isFinite(requestedDebugRank) ? requestedDebugRank : getRankFromProfile(persistedRankProfile).id,
).id;
let rankProfile = DEBUG_MODE ? createDebugRankProfile(debugRankId) : persistedRankProfile;
let matchPlayerRankId = getRankFromProfile(rankProfile).id;
let matchAiRankId = chooseMatchedAiRank(matchPlayerRankId);
let matchSettled = false;
let rankSettlement = null;
let interactionLocked = false;
let gamePaused = document.body.classList.contains('home-active');

function loadRankProfile() {
  try {
    const raw = localStorage.getItem(RANK_STORAGE_KEY);
    return normalizeRankProfile(raw ? JSON.parse(raw) : {});
  } catch (error) {
    console.warn('段位数据读取失败，已使用默认数据。', error);
    return normalizeRankProfile({});
  }
}

function saveRankProfile() {
  if (DEBUG_MODE) return;
  try {
    localStorage.setItem(RANK_STORAGE_KEY, JSON.stringify(rankProfile));
  } catch (error) {
    console.warn('段位数据保存失败。', error);
  }
  window.dispatchEvent(new Event('haiyangqi:rank-change'));
}

function signed(value) {
  return value > 0 ? `+${value}` : `${value}`;
}

function formatPoints(value) {
  return Number(value).toLocaleString('zh-CN');
}

function factionName(faction) {
  return faction ? FACTIONS[faction].name : '等待首翻';
}

function countFaction(faction) {
  if (!faction) return 30;
  return state.board.filter((piece) => piece?.faction === faction).length;
}

function countFactionByReveal(faction, revealed) {
  if (!faction) return revealed ? 0 : 30;
  return state.board.filter((piece) => piece?.faction === faction && piece.revealed === revealed).length;
}

function getStatusText() {
  if (state.winner) {
    const humanWon = state.winner === state.humanFaction;
    if (DEBUG_MODE) return humanWon ? '你赢了！DEBUG 模式不结算胜点。' : 'AI 获胜。DEBUG 模式不结算胜点。';
    return humanWon ? '你赢了！段位胜点已经结算。' : 'AI 获胜，本局段位胜点已经结算。';
  }
  if (state.draw) return `和棋：${state.drawReason}`;
  if (!state.humanFaction) return '翻开任意暗牌，它的阵营就是你的阵营。';
  if (state.turn === 'ai') return `${getRankById(matchAiRankId).name} AI 正在思考……`;
  const revealedOwn = countFactionByReveal(state.humanFaction, true);
  const hiddenOwn = countFactionByReveal(state.humanFaction, false);
  if (revealedOwn === 0 && hiddenOwn > 0) {
    return `你的明牌已经被吃完，但还有 ${hiddenOwn} 枚己方棋子藏在暗牌里，继续翻牌。`;
  }
  if (selected !== null) return '已选择棋子：点击相邻空格移动，或点击可吃的敌方棋子。';
  return '轮到你：翻牌，或移动 / 吃子。';
}

function tileClasses(piece, index) {
  const classes = ['tile'];
  if (!piece) classes.push('empty');
  if (piece && !piece.revealed) classes.push('hidden');
  if (piece?.revealed) classes.push('revealed', `faction-${piece.faction}`);
  if (selected === index) classes.push('selected');

  if (selected !== null && selected !== index && isAdjacent(selected, index, COLS)) {
    const selectedPiece = state.board[selected];
    if (!piece) classes.push('legal-move');
    else if (canCapture(selectedPiece, piece)) classes.push('legal-capture');
  }
  return classes.join(' ');
}

function tileMarkup(piece) {
  if (!piece) return '<span class="empty-dot">·</span>';
  if (!piece.revealed) {
    return `<img class="hidden-art" src="${UI_ASSET_BASE}/hidden.webp" alt="" draggable="false" decoding="async" /><span class="sr-only">未翻开的棋子</span>`;
  }
  const species = getSpecies(piece);
  return `
    <span class="piece-art-wrap" aria-hidden="true">
      <img class="piece-art" src="${species.art}" alt="" draggable="false" decoding="async" />
    </span>
    <span class="piece-name">${species.name}</span>
    <span class="piece-rank">${species.rank}</span>
  `;
}

function renderBoard() {
  boardEl.innerHTML = state.board
    .map((piece, index) => {
      const label = !piece
        ? '空格'
        : piece.revealed
          ? `${FACTIONS[piece.faction].name} ${getSpecies(piece).name} ${piece.rank}级`
          : '暗牌';
      return `<button class="${tileClasses(piece, index)}" data-index="${index}" style="--portrait-col:${Math.floor(index / COLS) + 1};--portrait-row:${index % COLS + 1}" aria-label="${label}">${tileMarkup(piece)}</button>`;
    })
    .join('');
}

function preloadRevealAssets() {
  SPECIES.forEach((species) => {
    const image = new Image();
    image.src = species.art;
  });
}

function renderLegend() {
  const legend = document.querySelector('#legend');
  legend.innerHTML = SPECIES.map(
    (species) => `<div class="legend-item"><img class="legend-art" src="${species.art}" alt="" draggable="false" loading="lazy" /><b>${species.rank}</b><small>${species.name}</small></div>`,
  ).join('');
}

function renderDebugPanel() {
  if (!debugPanelEl) return;
  debugPanelEl.hidden = !DEBUG_MODE;
  if (!DEBUG_MODE) return;

  if (!debugRankSelectEl.options.length) {
    debugRankSelectEl.innerHTML = RANKS.map(
      (rank) => `<option value="${rank.id}">${String(rank.id).padStart(2, '0')} · ${rank.name} · AI Lv.${rank.aiLevel}</option>`,
    ).join('');
  }

  debugRankSelectEl.value = String(debugRankId);
  const rank = getRankById(debugRankId);
  debugStatusEl.textContent = `当前固定：${rank.name} · 对手：${rank.name} AI · 不结算胜点 / 不写入正常存档`;
}

function renderRankPanel() {
  const rank = getRankFromProfile(rankProfile);
  const progress = getRankProgress(rankProfile);
  const record = getRankRecord(rankProfile);
  const highest = getRankById(rankProfile.highestRankId);
  const aiRank = getRankById(matchAiRankId);
  const matchType = getMatchDifficultyLabel();

  rankNameEl.textContent = rank.name;
  rankMetaEl.textContent = DEBUG_MODE ? 'DEBUG 固定段位' : `历史最高 ${highest.name}`;
  rankProgressEl.style.width = `${Math.round(progress.percent * 100)}%`;
  rankProgressTextEl.textContent = progress.isPeak
    ? `巅峰胜点 ${progress.current}`
    : `${formatPoints(progress.current)} / ${formatPoints(progress.max)} 胜点`;
  rankRecordEl.textContent = DEBUG_MODE
    ? 'DEBUG 模式 · 正常战绩与存档保持不变'
    : `胜 ${record.wins} · 负 ${record.losses} · 和 ${record.draws} · 胜率 ${Math.round(record.winRate * 100)}%`;
  rankProtectionEl.textContent = DEBUG_MODE
    ? '不结算胜点'
    : rankProfile.protectionMatches > 0
      ? `晋级保护 ${rankProfile.protectionMatches} 场`
      : `当前连胜 ${rankProfile.winStreak}`;
  aiRankNameEl.textContent = `${aiRank.name} AI`;
  aiMatchTypeEl.textContent = matchType;
  aiMatchTypeEl.dataset.type = matchType;
}

function renderRankDialog() {
  const current = getRankFromProfile(rankProfile);
  const record = getRankRecord(rankProfile);
  rankDialogSummaryEl.textContent = `当前 ${current.name} · 历史最高 ${getRankById(rankProfile.highestRankId).name} · ${record.wins}胜 ${record.losses}负 ${record.draws}和`;
  rankLadderEl.innerHTML = [...RANKS]
    .reverse()
    .map((rank) => {
      const active = rank.id === current.id ? ' active' : '';
      const reached = rank.id <= rankProfile.highestRankId ? ' reached' : '';
      const depth = rank.lookaheadDepth === 0 ? '基础判断' : `${rank.lookaheadDepth}层预判`;
      const promotion = rank.winsToNext ? ` · 晋级需 ${formatPoints(rank.winsToNext)} 胜点` : '';
      return `<div class="rank-ladder-item${active}${reached}"><span class="rank-index">${rank.id}</span><strong>${rank.name}</strong><small>AI ${depth} · ${rank.behavior}${promotion}</small></div>`;
    })
    .join('');
}

function settleMatch(outcome) {
  if (matchSettled) return rankSettlement;

  if (DEBUG_MODE) {
    const fixedRank = getRankById(debugRankId);
    rankSettlement = {
      profile: rankProfile,
      outcome,
      aiRankId: debugRankId,
      pointDelta: 0,
      totalDelta: 0,
      oldRank: fixedRank,
      newRank: fixedRank,
      promoted: false,
      demoted: false,
      protectionUsed: false,
      protectionPreventedDemotion: false,
      debug: true,
    };
    matchSettled = true;
    return rankSettlement;
  }

  rankSettlement = settleRankedMatch(rankProfile, outcome, matchAiRankId);
  rankProfile = rankSettlement.profile;
  matchSettled = true;
  saveRankProfile();
  return rankSettlement;
}

function finalizeEndedMatch() {
  if (matchSettled || (!state.winner && !state.draw)) return;
  if (state.draw) {
    settleMatch('draw');
    return;
  }
  settleMatch(state.winner === state.humanFaction ? 'win' : 'loss');
}

function renderResult() {
  const ended = state.winner || state.draw;
  resultEl.classList.toggle('show', Boolean(ended));
  if (!ended) return;

  finalizeEndedMatch();
  const settlement = rankSettlement;
  const progress = getRankProgress(rankProfile);

  if (state.draw) {
    resultTitleEl.textContent = '和棋';
    resultDescEl.textContent = state.drawReason;
  } else {
    const humanWon = state.winner === state.humanFaction;
    resultTitleEl.textContent = humanWon ? '你赢了！' : 'AI 获胜';
    resultDescEl.textContent = humanWon ? '你清空了对手的海洋生物。' : '再来一局，换一种翻牌路线试试。';
  }

  if (DEBUG_MODE) {
    resultRankChangeEl.textContent = `DEBUG · ${settlement.newRank.name}`;
    resultRankChangeEl.dataset.change = 'same';
    resultExpDeltaEl.textContent = '不结算';
    resultExpDeltaEl.dataset.delta = 'same';
    resultExpBreakdownEl.textContent = '调试模式不会修改正常段位、胜点和战绩';
    resultRankProgressEl.style.width = `${Math.round(progress.percent * 100)}%`;
    resultRankProgressTextEl.textContent = progress.isPeak
      ? `${settlement.newRank.name} · 巅峰段位测试`
      : `${settlement.newRank.name} · 固定段位 · 晋级需 ${formatPoints(progress.max)} 胜点`;
    resultProtectionEl.textContent = `对手固定为 ${getRankById(matchAiRankId).name} AI`;
    return;
  }

  if (settlement.promoted) {
    resultRankChangeEl.textContent = `晋级 · ${settlement.oldRank.name} → ${settlement.newRank.name}`;
    resultRankChangeEl.dataset.change = 'up';
  } else if (settlement.demoted) {
    resultRankChangeEl.textContent = `降级 · ${settlement.oldRank.name} → ${settlement.newRank.name}`;
    resultRankChangeEl.dataset.change = 'down';
  } else {
    resultRankChangeEl.textContent = settlement.newRank.name;
    resultRankChangeEl.dataset.change = 'same';
  }

  resultExpDeltaEl.textContent = `${signed(settlement.totalDelta)} 胜点`;
  resultExpDeltaEl.dataset.delta = settlement.totalDelta > 0 ? 'up' : settlement.totalDelta < 0 ? 'down' : 'same';
  resultExpBreakdownEl.textContent = settlement.outcome === 'win' ? '本局胜利 +1' : settlement.outcome === 'loss' ? '本局失败 -1' : '和棋不变';
  resultRankProgressEl.style.width = `${Math.round(progress.percent * 100)}%`;
  resultRankProgressTextEl.textContent = progress.isPeak
    ? `${settlement.newRank.name} · 巅峰胜点 ${progress.current}`
    : `${settlement.newRank.name} · ${formatPoints(progress.current)} / ${formatPoints(progress.max)} 胜点`;

  if (settlement.protectionPreventedDemotion) {
    resultProtectionEl.textContent = '晋级保护生效：本局未掉段';
  } else if (settlement.promoted) {
    resultProtectionEl.textContent = '获得 2 场晋级保护';
  } else if (rankProfile.protectionMatches > 0) {
    resultProtectionEl.textContent = `晋级保护剩余 ${rankProfile.protectionMatches} 场`;
  } else {
    resultProtectionEl.textContent = rankProfile.winStreak >= 2 ? `🔥 当前 ${rankProfile.winStreak} 连胜` : '';
  }
}

function render() {
  renderBoard();
  renderDebugPanel();
  renderRankPanel();
  statusEl.textContent = getStatusText();
  turnBadgeEl.textContent = state.turn === 'human' ? '你的回合' : 'AI 回合';
  turnBadgeEl.dataset.turn = state.turn;
  playerFactionEl.textContent = factionName(state.humanFaction);
  playerFactionEl.dataset.faction = state.humanFaction || '';
  const playerTotal = countFaction(state.humanFaction);
  const aiTotal = countFaction(state.aiFaction);
  playerRemainingEl.textContent = playerTotal;
  aiRemainingEl.textContent = aiTotal;
  playerRemainingDetailEl.textContent = state.humanFaction
    ? `总剩余 · 暗${countFactionByReveal(state.humanFaction, false)}`
    : '总剩余（含暗牌）';
  aiRemainingDetailEl.textContent = state.aiFaction
    ? `总剩余 · 暗${countFactionByReveal(state.aiFaction, false)}`
    : '总剩余（含暗牌）';
  moveCountEl.textContent = state.moveCount;

  if (selected !== null && state.board[selected]) {
    const piece = state.board[selected];
    selectedInfoEl.textContent = `${getSpecies(piece).name} · ${piece.rank}级`;
  } else {
    selectedInfoEl.textContent = '未选择';
  }

  renderResult();
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

function showRevealFx(index, piece) {
  if (!piece) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const tile = boardEl.querySelector(`[data-index="${index}"]`);
  if (!tile) return;

  const species = getSpecies(piece);
  const rect = tile.getBoundingClientRect();
  const size = Math.min(108, Math.max(46, rect.width * 1.08));

  const fx = document.createElement('div');
  fx.className = `float-reveal float-reveal-${piece.faction}`;
  fx.style.left = `${rect.left + rect.width / 2}px`;
  fx.style.top = `${rect.top + rect.height / 2}px`;
  fx.style.setProperty('--float-size', `${size}px`);
  fx.innerHTML = `<img class="float-reveal-art" src="${species.art}" alt="" draggable="false" decoding="async" />`;
  floatRevealLayer.appendChild(fx);

  tile.classList.remove('just-revealed');
  void tile.offsetWidth;
  tile.classList.add('just-revealed');

  fx.addEventListener('animationend', () => fx.remove(), { once: true });
  window.setTimeout(() => fx.remove(), FLOAT_REVEAL_DURATION + 120);
  window.setTimeout(() => tile.classList.remove('just-revealed'), 300);
}
async function playCaptureBeforeAction(action) {
  if (action.type !== 'capture') return;

  const attacker = state.board[action.from];
  const defender = state.board[action.to];
  if (!attacker || !defender || !canCapture(attacker, defender)) return;

  await playCaptureFx({
    boardEl,
    fromIndex: action.from,
    toIndex: action.to,
    attacker,
    defender,
    attackerSpecies: getSpecies(attacker),
    defenderSpecies: getSpecies(defender),
  });
}

async function commitHumanAction(action) {
  if (interactionLocked) return;
  const revealPiece = action.type === 'reveal' ? state.board[action.index] : null;
  interactionLocked = true;
  try {
    await playCaptureBeforeAction(action);
    state = applyAction(state, 'human', action);
    selected = null;
    render();
    if (revealPiece) {
      showRevealFx(action.index, revealPiece);
      scheduleAi(REVEAL_AI_DELAY);
    } else {
      scheduleAi();
    }
  } catch (error) {
    toast(error.message);
  } finally {
    interactionLocked = false;
  }
}
function handleTileClick(index) {
  if (gamePaused || interactionLocked || state.turn !== 'human' || state.winner || state.draw) return;
  const piece = state.board[index];

  if (piece && !piece.revealed) {
    selected = null;
    commitHumanAction({ type: 'reveal', index });
    return;
  }

  const humanFaction = getFactionForActor(state, 'human');

  if (selected !== null) {
    if (selected === index) {
      selected = null;
      render();
      return;
    }

    if (piece?.revealed && piece.faction === humanFaction) {
      selected = index;
      render();
      return;
    }

    if (!isAdjacent(selected, index, state.cols)) {
      toast('只能走到上下左右相邻的一格');
      return;
    }

    if (!piece) {
      commitHumanAction({ type: 'move', from: selected, to: index });
      return;
    }

    if (piece.revealed && piece.faction !== humanFaction) {
      commitHumanAction({ type: 'capture', from: selected, to: index });
      return;
    }
  }

  if (piece?.revealed && piece.faction === humanFaction) {
    selected = index;
    render();
    return;
  }

  if (!state.humanFaction) toast('先翻一张暗牌确定阵营');
  else toast('请选择己方棋子，或继续翻牌');
}

function scheduleAi(delay = DEFAULT_AI_DELAY) {
  clearTimeout(aiTimer);
  if (gamePaused || state.turn !== 'ai' || state.winner || state.draw) return;

  aiTimer = setTimeout(async () => {
    if (gamePaused) return;
    const action = chooseAiAction(state, { rankId: matchAiRankId });
    if (!action) return;
    const revealPiece = action.type === 'reveal' ? state.board[action.index] : null;
    interactionLocked = true;
    try {
      await playCaptureBeforeAction(action);
      state = applyAction(state, 'ai', action);
      render();
      if (revealPiece) showRevealFx(action.index, revealPiece);
    } catch (error) {
      console.error(error);
      toast('AI 行动异常，请重新开始');
    } finally {
      interactionLocked = false;
    }
  }, delay);
}

function applyDebugRank() {
  if (!DEBUG_MODE) return;
  if (interactionLocked) {
    toast('演出进行中，请稍后切换段位');
    return;
  }

  const nextRankId = getRankById(Number.parseInt(debugRankSelectEl.value, 10)).id;
  debugRankId = nextRankId;
  rankProfile = createDebugRankProfile(debugRankId);

  const url = new URL(window.location.href);
  url.searchParams.set('debug', '1');
  url.searchParams.set('rank', String(debugRankId));
  window.history.replaceState(null, '', url);

  startNewMatch();
  const rank = getRankById(debugRankId);
  toast(`DEBUG：已切换到 ${rank.name}，对手为同段 AI`);
}

function startNewMatch() {
  clearTimeout(aiTimer);
  clearCaptureFx(boardEl);
  interactionLocked = false;
  floatRevealLayer.replaceChildren();
  state = createInitialState();
  selected = null;
  matchSettled = false;
  rankSettlement = null;
  matchPlayerRankId = getRankFromProfile(rankProfile).id;
  matchAiRankId = chooseMatchedAiRank(matchPlayerRankId);
  resultEl.classList.remove('show');
  render();
}

function handleManualRestart() {
  if (interactionLocked) {
    toast('捕食演出进行中，请稍后重开');
    return;
  }
  if (DEBUG_MODE) {
    startNewMatch();
    toast('DEBUG：已重新开局，本局不结算胜点');
    return;
  }
  if (!state.winner && !state.draw && state.humanFaction && !matchSettled) {
    const confirmed = window.confirm('当前排位尚未结束，重新开局将按失败结算。确定重新开局吗？');
    if (!confirmed) return;
    const settlement = settleMatch('loss');
    startNewMatch();
    toast(`已按失败结算 ${signed(settlement.totalDelta)} 胜点`);
    return;
  }
  startNewMatch();
}

boardEl.addEventListener('click', (event) => {
  const tile = event.target.closest('[data-index]');
  if (!tile) return;
  handleTileClick(Number(tile.dataset.index));
});

window.addEventListener('haiyangqi:pause', (event) => {
  if (interactionLocked) {
    event.preventDefault();
    toast('演出进行中，请稍后返回首页');
    return;
  }
  gamePaused = true;
  clearTimeout(aiTimer);
  floatRevealLayer.replaceChildren();
});

window.addEventListener('haiyangqi:resume', () => {
  gamePaused = false;
  if (state.winner || state.draw) startNewMatch();
  else scheduleAi();
});

restartButton.addEventListener('click', handleManualRestart);
resultRestartButton.addEventListener('click', startNewMatch);
rulesButton.addEventListener('click', () => rulesDialog.showModal());
closeRulesButton.addEventListener('click', () => rulesDialog.close());
rulesDialog.addEventListener('click', (event) => {
  if (event.target === rulesDialog) rulesDialog.close();
});
rankButton.addEventListener('click', () => {
  renderRankDialog();
  rankDialog.showModal();
});
closeRankButton.addEventListener('click', () => rankDialog.close());
rankDialog.addEventListener('click', (event) => {
  if (event.target === rankDialog) rankDialog.close();
});
debugApplyButtonEl?.addEventListener('click', applyDebugRank);

preloadRevealAssets();
renderLegend();
render();

