// ui.js
// DOM / SVG 渲染與互動（滑鼠拖曳、觸控拖曳、點擊選取→放置）。
// 只負責畫面呈現與事件轉譯，實際規則與狀態變更一律呼叫 game.js 的函式。

import * as Game from './game.js';
import { classifySet, COLOR_NAMES } from './rules.js';
import { LEVEL_LABEL } from './game.js';
import { startMusic, toggleMusic } from './music.js';
import { connectMultiplayer, createRoom, disconnectMultiplayer, drawMultiplayerTile, joinRoom, playMultiplayerTurn, startMultiplayerGame, syncMultiplayerGame } from './multiplayer.js';

// ---------- 共用小工具 ----------

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let toastTimer = null;
function showToast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

Game.listeners.render = () => render();
Game.listeners.toast = (msg) => showToast(msg);
Game.listeners.gameOver = () => showEndScreen();

// ---------- 牌面 SVG ----------

const COLOR_HEX = { red: '#d64545', blue: '#2a6fbf', black: '#1c1c1c', orange: '#e08a2c' };

function tileInnerSVG(tile) {
  if (tile.isJoker) {
    return `
      <svg viewBox="0 0 40 56" class="tile-svg">
        <rect x="1" y="1" width="38" height="54" rx="6" fill="#f6efe0" stroke="#ccc" stroke-width="1"/>
        <path d="M20 10 L23 18 L31 19 L25 25 L27 33 L20 29 L13 33 L15 25 L9 19 L17 18 Z"
              fill="url(#jokerGrad)" />
        <defs>
          <linearGradient id="jokerGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#d64545"/>
            <stop offset="33%" stop-color="#e08a2c"/>
            <stop offset="66%" stop-color="#2a6fbf"/>
            <stop offset="100%" stop-color="#1c1c1c"/>
          </linearGradient>
        </defs>
        <text x="20" y="47" text-anchor="middle" font-size="11" font-weight="700" fill="#555">JOKER</text>
      </svg>`;
  }
  const c = COLOR_HEX[tile.color];
  return `
    <svg viewBox="0 0 40 56" class="tile-svg">
      <rect x="1" y="1" width="38" height="54" rx="6" fill="#f6efe0" stroke="#ccc" stroke-width="1"/>
      <text x="20" y="36" text-anchor="middle" font-size="24" font-weight="700" fill="${c}" font-family="Arial, sans-serif">${tile.number}</text>
      <circle cx="20" cy="47" r="3" fill="${c}"/>
    </svg>`;
}

function makeTileEl(tile, { zone, setId, locked }) {
  const el = document.createElement('div');
  el.className = 'tile' + (locked ? ' locked' : '');
  el.dataset.uid = tile.uid;
  el.dataset.zone = zone;
  if (setId) el.dataset.setId = setId;
  el.innerHTML = tileInnerSVG(tile);
  if (dragCtx.selectedUid === tile.uid) el.classList.add('selected');
  if (!locked) attachDragHandlers(el);
  else {
    el.addEventListener('click', () => showToast('尚未破冰，桌面上的牌暫不能移動'));
  }
  return el;
}

// ---------- 主渲染 ----------

function isHumanTurn() {
  return Game.state && !Game.state.gameOver && Game.getCurrentPlayer().id === 0;
}

function render() {
  if (!Game.state) return;
  renderOpponents();
  renderBoard();
  renderHand();
  renderControls();

  // 拖曳中若發生重繪（例如計時器每秒更新），重建後的來源牌會失去隱藏狀態
  // 而與半透明分身同時出現（殘影）。這裡重新找到來源牌並隱藏、更新參照。
  if (dragCtx.dragging && dragCtx.sourceInfo) {
    const el = document.querySelector(`.tile[data-uid="${dragCtx.sourceInfo.uid}"]`);
    if (el) {
      el.classList.add('source-hidden');
      dragCtx.sourceEl = el;
    }
  }
}

