import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomManager, normalizePlayerName, normalizeRoomCode } from '../server/room-manager.js';

const config = { maxPlayers: 4, aiLevels: ['basic', 'intermediate', 'advanced'], turnSeconds: 60 };

function socket() {
  return { readyState: 1, messages: [], send(message) { this.messages.push(JSON.parse(message)); } };
}

test('建立、加入與廣播房間狀態', () => {
  const manager = new RoomManager();
  const hostSocket = socket();
  const guestSocket = socket();
  const created = manager.createRoom('Jay', hostSocket, config);
  const joined = manager.joinRoom(created.room.code, 'Amy', guestSocket);

  assert.equal(joined.room.players.length, 2);
  assert.equal(joined.room.turnSeconds, 60);
  manager.broadcast(manager.rooms.get(created.room.code));
  assert.equal(hostSocket.messages.at(-1).payload.players.length, 2);
  assert.equal(guestSocket.messages.at(-1).payload.players.length, 2);
});

test('房主離開後轉移房主，空房會清除', () => {
  const manager = new RoomManager();
  const hostSocket = socket();
  const guestSocket = socket();
  const created = manager.createRoom('Jay', hostSocket, config);
  const joined = manager.joinRoom(created.room.code, 'Amy', guestSocket);

  const remainingRoom = manager.leave(hostSocket);
  assert.equal(remainingRoom.hostId, joined.playerId);
  manager.leave(guestSocket);
  assert.equal(manager.rooms.size, 0);
});

test('拒絕第五位玩家與重複暱稱', () => {
  const manager = new RoomManager();
  const created = manager.createRoom('A', socket(), config);
  assert.throws(() => manager.joinRoom(created.room.code, 'A', socket()), /相同暱稱/);
  manager.joinRoom(created.room.code, 'B', socket());
  manager.joinRoom(created.room.code, 'C', socket());
  manager.joinRoom(created.room.code, 'D', socket());
  assert.throws(() => manager.joinRoom(created.room.code, 'E', socket()), /人數已滿/);
});

test('開始時依人數與等級補滿電腦並鎖房', () => {
  const manager = new RoomManager();
  const hostSocket = socket();
  const created = manager.createRoom('Jay', hostSocket, config);
  manager.joinRoom(created.room.code, 'Amy', socket());
  const room = manager.start(hostSocket);

  assert.equal(room.started, true);
  assert.equal(room.players.length, 4);
  assert.equal(room.game.players.every((player) => player.hand.length === 14), true);
  assert.equal(room.game.deck.length, 50);
  assert.deepEqual(room.players.slice(2).map((player) => player.level), ['intermediate', 'advanced']);
  assert.throws(() => manager.joinRoom(created.room.code, 'Bob', socket()), /遊戲已開始/);
});

test('開局狀態只向玩家公開自己的手牌', () => {
  const manager = new RoomManager();
  const hostSocket = socket();
  const guestSocket = socket();
  const created = manager.createRoom('Jay', hostSocket, config);
  manager.joinRoom(created.room.code, 'Amy', guestSocket);
  const room = manager.start(hostSocket);
  manager.broadcastGame(room);

  const hostView = hostSocket.messages.at(-1).payload;
  const guestView = guestSocket.messages.at(-1).payload;
  assert.equal(hostView.players[0].hand.length, 14);
  assert.equal(hostView.players.slice(1).every((player) => player.hand.length === 0), true);
  assert.equal(guestView.players[0].hand.length, 14);
  assert.notDeepEqual(hostView.players[0].hand, guestView.players[0].hand);
});

test('房主可在漏接開局事件後重新同步牌局', () => {
  const manager = new RoomManager();
  const hostSocket = socket();
  manager.createRoom('Jay', hostSocket, config);
  const room = manager.start(hostSocket);
  const synced = manager.gameFor(hostSocket);
  assert.equal(synced.room.code, room.code);
  assert.equal(synced.state.players[0].hand.length, 14);
});

test('遊戲開始後斷線玩家由中級電腦原座位接手', () => {
  const manager = new RoomManager();
  const hostSocket = socket();
  const created = manager.createRoom('Jay', hostSocket, config);
  manager.start(hostSocket);
  const room = manager.leave(hostSocket);

  assert.equal(room.players[0].isAI, true);
  assert.equal(room.players[0].level, 'intermediate');
  assert.match(room.players[0].name, /電腦接手/);
  assert.equal(room.game.players[0].isAI, true);
  assert.equal(room.game.players[0].level, 'intermediate');
});

test('正規化暱稱與房號', () => {
  assert.equal(normalizePlayerName(' Jay '), 'Jay');
  assert.equal(normalizeRoomCode(' ab2d '), 'AB2D');
  assert.throws(() => normalizePlayerName(''), /暱稱/);
  assert.throws(() => normalizeRoomCode('ABC'), /房號/);
});
