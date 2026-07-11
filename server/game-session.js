import { createDeck } from '../js/rules.js';

export function createGameSession(room) {
  const deck = createDeck();
  const players = room.players.map((player) => ({
    id: player.id,
    name: player.name,
    isAI: player.isAI,
    level: player.level,
    hasMelded: false,
    hand: deck.splice(0, 14),
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