function renderOpponents() {
  const bar = $('#opponents-bar');
  bar.innerHTML = '';
  const cur = Game.getCurrentPlayer();
  Game.state.players.slice(1).forEach((p) => {
    const card = document.createElement('div');
    card.className = 'opponent-card' + (cur.id === p.id ? ' active-turn' : '');
    const thinking = cur.id === p.id && Game.state.aiThinking;
    const humanCountdown = cur.id === p.id && !p.isAI && Number.isFinite(Game.state.timeLeft)
      ? `<div class="turn-countdown${Game.state.timeLeft <= 10 ? ' low' : ''}">⏱ ${Math.max(0, Game.state.timeLeft)} 秒</div>`
      : '';
    card.innerHTML = `
      <div class="opp-name">${p.name} ${p.isAI ? `<span class="opp-level">(${LEVEL_LABEL[p.level]})</span>` : ''}</div>
      <div class="opp-count">🀫 手牌 ${p.handCount ?? p.hand.length} 張${p.hasMelded ? ' · 已破冰' : ''}</div>
      ${humanCountdown}
      ${thinking ? '<div class="thinking"><span class="dot-spin">⏳</span> 思考中…</div>' : ''}
    `;
    bar.appendChild(card);
  });
}

function currentBoardSets() {
  return isHumanTurn() ? Game.state.draftBoard : Game.state.board;
}

function renderBoard() {
  const area = $('#board-area');
  area.innerHTML = '';
  const human = isHumanTurn();
  area.dataset.dropzone = human ? 'newset' : '';
  const sets = currentBoardSets();

  sets.forEach((set) => {
    const editable = human && Game.canEditBoardSet(set.id);
    const wrap = document.createElement('div');
    wrap.className = 'tile-set';
    wrap.dataset.dropzone = human ? 'set' : '';
    wrap.dataset.setId = set.id;
    if (!editable && human) wrap.classList.add('locked');

    if (set.tiles.length >= 1) {
      const check = classifySet(set.tiles);
      if (set.tiles.length >= 3) {
        wrap.classList.add(check.valid ? 'valid' : 'invalid');
      }
    }

    const displayTiles = sortForDisplay(set.tiles);
    for (const tile of displayTiles) {
      wrap.appendChild(makeTileEl(tile, { zone: 'board', setId: set.id, locked: !editable }));
    }
    area.appendChild(wrap);
  });

  if (human) {
    const newZone = document.createElement('div');
    newZone.className = 'tile-set newset-zone';
    newZone.dataset.dropzone = 'newset';
    newZone.textContent = Game.getCurrentPlayer().hasMelded
      ? '+ 拖曳至此建立新組合'
      : '+ 破冰區：將手牌拖曳至此（需達 30 點）';
    area.appendChild(newZone);
  }
}

function sortForDisplay(tiles) {
  const reals = tiles.filter((t) => !t.isJoker).sort((a, b) => a.number - b.number || a.color.localeCompare(b.color));
  const jokers = tiles.filter((t) => t.isJoker);
  return [...reals, ...jokers];
}

function renderHand() {
  const area = $('#hand-area');
  area.innerHTML = '';
  const human = isHumanTurn();
  const hand = human ? Game.state.draftHand : Game.state.players[0].hand;
  area.dataset.dropzone = human ? 'hand' : '';
  hand.forEach((tile) => {
    area.appendChild(makeTileEl(tile, { zone: 'hand', locked: !human }));
  });
}

function renderControls() {
  const human = isHumanTurn();
  const p = Game.getCurrentPlayer();
  const timeEl = $('#timer-display');
  if (!Number.isFinite(Game.state.turnSeconds)) {
    timeEl.textContent = '∞';
    timeEl.classList.remove('low');
  } else {
    timeEl.textContent = `${Math.max(0, Game.state.timeLeft)}s`;
    timeEl.classList.toggle('low', Game.state.timeLeft <= 10);
  }
  $('#btn-draw').disabled = !human;
  $('#btn-end').disabled = !human;
  $('#btn-undo').disabled = !human;
  $('#btn-sort').disabled = !human;
  void p;
}

// ---------- 拖曳 / 點選 互動 ----------

const dragCtx = {
  pointerId: null,
  startX: 0,
  startY: 0,
  dragging: false,
  ghostEl: null,
  sourceEl: null,
  sourceInfo: null,
  selectedUid: null,
};

function attachDragHandlers(el) {
  el.addEventListener('pointerdown', onPointerDown);
}

