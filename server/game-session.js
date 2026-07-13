import { COLORS, MIN_MELD_VALUE, createDeck, handScore, isValidBoard } from '../js/rules.js';
import { decideAiTurn } from '../js/ai.js';

function sortHand(hand) {
  hand.sort((a, b) => {
    if (a.isJoker !== b.isJoker) return a.isJoker ? 1 : -1;
    if (a.isJoker) return 0;
    return COLORS.indexOf(a.color) - COLORS.indexOf(b.color) || a.number - b.number;
  });
  return hand;
}

export function createGameSession(room) {
  const deck = createDeck();
  const players = room.players.map((player) => ({
    id: player.id,
    name: player.name,
    isAI: player.isAI,
    level: player.level,
    hasMelded: false,
    hand: sortHand(deck.splice(0, 14)),
  }));

  return {
    players,
    board: [],
    deck,
    currentPlayerIndex: Math.floor(Math.random() * players.length),
    turnSeconds: room.turnSeconds,
    round: 1,
    gameOver: false,
  };
}

export function gameViewFor(room, viewerId) {
  const game = room.game;
  const viewerIndex = game.players.findIndex((player) => player.id === viewerId);
  if (viewerIndex === -1) return null;

  const orderedPlayers = [
    ...game.players.slice(viewerIndex),
    ...game.players.slice(0, viewerIndex),
  ];
  const currentPlayerId = game.players[game.currentPlayerIndex].id;
  const winner = game.players.find((player) => player.id === game.winnerId);

  return {
    roomCode: room.code,
    players: orderedPlayers.map((player, index) => ({
      id: index === 0 ? 0 : player.id,
      name: player.name,
      isAI: player.isAI,
      level: player.level,
      hasMelded: player.hasMelded,
      hand: index === 0 ? player.hand : [],
      handCount: player.hand.length,
      score: game.gameOver ? handScore(player.hand) : null,
    })),
    board: game.board,
    deckCount: game.deck.length,
    currentPlayerIndex: orderedPlayers.findIndex((player) => player.id === currentPlayerId),
    turnSeconds: game.turnSeconds,
    turnDeadline: game.turnDeadline ?? null,
    round: game.round,
    gameOver: game.gameOver,
    winnerId: winner ? (winner.id === viewerId ? 0 : winner.id) : null,
  };
}

export function prepareAiTurn(room) {
  const game = room.game;
  const player = game.players[game.currentPlayerIndex];
  if (!player?.isAI || game.gameOver) return null;
  const action = decideAiTurn({
    hand: player.hand.map((tile) => ({ ...tile })),
    board: game.board.map((set) => set.tiles),
    hasMelded: player.hasMelded,
    level: player.level,
  });
  return { playerId: player.id, action };
}

export function applyPreparedAiTurn(room, prepared) {
  const game = room.game;
  const player = game.players[game.currentPlayerIndex];
  if (!player || player.id !== prepared.playerId || game.gameOver) return false;
  const action = prepared.action;

  if (action.type === 'draw') {
    const tile = game.deck.pop();
    if (tile) player.hand.push(tile);
  } else {
    const usedUids = new Set();
    const newSets = (action.newSets ?? []).map((tiles, index) => ({
      id: `set-${game.round}-${game.currentPlayerIndex}-${index}-${Date.now()}`,
      tiles: tiles.map((tile) => ({ ...tile })),
    }));
    for (const set of newSets) for (const tile of set.tiles) usedUids.add(tile.uid);

    for (const edit of action.boardEdits ?? []) {
      if (!game.board[edit.index]) continue;
      game.board[edit.index].tiles = edit.tiles.map((tile) => ({ ...tile }));
      for (const tile of edit.tiles) usedUids.add(tile.uid);
    }
    game.board.push(...newSets);
    player.hand = player.hand.filter((tile) => !usedUids.has(tile.uid));
    if (action.type === 'meld') player.hasMelded = true;
  }
  sortHand(player.hand);

  if (player.hand.length === 0) {
    game.gameOver = true;
    game.winnerId = player.id;
    return true;
  }
  game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
  game.round += 1;
  return true;
}

function currentHuman(room, playerId) {
  const game = room.game;
  const player = game.players[game.currentPlayerIndex];
  if (!player || player.id !== playerId) throw new Error('目前不是你的回合');
  if (player.isAI) throw new Error('此座位已由電腦接手');
  if (game.gameOver) throw new Error('遊戲已結束');
  return player;
}

function advanceHumanTurn(game) {
  game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
  game.round += 1;
}

export function applyHumanDraw(room, playerId) {
  const player = currentHuman(room, playerId);
  const tile = room.game.deck.pop();
  if (tile) player.hand.push(tile);
  sortHand(player.hand);
  advanceHumanTurn(room.game);
}

export function applyHumanPlay(room, playerId, proposedBoard, proposedHand) {
  const player = currentHuman(room, playerId);
  if (!Array.isArray(proposedBoard) || !Array.isArray(proposedHand)) throw new Error('出牌資料格式錯誤');
  if (!isValidBoard(proposedBoard.map((set) => set.tiles))) throw new Error('桌面上有不合法的牌組');

  const originalBoardTiles = room.game.board.flatMap((set) => set.tiles);
  const originalIds = [...originalBoardTiles, ...player.hand].map((tile) => tile.uid).sort();
  const proposedBoardTiles = proposedBoard.flatMap((set) => set.tiles ?? []);
  const proposedIds = [...proposedBoardTiles, ...proposedHand].map((tile) => tile.uid).sort();
  if (originalIds.length !== proposedIds.length || originalIds.some((uid, index) => uid !== proposedIds[index])) {
    throw new Error('牌張資料不完整或包含無效牌張');
  }

  const originalBoardIds = new Set(originalBoardTiles.map((tile) => tile.uid));
  const nextBoardIds = new Set(proposedBoardTiles.map((tile) => tile.uid));
  if ([...originalBoardIds].some((uid) => !nextBoardIds.has(uid))) throw new Error('桌面上的牌不能收回手中');
  if (proposedHand.length >= player.hand.length) throw new Error('本回合尚未出牌');

  if (!player.hasMelded) {
    const originalSets = new Map(room.game.board.map((set) => [set.id, set.tiles.map((tile) => tile.uid).sort().join(',')]));
    for (const set of proposedBoard) {
      if (originalSets.has(set.id) && set.tiles.map((tile) => tile.uid).sort().join(',') !== originalSets.get(set.id)) {
        throw new Error('尚未破冰，不能調整桌面既有牌組');
      }
    }
    const newSets = proposedBoard.filter((set) => !originalSets.has(set.id));
    const meldValue = newSets
      .flatMap((set) => set.tiles)
      .filter((tile) => !tile.isJoker)
      .reduce((sum, tile) => sum + tile.number, 0);
    if (newSets.length === 0 || meldValue < MIN_MELD_VALUE) throw new Error('破冰出牌需達 30 點');
    player.hasMelded = true;
  }

  room.game.board = proposedBoard.map((set) => ({ id: String(set.id), tiles: set.tiles.map((tile) => ({ ...tile })) }));
  player.hand = sortHand(proposedHand.map((tile) => ({ ...tile })));
  if (player.hand.length === 0) {
    room.game.gameOver = true;
    room.game.winnerId = player.id;
    return;
  }
  advanceHumanTurn(room.game);
}
