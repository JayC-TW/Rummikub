// game.js
// 遊戲狀態機：牌堆、手牌、桌面牌組、回合順序，以及所有規則相關的操作。
// 不觸碰 DOM；由 ui.js 呼叫本模組的函式來改變狀態，並在每次改變後重新渲染畫面。

import { createDeck, isValidSet, classifySet, MIN_MELD_VALUE, handScore, COLORS } from './rules.js';
import { decideAiTurn } from './ai.js';

let setUid = 0;
function newSetId() {
  setUid += 1;
  return `set${setUid}`;
}

export const AI_NAMES = ['電腦A', '電腦B', '電腦C'];
export const LEVEL_LABEL = { basic: '初級', intermediate: '中級', advanced: '高級' };

/** @type {any} 全域遊戲狀態，由 createGame() 建立 */
export let state = null;

export const listeners = { render: () => {}, toast: () => {}, gameOver: () => {} };

function toast(msg) {
  listeners.toast(msg);
}

function cloneTiles(tiles) {
  return tiles.map((t) => ({ ...t }));
}
function cloneSets(sets) {
  return sets.map((s) => ({ id: s.id, tiles: cloneTiles(s.tiles) }));
}

export function createGame(config) {
  // config: { aiCount, aiLevels: [level,...], turnSeconds: number|Infinity }
  const deck = createDeck();
  const players = [];
  players.push({ id: 0, name: '你', isAI: false, level: null, hand: [], hasMelded: false });
  for (let i = 0; i < config.aiCount; i += 1) {
    players.push({
      id: i + 1,
      name: AI_NAMES[i],
      isAI: true,
      level: config.aiLevels[i] || 'basic',
      hand: [],
      hasMelded: false,
    });
  }

  for (const p of players) {
    p.hand = deck.splice(0, 14);
    p.hand.sort(handComparator); // 開局手牌即依顏色、數字排序
  }

  const startIndex = Math.floor(Math.random() * players.length);

  state = {
    players,
    board: [],
    draftBoard: [],
    draftHand: [],
    deck,
    currentPlayerIndex: startIndex,
    turnSeconds: config.turnSeconds,
    timeLeft: config.turnSeconds,
    timerHandle: null,
    turnStartSnapshot: null,
    consecutivePasses: 0,
    gameOver: false,
    winnerId: null,
    round: 1,
  };

  beginTurn();
  return state;
}

function currentPlayer() {
  return state.players[state.currentPlayerIndex];
}
export function getCurrentPlayer() {
  return currentPlayer();
}

function snapshotTurnStart() {
  const p = currentPlayer();
  state.draftBoard = cloneSets(state.board);
  state.draftHand = cloneTiles(p.hand);
  state.turnStartSnapshot = {
    boardIds: new Set(state.board.map((s) => s.id)),
    handUids: new Set(p.hand.map((t) => t.uid)),
    boardUids: new Set(state.board.flatMap((s) => s.tiles.map((t) => t.uid))),
    handLength: p.hand.length,
  };
}

function clearTimer() {
  if (state.timerHandle) {
    clearInterval(state.timerHandle);
    state.timerHandle = null;
  }
}

function startTimer() {
  clearTimer();
  state.timeLeft = state.turnSeconds;
  if (!Number.isFinite(state.turnSeconds)) return;
  state.timerHandle = setInterval(() => {
    state.timeLeft -= 1;
    listeners.render();
    if (state.timeLeft <= 0) {
      clearTimer();
      handleTimeout();
    }
  }, 1000);
}

function handleTimeout() {
  if (state.gameOver) return;
  const p = currentPlayer();
  toast(`${p.name} 思考逾時，自動抽牌`);
  if (p.isAI) {
    forceDrawAndAdvance();
  } else {
    drawTile();
  }
}

function beginTurn() {
  if (state.gameOver) return;
  snapshotTurnStart();
  startTimer();
  listeners.render();
  const p = currentPlayer();
  if (p.isAI) {
    runAiTurn();
  }
}

// ---------- 手牌 / 桌面 編輯操作（供 UI 拖曳呼叫，僅作用於 draft） ----------

export function canEditBoardSet(setId) {
  const p = currentPlayer();
  if (p.hasMelded) return true;
  // 尚未破冰：只能編輯本回合新建立的組合（不在 turnStartSnapshot.boardIds 內）
  return !state.turnStartSnapshot.boardIds.has(setId);
}