function onPointerDown(e) {
  if (!isHumanTurn()) return;
  // 若前一次拖曳尚未收尾（例如多指觸控、事件遺失），先清乾淨避免殘影
  if (dragCtx.pointerId !== null) endDragCleanup();
  const el = e.currentTarget;
  dragCtx.pointerId = e.pointerId;
  dragCtx.startX = e.clientX;
  dragCtx.startY = e.clientY;
  dragCtx.dragging = false;
  dragCtx.sourceEl = el;
  dragCtx.sourceInfo = {
    uid: el.dataset.uid,
    zone: el.dataset.zone,
    setId: el.dataset.setId || null,
  };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
}

/** 瀏覽器接管手勢（例如手牌區左右捲動）時會發出 pointercancel：放棄拖曳、還原狀態 */
function onPointerCancel(e) {
  if (e.pointerId !== dragCtx.pointerId) return;
  endDragCleanup();
}

function onPointerMove(e) {
  if (e.pointerId !== dragCtx.pointerId) return;
  const dx = e.clientX - dragCtx.startX;
  const dy = e.clientY - dragCtx.startY;
  if (!dragCtx.dragging && Math.hypot(dx, dy) > 6) {
    startDrag(e);
  }
  if (dragCtx.dragging && dragCtx.ghostEl) {
    dragCtx.ghostEl.style.left = `${e.clientX - 20}px`;
    dragCtx.ghostEl.style.top = `${e.clientY - 28}px`;
  }
}

function startDrag(e) {
  dragCtx.dragging = true;
  dragCtx.sourceEl.classList.add('source-hidden');
  const ghost = dragCtx.sourceEl.cloneNode(true);
  ghost.classList.add('dragging-ghost');
  ghost.classList.remove('source-hidden');
  ghost.style.left = `${e.clientX - 20}px`;
  ghost.style.top = `${e.clientY - 28}px`;
  document.body.appendChild(ghost);
  dragCtx.ghostEl = ghost;
}

function endDragCleanup() {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerCancel);
  if (dragCtx.ghostEl) dragCtx.ghostEl.remove();
  if (dragCtx.sourceEl) dragCtx.sourceEl.classList.remove('source-hidden');
  dragCtx.ghostEl = null;
  dragCtx.sourceEl = null;
  dragCtx.pointerId = null;
  dragCtx.dragging = false;
}

function onPointerUp(e) {
  if (e.pointerId !== dragCtx.pointerId) return;
  if (!dragCtx.dragging) {
    handleTap(dragCtx.sourceInfo);
    endDragCleanup();
    return;
  }
  const dropEl = document.elementFromPoint(e.clientX, e.clientY);
  const zoneEl = dropEl ? dropEl.closest('[data-dropzone]') : null;
  const source = dragCtx.sourceInfo;
  endDragCleanup();

  if (!zoneEl || !zoneEl.dataset.dropzone) return;
  const dest = { zone: zoneEl.dataset.dropzone, setId: zoneEl.dataset.setId || null };
  if (dest.zone === 'hand') dest.index = handDropIndex(e.clientX);
  performMove(source, dest);
  clearSelection();
  render();
}

/** 依滑鼠/觸控放開時的 X 座標，計算應插入手牌的位置索引 */
function handDropIndex(clientX) {
  const tiles = $$('#hand-area .tile');
  for (let i = 0; i < tiles.length; i += 1) {
    const rect = tiles[i].getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) return i;
  }
  return tiles.length;
}

// 雙擊（雙觸）偵測：手牌雙擊→送上桌面組合；桌面本回合出的牌雙擊→收回手牌
let lastTap = { uid: null, time: 0 };

function handleTap(source) {
  const now = Date.now();
  const isDoubleTap = lastTap.uid === source.uid && now - lastTap.time < 350;
  lastTap = { uid: source.uid, time: now };

  if (isDoubleTap) {
    clearSelection();
    if (source.zone === 'hand') {
      Game.quickPlayHandTile(source.uid);
    } else if (source.zone === 'board') {
      Game.moveBoardTileToHand(source.setId, source.uid);
    }
    lastTap = { uid: null, time: 0 };
    return;
  }

  if (dragCtx.selectedUid === source.uid) {
    clearSelection();
    render();
    return;
  }
  if (dragCtx.selectedUid) {
    // 已有選取牌：嘗試將其移動到剛點擊的這張牌所在的區域
    const prevSource = dragCtx.prevSourceInfo;
    let dest;
    if (source.zone === 'hand') {
      const idx = Game.state.draftHand.findIndex((t) => t.uid === source.uid);
      dest = { zone: 'hand', index: idx === -1 ? 0 : idx };
    } else {
      dest = { zone: 'set', setId: source.setId };
    }
    performMove(prevSource, dest);
    clearSelection();
    render();
    return;
  }
  dragCtx.selectedUid = source.uid;
  dragCtx.prevSourceInfo = source;
  render();
}

