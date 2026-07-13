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
  assert.deepEqual(state.players[0].hand.slice(0, 3).map((tile) => tile.number), [1, 1, 2]);
});

test('多人結算保留真人與電腦勝者識別', () => {
  const base = {
    roomCode: 'TEST',
    players: [
      { id: 0, name: 'Jay', isAI: false, level: null, hasMelded: true, hand: [], handCount: 0, score: 0 },
      { id: 'ai-winner', name: '電腦A', isAI: true, level: 'basic', hasMelded: true, hand: [], handCount: 0, score: 0 },
    ],
    board: [],
    deckCount: 0,
    currentPlayerIndex: 0,
    turnSeconds: 60,
    turnDeadline: null,
    round: 10,
    gameOver: true,
  };

  let state = Game.loadRemoteGame({ ...base, winnerId: 0 });
  assert.equal(state.players.find((player) => player.id === state.winnerId).name, 'Jay');
  state = Game.loadRemoteGame({ ...base, winnerId: 'ai-winner' });
  assert.equal(state.players.find((player) => player.id === state.winnerId).name, '電腦A');
});

test('單人開局不依賴多人遠端狀態', () => {
  const state = Game.createGame({ aiCount: 0, aiLevels: [], turnSeconds: Infinity });
  assert.equal(state.gameOver, false);
  assert.equal(state.winnerId, null);
  Game.abortGame();
});

test('未破冰時拖到舊牌組會改建新的破冰牌組', () => {
  const handTile = { uid: 'hand-10', color: 'red', number: 10, isJoker: false };
  const oldTiles = [1, 2, 3].map((number) => ({ uid: `old-${number}`, color: 'blue', number, isJoker: false }));
  Game.loadRemoteGame({
    roomCode: 'TEST',
    players: [
      { id: 0, name: 'Jay', isAI: false, level: null, hasMelded: false, hand: [handTile], handCount: 1 },
      { id: 'guest', name: 'Amy', isAI: false, level: null, hasMelded: false, hand: [], handCount: 14 },
    ],
    board: [{ id: 'old-set', tiles: oldTiles }],
    deckCount: 88,
    currentPlayerIndex: 0,
    turnSeconds: 60,
    round: 1,
  });

  Game.moveHandTileToSet(handTile.uid, 'old-set');
  assert.equal(Game.state.draftBoard[0].tiles.length, 3);
  assert.equal(Game.state.draftBoard[1].tiles[0].uid, handTile.uid);
});