export function isHandOriginTile(uid) {
  return state.turnStartSnapshot.handUids.has(uid);
}

/** 手牌固定排序：依顏色（紅→藍→黑→橙）再依數字，百搭排最後 */
function handComparator(a, b) {
  if (a.isJoker !== b.isJoker) return a.isJoker ? 1 : -1;
  if (a.isJoker && b.isJoker) return 0;
  const ci = COLORS.indexOf(a.color) - COLORS.indexOf(b.color);
  if (ci !== 0) return ci;
  return a.number - b.number;
}

function sortHand(tiles) {
  tiles.sort(handComparator);
}

export function sortDraftHand() {
  sortHand(state.draftHand);
  listeners.render();
}

export function moveHandTileToNewSet(uid) {
  const idx = state.draftHand.findIndex((t) => t.uid === uid);
  if (idx === -1) return;
  const [tile] = state.draftHand.splice(idx, 1);
  state.draftBoard.push({ id: newSetId(), tiles: [tile] });
  listeners.render();
}

export function moveHandTileToSet(uid, setId) {
  if (!canEditBoardSet(setId)) {
    toast('尚未破冰，不能加入桌面既有的牌組');
    return;
  }
  const idx = state.draftHand.findIndex((t) => t.uid === uid);
  if (idx === -1) return;
  const set = state.draftBoard.find((s) => s.id === setId);
  if (!set) return;
  const [tile] = state.draftHand.splice(idx, 1);
  set.tiles.push(tile);
  listeners.render();
}

export function moveBoardTileToSet(fromSetId, uid, toSetId) {
  if (!canEditBoardSet(fromSetId) || !canEditBoardSet(toSetId)) {
    toast('尚未破冰，不能調整桌面既有的牌組');
    return;
  }
  const fromSet = state.draftBoard.find((s) => s.id === fromSetId);
  const toSet = state.draftBoard.find((s) => s.id === toSetId);
  if (!fromSet || !toSet) return;
  const idx = fromSet.tiles.findIndex((t) => t.uid === uid);
  if (idx === -1) return;
  const [tile] = fromSet.tiles.splice(idx, 1);
  toSet.tiles.push(tile);
  cleanupEmptySets();
  listeners.render();
}

export function moveBoardTileToNewSet(fromSetId, uid) {
  if (!canEditBoardSet(fromSetId)) {
    toast('尚未破冰，不能調整桌面既有的牌組');
    return;
  }
  const fromSet = state.draftBoard.find((s) => s.id === fromSetId);
  if (!fromSet) return;
  const idx = fromSet.tiles.findIndex((t) => t.uid === uid);
  if (idx === -1) return;
  const [tile] = fromSet.tiles.splice(idx, 1);
  state.draftBoard.push({ id: newSetId(), tiles: [tile] });
  cleanupEmptySets();
  listeners.render();
}

export function moveBoardTileToHand(fromSetId, uid) {
  if (!isHandOriginTile(uid)) {
    toast('桌面上原有的牌不能收回手中');
    return;
  }
  if (!canEditBoardSet(fromSetId)) return;
  const fromSet = state.draftBoard.find((s) => s.id === fromSetId);
  if (!fromSet) return;
  const idx = fromSet.tiles.findIndex((t) => t.uid === uid);
  if (idx === -1) return;
  const [tile] = fromSet.tiles.splice(idx, 1);
  state.draftHand.push(tile);
  cleanupEmptySets();
  listeners.render();
}

/**
 * 快速出牌（雙擊手牌時使用）：
 * 優先嘗試加入可編輯的桌面牌組且結果仍為合法組合；找不到就建立新組合。
 */
export function quickPlayHandTile(uid) {
  const idx = state.draftHand.findIndex((t) => t.uid === uid);
  if (idx === -1) return;
  const tile = state.draftHand[idx];
  for (const set of state.draftBoard) {
    if (!canEditBoardSet(set.id)) continue;
    if (isValidSet([...set.tiles, tile])) {
      state.draftHand.splice(idx, 1);
      set.tiles.push(tile);
      listeners.render();
      return;
    }
  }
  // 沒有可直接加入的合法組合 → 建立新組合
  state.draftHand.splice(idx, 1);
  state.draftBoard.push({ id: newSetId(), tiles: [tile] });
  listeners.render();
}