function clearSelection() {
  dragCtx.selectedUid = null;
  dragCtx.prevSourceInfo = null;
}

function performMove(source, dest) {
  if (source.zone === 'hand') {
    if (dest.zone === 'newset') Game.moveHandTileToNewSet(source.uid);
    else if (dest.zone === 'set') Game.moveHandTileToSet(source.uid, dest.setId);
    else if (dest.zone === 'hand') Game.reorderHandTile(source.uid, dest.index ?? 0);
  } else if (source.zone === 'board') {
    if (dest.zone === 'newset') Game.moveBoardTileToNewSet(source.setId, source.uid);
    else if (dest.zone === 'set') {
      if (dest.setId === source.setId) return;
      Game.moveBoardTileToSet(source.setId, source.uid, dest.setId);
    } else if (dest.zone === 'hand') Game.moveBoardTileToHand(source.setId, source.uid);
  }
}

// 空白區域（board-wrap / hand-wrap）本身也可作為放置目標（等同「新組合」或「手牌」）
function setupAreaLevelDrop() {
  $('#board-wrap').addEventListener('pointerup', () => {}); // 由 elementFromPoint 涵蓋，不需額外處理
}

// ---------- 按鈕事件 ----------

function setupButtons() {
  $('#btn-restart').addEventListener('click', () => {
    const isRemote = Game.state?.remote;
    const question = isRemote ? '確定要離開多人牌局嗎？離開後將由電腦接手。' : '確定要重新開始嗎？目前對局將直接結束。';
    openActionDialog(question, () => {
      if (isRemote) disconnectMultiplayer();
      Game.abortGame();
      endDragCleanup();
      clearSelection();
      $('#game-screen').hidden = true;
      $('#end-screen').hidden = true;
      $('#start-screen').hidden = false;
      $('#btn-restart').textContent = '重新開始';
      updateStatsLine();
    });
  });
  $('#btn-music').addEventListener('click', () => {
    const on = toggleMusic();
    $('#btn-music').textContent = on ? '🎵' : '🔇';
  });
  $('#btn-sort').addEventListener('click', () => Game.sortDraftHand());
  $('#btn-undo').addEventListener('click', () => Game.undoTurn());
  $('#btn-draw').addEventListener('click', () => {
    clearSelection();
    if (Game.state?.remote) drawMultiplayerTile();
    else Game.drawTile();
  });
  $('#btn-end').addEventListener('click', () => {
    clearSelection();
    if (Game.state?.remote) playMultiplayerTurn(Game.state.draftBoard, Game.state.draftHand);
    else Game.endTurnWithPlay();
  });
}

let pendingDialogAction = null;

function openActionDialog(message, action) {
  pendingDialogAction = action;
  $('#action-dialog-message').textContent = message;
  $('#action-dialog').hidden = false;
}

function closeActionDialog() {
  pendingDialogAction = null;
  $('#action-dialog').hidden = true;
}

function setupActionDialog() {
  $('#btn-dialog-cancel').addEventListener('click', closeActionDialog);
  $('#btn-dialog-confirm').addEventListener('click', () => {
    const action = pendingDialogAction;
    closeActionDialog();
    action?.();
  });
  $('#action-dialog').addEventListener('click', (event) => {
    if (event.target === $('#action-dialog')) closeActionDialog();
  });
}

// ---------- 開始畫面 ----------

let selectedAiCount = 1;
let selectedTurnSeconds = 60;

function renderAiLevelRows() {
  const list = $('#ai-levels-list');
  list.innerHTML = '';
  for (let i = 0; i < selectedAiCount; i += 1) {
    const row = document.createElement('div');
    row.className = 'ai-level-row';
    row.innerHTML = `
      <span class="name">${Game.AI_NAMES[i]}</span>
      <select data-idx="${i}">
        <option value="basic">初級</option>
        <option value="intermediate" selected>中級</option>
        <option value="advanced">高級</option>
      </select>
    `;
    list.appendChild(row);
  }
}

