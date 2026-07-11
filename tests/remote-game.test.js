import assert from 'node:assert/strict';
import test from 'node:test';
import * as Game from '../js/game.js';

test('尚無本機牌局時可直接載入多人開局狀態', () => {
  const ownHand = Array.from({ length: 14 }, (_, index) => ({
    uid: `t${index}`,
    color: 'red',
    number: (index % 13) + 1,
    isJoker: false,
  }));

  const state = Game.loadRemoteGame({
    roomCode: 'TEST',
    players: [
      { id: 0, name: 'Jay', isAI: false, level: null, hasMelded: false, hand: ownHand, handCount: 14 },
      { id: 'guest', name: 'Amy', isAI: false, level: null, hasMelded: false, hand: [], handCount: 14 },
    ],
    board: [],
    deckCount: 78,
    currentPlayerIndex: 0,
    turnSeconds: 60,
    round: 1,
  });

  assert.equal(state.remote, true);
  assert.equal(state.players[0].hand.length, 14);
  assert.equal(state.players[1].hand.length, 14);
  assert.equal(state.players[1].hand.every((tile) => tile.hidden), true);
});
