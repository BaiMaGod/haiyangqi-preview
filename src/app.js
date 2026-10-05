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
} from './game.js';
import { chooseAiAction } from './ai.js';

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
const restartButtons = document.querySelectorAll('[data-restart]');
const rulesButton = document.querySelector('#rules-button');
const rulesDialog = document.querySelector('#rules-dialog');
const closeRulesButton = document.querySelector('#close-rules');

let state = createInitialState();
let selected = null;
let aiTimer = null;
let toastTimer = null;

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
    return humanWon ? '你赢了！海域已被你控制。' : 'AI 获胜，再来一局？';
  }
  if (state.draw) return `和棋：${state.drawReason}`;
  if (!state.humanFaction) return '翻开任意暗牌，它的阵营就是你的阵营。';
  if (state.turn === 'ai') return 'AI 正在思考……';
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
    return '<span class="shell-mark" aria-hidden="true">◒</span><span class="sr-only">未翻开的棋子</span>';
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
      return `<button class="${tileClasses(piece, index)}" data-index="${index}" aria-label="${label}">${tileMarkup(piece)}</button>`;
    })
    .join('');
}

function renderLegend() {
  const legend = document.querySelector('#legend');
  legend.innerHTML = SPECIES.map(
    (species) => `<div class="legend-item"><img class="legend-art" src="${species.art}" alt="" draggable="false" loading="lazy" /><b>${species.rank}</b><small>${species.name}</small></div>`,
  ).join('');
}

function renderResult() {
  const ended = state.winner || state.draw;
  resultEl.classList.toggle('show', Boolean(ended));
  if (!ended) return;

  if (state.draw) {
    resultTitleEl.textContent = '和棋';
    resultDescEl.textContent = state.drawReason;
    return;
  }

  const humanWon = state.winner === state.humanFaction;
  resultTitleEl.textContent = humanWon ? '你赢了！' : 'AI 获胜';
  resultDescEl.textContent = humanWon ? '你清空了对手的海洋生物。' : '再来一局，换一种翻牌路线试试。';
}

function render() {
  renderBoard();
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
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1500);
}

function commitHumanAction(action) {
  try {
    state = applyAction(state, 'human', action);
    selected = null;
    render();
    scheduleAi();
  } catch (error) {
    toast(error.message);
  }
}

function handleTileClick(index) {
  if (state.turn !== 'human' || state.winner || state.draw) return;
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

function scheduleAi() {
  clearTimeout(aiTimer);
  if (state.turn !== 'ai' || state.winner || state.draw) return;

  aiTimer = setTimeout(() => {
    const action = chooseAiAction(state);
    if (!action) return;
    try {
      state = applyAction(state, 'ai', action);
      render();
    } catch (error) {
      console.error(error);
      toast('AI 行动异常，请重新开始');
    }
  }, 520);
}

function restart() {
  clearTimeout(aiTimer);
  state = createInitialState();
  selected = null;
  resultEl.classList.remove('show');
  render();
}

boardEl.addEventListener('click', (event) => {
  const tile = event.target.closest('[data-index]');
  if (!tile) return;
  handleTileClick(Number(tile.dataset.index));
});

restartButtons.forEach((button) => button.addEventListener('click', restart));
rulesButton.addEventListener('click', () => rulesDialog.showModal());
closeRulesButton.addEventListener('click', () => rulesDialog.close());
rulesDialog.addEventListener('click', (event) => {
  if (event.target === rulesDialog) rulesDialog.close();
});

renderLegend();
render();
