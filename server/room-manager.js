import { randomBytes, randomUUID } from 'node:crypto';

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 4;

function createRoomCode() {
  const bytes = randomBytes(4);
  return Array.from(bytes, (byte) => ROOM_CODE_CHARS[byte % ROOM_CODE_CHARS.length]).join('');
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    players: room.players.map(({ id, name }) => ({ id, name })),
  };
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.memberships = new Map();
  }

  createRoom(name, socket) {
    let code;
    do code = createRoomCode(); while (this.rooms.has(code));

    const player = { id: randomUUID(), name, socket };
    const room = { code, hostId: player.id, players: [player] };
    this.rooms.set(code, room);
    this.memberships.set(socket, { code, playerId: player.id });
    return { room: publicRoom(room), playerId: player.id };
  }

  joinRoom(code, name, socket) {
    const room = this.rooms.get(code);
    if (!room) throw new Error('找不到房間');
    if (room.players.length >= MAX_PLAYERS) throw new Error('房間人數已滿');
    if (room.players.some((player) => player.name === name)) throw new Error('房間內已有相同暱稱');

    const player = { id: randomUUID(), name, socket };
    room.players.push(player);
    this.memberships.set(socket, { code, playerId: player.id });
    return { room: publicRoom(room), playerId: player.id };
  }

  leave(socket) {
    const membership = this.memberships.get(socket);
    if (!membership) return null;
    this.memberships.delete(socket);

    const room = this.rooms.get(membership.code);
    if (!room) return null;
    room.players = room.players.filter((player) => player.id !== membership.playerId);

    if (room.players.length === 0) {
      this.rooms.delete(room.code);
      return null;
    }

    if (room.hostId === membership.playerId) room.hostId = room.players[0].id;
    return room;
  }

  broadcast(room) {
    const message = JSON.stringify({ type: 'room:state', payload: publicRoom(room) });
    for (const player of room.players) {
      if (player.socket.readyState === 1) player.socket.send(message);
    }
  }
}

export function normalizePlayerName(value) {
  if (typeof value !== 'string') throw new Error('請輸入玩家暱稱');
  const name = value.trim();
  if (name.length < 1 || name.length > 12) throw new Error('暱稱需為 1～12 個字元');
  return name;
}

export function normalizeRoomCode(value) {
  if (typeof value !== 'string') throw new Error('請輸入房號');
  const code = value.trim().toUpperCase();
  if (!/^[A-Z2-9]{4}$/.test(code)) throw new Error('房號格式不正確');
  return code;
}