function setupStartScreen() {
  $$('#ai-count-group .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('#ai-count-group .seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedAiCount = Number(btn.dataset.value);
      renderAiLevelRows();
    });
  });
  $$('#turn-time-group .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('#turn-time-group .seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedTurnSeconds = btn.dataset.value === 'Infinity' ? Infinity : Number(btn.dataset.value);
    });
  });
  $$('#ai-count-group .seg-btn')[0].classList.add('active');
  $$('#turn-time-group .seg-btn')[1].classList.add('active');
  renderAiLevelRows();

  $('#btn-start-game').addEventListener('click', () => {
    startMusic(); // 於使用者手勢中啟動，符合瀏覽器自動播放政策
    const levels = $$('#ai-levels-list select').map((s) => s.value);
    Game.createGame({ aiCount: selectedAiCount, aiLevels: levels, turnSeconds: selectedTurnSeconds });
    clearSelection();
    $('#start-screen').hidden = true;
    $('#end-screen').hidden = true;
    $('#game-screen').hidden = false;
    render();
  });

  updateStatsLine();
  setupMultiplayerLobby();
}

let multiplayerPlayerId = null;
let multiplayerMaxPlayers = 3;
let multiplayerTurnSeconds = 60;

function setMultiplayerBusy(busy) {
  $('#btn-create-room').disabled = busy;
  $('#btn-join-room').disabled = busy;
}

async function ensureMultiplayerConnection() {
  setMultiplayerBusy(true);
  $('#multiplayer-status').textContent = '連線中…';
  try {
    await connectMultiplayer({
      onStatus: (status) => {
        $('#multiplayer-status').textContent = status === 'connected' ? '多人伺服器已連線' : '連線已中斷，請重新操作';
        if (status === 'disconnected') setMultiplayerBusy(false);
      },
      onJoined: ({ playerId, room }) => {
        multiplayerPlayerId = playerId;
        renderRoomLobby(room);
      },
      onRoomState: (room) => {
        renderRoomLobby(room);
        if (room.started && $('#game-screen').hidden) syncMultiplayerGame();
      },
      onGameStarted: (gameState) => showMultiplayerGame(gameState),
      onLeft: () => showMultiplayerForm(),
      onError: (message) => {
        showToast(message);
        setMultiplayerBusy(false);
      },
    });
    return true;
  } catch (error) {
    showToast(error.message);
    $('#multiplayer-status').textContent = '多人伺服器連線失敗';
    setMultiplayerBusy(false);
    return false;
  }
}

function showMultiplayerGame(gameState) {
  Game.loadRemoteGame(gameState);
  clearSelection();
  $('#start-screen').hidden = true;
  $('#end-screen').hidden = true;
  $('#game-screen').hidden = false;
  $('#btn-restart').textContent = '離開多人牌局';
  showToast('多人牌局已開始');
  render();
}

function playerName() {
  const name = $('#player-name').value.trim();
  if (!name) throw new Error('請輸入玩家暱稱');
  return name;
}

function setupMultiplayerLobby() {
  $$('#multiplayer-count-group .seg-btn').forEach((button) => {
    button.addEventListener('click', () => {
      $$('#multiplayer-count-group .seg-btn').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      multiplayerMaxPlayers = Number(button.dataset.value);
      renderMultiplayerAiLevels();
    });
  });
  $$('#multiplayer-turn-time-group .seg-btn').forEach((button) => {
    button.addEventListener('click', () => {
      $$('#multiplayer-turn-time-group .seg-btn').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      multiplayerTurnSeconds = button.dataset.value === 'Infinity' ? null : Number(button.dataset.value);
    });
  });
  renderMultiplayerAiLevels();
  $('#room-code').addEventListener('input', (event) => {
    event.target.value = event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '');
  });
  $('#btn-create-room').addEventListener('click', async () => {
    try {
      const name = playerName();
      const aiLevels = $$('#multiplayer-ai-levels select').map((select) => select.value);
      while (aiLevels.length < 3) aiLevels.push('intermediate');
      if (await ensureMultiplayerConnection()) createRoom(name, {
        maxPlayers: multiplayerMaxPlayers,
        aiLevels,
        turnSeconds: multiplayerTurnSeconds,
      });
    } catch (error) { showToast(error.message); setMultiplayerBusy(false); }
  });
  $('#btn-join-room').addEventListener('click', async () => {
    try {
      const name = playerName();
      const code = $('#room-code').value.trim();
      if (!code) throw new Error('請輸入房號');
      if (await ensureMultiplayerConnection()) joinRoom(code, name);
    } catch (error) { showToast(error.message); setMultiplayerBusy(false); }
  });
  $('#btn-leave-room').addEventListener('click', () => {
    disconnectMultiplayer();
    showMultiplayerForm();
  });
  $('#btn-start-multiplayer').addEventListener('click', () => startMultiplayerGame());
}

