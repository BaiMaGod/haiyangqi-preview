export const ROWS = 6;
export const COLS = 10;
export const DRAW_NO_CAPTURE_LIMIT = 40;

export const FACTIONS = {
  coral: { id: 'coral', name: '珊瑚队' },
  abyss: { id: 'abyss', name: '深海队' },
};

const ART_BASE = 'https://raw.githubusercontent.com/BaiMaGod/haiyangqi/main/assets/pieces';

export const SPECIES = [
  { type: 'orca', name: '虎鲸', rank: 8, count: 1, icon: '🐋', art: `${ART_BASE}/orca.webp` },
  { type: 'shark', name: '大白鲨', rank: 7, count: 2, icon: '🦈', art: `${ART_BASE}/shark.webp` },
  { type: 'seal', name: '海豹', rank: 6, count: 3, icon: '🦭', art: `${ART_BASE}/seal.webp` },
  { type: 'octopus', name: '章鱼', rank: 5, count: 4, icon: '🐙', art: `${ART_BASE}/octopus.webp` },
  { type: 'puffer', name: '河豚', rank: 4, count: 5, icon: '🐡', art: `${ART_BASE}/puffer.webp` },
  { type: 'fish', name: '小鱼', rank: 3, count: 6, icon: '🐟', art: `${ART_BASE}/fish.webp` },
  { type: 'shrimp', name: '虾', rank: 2, count: 5, icon: '🦐', art: `${ART_BASE}/shrimp.webp` },
  { type: 'barnacle', name: '藤壶', rank: 1, count: 4, icon: '🪸', art: `${ART_BASE}/barnacle.webp` },
];

const SPECIES_BY_TYPE = Object.fromEntries(SPECIES.map((item) => [item.type, item]));