export function reorderHandTile(uid, targetIndex) {
  const idx = state.draftHand.findIndex((t) => t.uid === uid);
  if (idx === -1) return;
  const [tile] = state.draftHand.splice(idx, 1);
  const clampedIndex = Math.max(0, Math.min(targetIndex, state.draftHand.length));
  state.draftHand.splice(clampedIndex, 0, tile);
  listeners.render();
}

function cleanupEmptySets() {
  state.draftBoard = state.draftBoard.filter((s) => s.tiles.length > 0);
}

// ---------- 回合控制 ----------

/** 中止目前對局（重新開始時使用）：停止計時器並標記結束，讓進行中的 AI 思考延遲失效 */
export function abortGame() {
  if (!state) return;
  clearTimer();
  state.gameOver = true;
}

export function undoTurn() {
  const p = currentPlayer();
  state.draftBoard = cloneSets(state.board);
  state.draftHand = cloneTiles(p.hand);
  listeners.render();
  toast('已還原本回合的出牌');
}

function validateDraftForCommit() {
  const p = currentPlayer();
  for (const set of state.draftBoard) {
    if (!isValidSet(set.tiles)) {
      return { ok: false, reason: '桌面上有不合法的牌組，請調整後再結束回合' };
    }
  }
  // 確認所有原本桌面上的牌都還在（沒有遺失）
  const nowUids = new Set(state.draftBoard.flatMap((s) => s.tiles.map((t) => t.uid)));
  for (const uid of state.turnStartSnapshot.boardUids) {
    if (!nowUids.has(uid)) {
      return { ok: false, reason: '桌面上的牌不能被移除，請確認每張桌面牌都仍在某個牌組中' };
    }
  }

  const newSets = state.draftBoard.filter((s) => !state.turnStartSnapshot.boardIds.has(s.id));

  if (!p.hasMelded) {
    // 破冰限制：新牌組只能由手牌組成，且總點數需 >= 30
    for (const set of newSets) {
      const mixed = set.tiles.some((t) => state.turnStartSnapshot.boardUids.has(t.uid));
      if (mixed) {
        return { ok: false, reason: '尚未破冰，新牌組不能使用桌面上既有的牌' };
      }
    }
    // 百搭牌不計入破冰點數，只加總真牌數字（meldValue）
    const total = newSets.reduce((sum, s) => sum + classifySet(s.tiles).meldValue, 0);
    if (newSets.length === 0 || total < MIN_MELD_VALUE) {
      return { ok: false, reason: `破冰需要新出牌組總點數達到 ${MIN_MELD_VALUE} 點（目前 ${total} 點，百搭牌不計分）` };
    }
  } else if (state.draftHand.length === state.turnStartSnapshot.handLength) {
    return { ok: false, reason: '本回合尚未出任何牌，請出牌或改為抽牌' };
  }

  return { ok: true, willMeld: !p.hasMelded };
}

export function endTurnWithPlay() {
  const result = validateDraftForCommit();
  if (!result.ok) {
    toast(result.reason);
    return false;
  }
  const p = currentPlayer();
  const playedCount = state.turnStartSnapshot.handLength - state.draftHand.length;
  state.board = cloneSets(state.draftBoard);
  p.hand = cloneTiles(state.draftHand);
  sortHand(p.hand); // 出牌後手牌維持排序
  if (result.willMeld) p.hasMelded = true;

  state.consecutivePasses = playedCount > 0 ? 0 : state.consecutivePasses + 1;

  if (p.hand.length === 0) {
    endGame(p.id);
    return true;
  }
  advanceTurn();
  return true;
}

export function drawTile() {
  const p = currentPlayer();
  if (state.deck.length === 0) {
    toast('牌堆已空，無法抽牌');
    state.consecutivePasses += 1;
    checkStalemate();
    if (!state.gameOver) advanceTurn();
    return;
  }
  const tile = state.deck.pop();
  p.hand.push(tile);
  sortHand(p.hand); // 抽牌後重新排序，維持顏色、數字順序
  state.consecutivePasses += 1;
  toast(`${p.name} 抽了一張牌`);
  checkStalemate();
  if (!state.gameOver) advanceTurn();
}

function forceDrawAndAdvance() {
  drawTile();
}

function checkStalemate() {
  if (state.deck.length === 0 && state.consecutivePasses >= state.players.length) {
    endGame(null);
  }
}

