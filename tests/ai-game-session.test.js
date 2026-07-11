import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPreparedAiTurn, createGameSession, prepareAiTurn } from '../server/game-session.js';

test('多人牌局輪到電腦時會執行動作並推進回合', () => {
  const room = {
    turnSeconds: 60,
    players: [
      { id: 'human', name: 'Jay', isAI: false, level: null },
      { id: 'ai', name: '電腦A', isAI: true, level: 'basic' },
    ],
  };
  room.game = createGameSession(room);
  const sorted = room.game.players[0].hand;
  const jokerIndex = sorted.findIndex((tile) => tile.isJoker);
  assert.equal(jokerIndex === -1 || sorted.slice(jokerIndex).every((tile) => tile.isJoker), true);
  room.game.currentPlayerIndex = 1;
  const beforeTotal = room.game.deck.length + room.game.players[1].hand.length;
  const prepared = prepareAiTurn(room);
  assert.ok(prepared);
  assert.equal(applyPreparedAiTurn(room, prepared), true);
  assert.equal(room.game.currentPlayerIndex, 0);
  assert.equal(room.game.deck.length + room.game.players[1].hand.length <= beforeTotal, true);
});