function renderMultiplayerAiLevels() {
  const container = $('#multiplayer-ai-levels');
  container.innerHTML = '';
  for (let seat = 2; seat <= multiplayerMaxPlayers; seat += 1) {
    const row = document.createElement('div');
    row.className = 'multiplayer-ai-row';
    row.innerHTML = `<span>第 ${seat} 席候補</span><select><option value="basic">初級</option><option value="intermediate" selected>中級</option><option value="advanced">高級</option></select>`;
    container.appendChild(row);
  }
}

function renderRoomLobby(room) {
  $('#multiplayer-form').hidden = true;
  $('#room-lobby').hidden = false;
  $('#current-room-code').textContent = room.code;
  $('#btn-start-multiplayer').hidden = room.started || room.hostId !== multiplayerPlayerId;
  const list = $('#room-player-list');
  list.innerHTML = '';
  for (const player of room.players) {
    const row = document.createElement('div');
    row.className = 'room-player';
    const label = document.createElement('span');
    label.textContent = `${player.name}${player.id === multiplayerPlayerId ? '（你）' : ''}`;
    const role = document.createElement('span');
    const levelLabel = player.isAI ? ` · ${LEVEL_LABEL[player.level]}` : '';
    role.textContent = `${player.id === room.hostId ? '房主' : (player.isAI ? '電腦' : '玩家')}${levelLabel}`;
    row.append(label, role);
    list.appendChild(row);
  }
  $('.lobby-hint').textContent = room.started
    ? '遊戲已開始，房間已鎖定；出牌同步將於下一階段開放。'
    : `等待房主開始；共 ${room.maxPlayers} 席，每回合 ${room.turnSeconds === null ? '無時間限制' : `${room.turnSeconds} 秒`}。`;
  setMultiplayerBusy(false);
}

function showMultiplayerForm() {
  multiplayerPlayerId = null;
  $('#multiplayer-form').hidden = false;
  $('#room-lobby').hidden = true;
  $('#multiplayer-status').textContent = '多人伺服器已連線';
  setMultiplayerBusy(false);
}

function updateStatsLine() {
  const stats = Game.getStats();
  $('#stats-line').textContent = stats.games > 0
    ? `歷史紀錄：共 ${stats.games} 局，玩家勝 ${stats.wins} 局（勝率 ${Math.round((stats.wins / stats.games) * 100)}%）`
    : '尚無對戰紀錄';
}

// ---------- 結束畫面 ----------

function showEndScreen() {
  $('#game-screen').hidden = true;
  $('#end-screen').hidden = false;
  const winner = Game.state.players.find((p) => p.id === Game.state.winnerId);
  $('#end-title').textContent = winner.id === 0 ? '🎉 你贏了！' : `${winner.name} 獲勝`;

  const scoresEl = $('#end-scores');
  scoresEl.innerHTML = '';
  const rows = Game.state.players
    .map((p) => ({ p, score: p.hand.reduce((s, t) => s + (t.isJoker ? 30 : t.number), 0) }))
    .sort((a, b) => a.score - b.score);
  for (const { p, score } of rows) {
    const row = document.createElement('div');
    row.className = 'score-row' + (p.id === Game.state.winnerId ? ' winner' : '');
    row.innerHTML = `<span>${p.name}${p.isAI ? `（${LEVEL_LABEL[p.level]}）` : ''}</span><span>剩餘點數 ${score} ・ ${p.hand.length} 張</span>`;
    scoresEl.appendChild(row);
  }
  updateStatsLine();
}

// ---------- 初始化 ----------
// type="module" 腳本會在 DOM 解析完成後才執行，故可直接綁定事件。

$('#btn-play-again').addEventListener('click', () => {
  $('#end-screen').hidden = true;
  $('#start-screen').hidden = false;
});

setupStartScreen();
setupButtons();
setupAreaLevelDrop();
setupActionDialog();
