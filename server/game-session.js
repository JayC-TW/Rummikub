import { COLORS, createDeck } from '../js/rules.js';
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
    })),
    board: game.board,
    deckCount: game.deck.length,
    currentPlayerIndex: orderedPlayers.findIndex((player) => player.id === currentPlayerId),
    turnSeconds: game.turnSeconds,
    round: game.round,
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