export function shuffle(items, rng = Math.random) {
  const output = [...items];
  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

export function createPieces() {
  const pieces = [];
  for (const faction of Object.keys(FACTIONS)) {
    for (const species of SPECIES) {
      for (let i = 0; i < species.count; i += 1) {
        pieces.push({
          id: `${faction}-${species.type}-${i}`,
          faction,
          type: species.type,
          rank: species.rank,
          revealed: false,
        });
      }
    }
  }
  return pieces;
}

export function createInitialState(rng = Math.random) {
  const board = shuffle(createPieces(), rng);
  return {
    rows: ROWS,
    cols: COLS,
    board,
    humanFaction: null,
    aiFaction: null,
    turn: 'human',
    selected: null,
    winner: null,
    draw: false,
    drawReason: '',
    moveCount: 0,
    noCaptureTurns: 0,
    lastAction: null,
  };
}

export function getSpecies(piece) {
  return SPECIES_BY_TYPE[piece.type];
}

export function getFactionForActor(state, actor) {
  return actor === 'human' ? state.humanFaction : state.aiFaction;
}

export function getOpponentFaction(faction) {
  return faction === 'coral' ? 'abyss' : 'coral';
}

export function isAdjacent(a, b, cols = COLS) {
  const ar = Math.floor(a / cols);
  const ac = a % cols;
  const br = Math.floor(b / cols);
  const bc = b % cols;
  return Math.abs(ar - br) + Math.abs(ac - bc) === 1;
}

export function adjacentIndices(index, rows = ROWS, cols = COLS) {
  const r = Math.floor(index / cols);
  const c = index % cols;
  const list = [];
  if (r > 0) list.push(index - cols);
  if (r < rows - 1) list.push(index + cols);
  if (c > 0) list.push(index - 1);
  if (c < cols - 1) list.push(index + 1);
  return list;
}

export function canCapture(attacker, defender) {
  if (!attacker || !defender || attacker.faction === defender.faction) return false;
  if (!attacker.revealed || !defender.revealed) return false;

  if (attacker.rank === 1 && defender.rank === 8) return true;
  if (attacker.rank === 8 && defender.rank === 1) return false;
  return attacker.rank >= defender.rank;
}

export function countFaction(state, faction) {
  return state.board.reduce((count, piece) => count + (piece?.faction === faction ? 1 : 0), 0);
}

export function allRevealed(state) {
  return state.board.every((piece) => !piece || piece.revealed);
}

export function getLegalActions(state, actor = state.turn) {
  if (state.winner || state.draw || state.turn !== actor) return [];

  const actions = [];
  const faction = getFactionForActor(state, actor);

  state.board.forEach((piece, index) => {
    if (piece && !piece.revealed) {
      actions.push({ type: 'reveal', index });
      return;
    }

    if (!piece || !faction || piece.faction !== faction || !piece.revealed) return;

    for (const to of adjacentIndices(index, state.rows, state.cols)) {
      const target = state.board[to];
      if (!target) {
        actions.push({ type: 'move', from: index, to });
      } else if (canCapture(piece, target)) {
        actions.push({ type: 'capture', from: index, to });
      }
    }
  });

  return actions;
}

function cloneState(state) {
  return {
    ...state,
    board: state.board.map((piece) => (piece ? { ...piece } : null)),
  };
}

function finishAction(next, actor, action, captured = false) {
  next.selected = null;
  next.moveCount += 1;
  next.noCaptureTurns = captured ? 0 : next.noCaptureTurns + 1;
  next.lastAction = { actor, ...action, captured };

  for (const faction of Object.keys(FACTIONS)) {
    if (countFaction(next, faction) === 0) {
      next.winner = getOpponentFaction(faction);
      return next;
    }
  }

  if (allRevealed(next) && next.noCaptureTurns >= DRAW_NO_CAPTURE_LIMIT) {
    next.draw = true;
    next.drawReason = `全部明牌后连续 ${DRAW_NO_CAPTURE_LIMIT} 回合未发生吃子`;
    return next;
  }

  next.turn = actor === 'human' ? 'ai' : 'human';

  if (next.humanFaction && next.aiFaction && getLegalActions(next, next.turn).length === 0) {
    next.draw = true;
    next.drawReason = '当前玩家没有任何合法行动';
  }

  return next;
}

export function applyAction(state, actor, action) {
  if (state.winner || state.draw) throw new Error('对局已经结束');
  if (state.turn !== actor) throw new Error('还没轮到该玩家');

  const next = cloneState(state);

  if (action.type === 'reveal') {
    const piece = next.board[action.index];
    if (!piece) throw new Error('该位置没有棋子');
    if (piece.revealed) throw new Error('该棋子已经翻开');
    piece.revealed = true;

    if (!next.humanFaction) {
      next.humanFaction = piece.faction;
      next.aiFaction = getOpponentFaction(piece.faction);
    }

    return finishAction(next, actor, action, false);
  }

  const faction = getFactionForActor(next, actor);
  if (!faction) throw new Error('请先翻牌确定阵营');

  const fromPiece = next.board[action.from];
  if (!fromPiece || !fromPiece.revealed || fromPiece.faction !== faction) {
    throw new Error('只能操作己方已翻开的棋子');
  }
  if (!isAdjacent(action.from, action.to, next.cols)) {
    throw new Error('棋子每次只能上下左右移动一格');
  }

  const target = next.board[action.to];

  if (action.type === 'move') {
    if (target) throw new Error('目标格不是空位');
    next.board[action.to] = fromPiece;
    next.board[action.from] = null;
    return finishAction(next, actor, action, false);
  }

  if (action.type === 'capture') {
    if (!target) throw new Error('目标格没有棋子');
    if (!target.revealed) throw new Error('不能直接吃未翻开的棋子');
    if (!canCapture(fromPiece, target)) throw new Error('该棋子无法吃掉目标');
    next.board[action.to] = fromPiece;
    next.board[action.from] = null;
    return finishAction(next, actor, action, true);
  }

  throw new Error('未知行动类型');
}
