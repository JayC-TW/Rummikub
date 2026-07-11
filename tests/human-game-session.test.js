import assert from 'node:assert/strict';
import test from 'node:test';
import { applyHumanDraw, applyHumanPlay, createGameSession } from '../server/game-session.js';

test('多人真人回合可抽牌並推進回合', () => {
  const room = {
    turnSeconds: 60,
    players: [
      { id: 'human', name: 'Jay', isAI: false, level: null },
      { id: 'ai', name: '電腦A', isAI: true, level: 'basic' },
    ],
  };
  room.game = createGameSession(room);
  room.game.currentPlayerIndex = 0;
  applyHumanDraw(room, 'human');
  assert.equal(room.game.players[0].hand.length, 15);
  assert.equal(room.game.currentPlayerIndex, 1);
  assert.throws(() => applyHumanDraw(room, 'human'), /不是你的回合/);
});

test('多人真人可提交合法破冰牌組', () => {
  const room = {
    turnSeconds: 60,
    players: [
      { id: 'human', name: 'Jay', isAI: false, level: null },
      { id: 'ai', name: '電腦A', isAI: true, level: 'basic' },
    ],
  };
  room.game = createGameSession(room);
  room.game.currentPlayerIndex = 0;
  const meld = [10, 11, 12].map((number) => ({ uid: `meld-${number}`, color: 'red', number, isJoker: false }));
  const rest = [{ uid: 'rest', color: 'blue', number: 1, isJoker: false }];
  room.game.players[0].hand = [...meld, ...rest];
  applyHumanPlay(room, 'human', [{ id: 'new-set', tiles: meld }], rest);
  assert.equal(room.game.players[0].hasMelded, true);
  assert.equal(room.game.players[0].hand.length, 1);
  assert.equal(room.game.board[0].tiles.length, 3);
  assert.equal(room.game.currentPlayerIndex, 1);
});

test('多人破冰不計鬼牌代表點數', () => {
  const room = {
    turnSeconds: 60,
    players: [
      { id: 'human', name: 'Jay', isAI: false, level: null },
      { id: 'ai', name: '電腦A', isAI: true, level: 'basic' },
    ],
  };
  room.game = createGameSession(room);
  room.game.currentPlayerIndex = 0;
  const invalidMeld = [
    { uid: 'red-12', color: 'red', number: 12, isJoker: false },
    { uid: 'blue-12', color: 'blue', number: 12, isJoker: false },
    { uid: 'joker', color: null, number: null, isJoker: true },
  ];
  const rest = [{ uid: 'rest', color: 'orange', number: 1, isJoker: false }];
  room.game.players[0].hand = [...invalidMeld, ...rest];

  assert.throws(
    () => applyHumanPlay(room, 'human', [{ id: 'joker-set', tiles: invalidMeld }], rest),
    /破冰出牌需達 30 點/,
  );
  assert.equal(room.game.players[0].hasMelded, false);
});