function advanceTurn() {
  clearTimer();
  if (state.gameOver) return;
  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
  beginTurn();
}

function endGame(winnerId) {
  clearTimer();
  state.gameOver = true;
  if (winnerId === null) {
    // 比較剩餘手牌點數，最低者獲勝
    let best = null;
    for (const p of state.players) {
      const score = handScore(p.hand);
      if (best === null || score < best.score) best = { id: p.id, score };
    }
    state.winnerId = best.id;
  } else {
    state.winnerId = winnerId;
  }
  saveResultToStats(state.winnerId === 0);
  listeners.gameOver();
  listeners.render();
}

// ---------- AI 回合 ----------

function runAiTurn() {
  const p = currentPlayer();
  const action = decideAiTurn({
    hand: cloneTiles(p.hand),
    board: state.board.map((s) => s.tiles),
    hasMelded: p.hasMelded,
    level: p.level,
  });

  listeners.render(); // 顯示「思考中」狀態（ui.js 會依 isAiThinking 判斷）
  state.aiThinking = true;
  listeners.render();

  const gameRef = state; // 記住本局的 state，若期間重新開始（state 被換掉）則不執行
  setTimeout(() => {
    if (state !== gameRef || state.gameOver) return;
    state.aiThinking = false;
    applyAiAction(p, action);
  }, action.thinkMs);
}

function applyAiAction(p, action) {
  if (state.gameOver) return;
  if (action.type === 'draw') {
    drawTile();
    return;
  }

  const usedUids = new Set();
  const newSetObjs = (action.newSets || []).map((tiles) => ({ id: newSetId(), tiles: tiles.map((t) => ({ ...t })) }));
  for (const s of newSetObjs) for (const t of s.tiles) usedUids.add(t.uid);

  let nextBoard = state.board.map((s) => ({ id: s.id, tiles: s.tiles.slice() }));
  if (action.boardEdits) {
    for (const edit of action.boardEdits) {
      const target = nextBoard[edit.index];
      if (target) {
        target.tiles = edit.tiles.map((t) => ({ ...t }));
        for (const t of edit.tiles) usedUids.add(t.uid);
      }
    }
  }
  nextBoard = [...nextBoard, ...newSetObjs];

  const nextHand = p.hand.filter((t) => !usedUids.has(t.uid));

  // 驗證 AI 產生的結果，防止規則不一致造成桌面損毀
  const allValid = nextBoard.every((s) => isValidSet(s.tiles));
  const originalUids = new Set(state.board.flatMap((s) => s.tiles.map((t) => t.uid)));
  const resultUids = new Set(nextBoard.flatMap((s) => s.tiles.map((t) => t.uid)));
  const boardIntact = [...originalUids].every((u) => resultUids.has(u));

  if (!allValid || !boardIntact) {
    // 安全防護：AI 邏輯若產生不合法結果，退回抽牌，避免破壞遊戲狀態
    drawTile();
    return;
  }

  if (action.type === 'meld') {
    // 與玩家相同：百搭牌不計入破冰點數
    const total = newSetObjs.reduce((sum, s) => sum + classifySet(s.tiles).meldValue, 0);
    if (total < MIN_MELD_VALUE) {
      drawTile();
      return;
    }
    p.hasMelded = true;
  }

  const playedCount = p.hand.length - nextHand.length;
  state.board = nextBoard;
  p.hand = nextHand;
  state.consecutivePasses = playedCount > 0 ? 0 : state.consecutivePasses + 1;
  toast(`${p.name} 出牌了`);

  if (p.hand.length === 0) {
    endGame(p.id);
    return;
  }
  checkStalemate();
  if (!state.gameOver) advanceTurn();
}

// ---------- 統計（localStorage） ----------

const STATS_KEY = 'rummikub_stats_v1';
function saveResultToStats(humanWon) {
  let stats = { games: 0, wins: 0 };
  try {
    stats = JSON.parse(localStorage.getItem(STATS_KEY)) || stats;
  } catch (e) {
    /* ignore */
  }
  stats.games += 1;
  if (humanWon) stats.wins += 1;
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}
export function getStats() {
  try {
    return JSON.parse(localStorage.getItem(STATS_KEY)) || { games: 0, wins: 0 };
  } catch (e) {
    return { games: 0, wins: 0 };
  }
}
