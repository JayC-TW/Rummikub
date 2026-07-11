import { randomBytes, randomUUID } from 'node:crypto';
import { createGameSession, gameViewFor } from './game-session.js';

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 4;
const AI_LEVELS = new Set(['basic', 'intermediate', 'advanced']);

function createRoomCode() {
  const bytes = randomBytes(4);
  return Array.from(bytes, (byte) => ROOM_CODE_CHARS[byte % ROOM_CODE_CHARS.length]).join('');
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    aiLevels: room.aiLevels,
    turnSeconds: room.turnSeconds,
    started: room.started,
    players: room.players.map(({ id, name, isAI, level }) => ({ id, name, isAI, level })),
  };
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.memberships = new Map();
  }

  createRoom(name, socket, config) {
    let code;
    do code = createRoomCode(); while (this.rooms.has(code));

    const player = { id: randomUUID(), name, socket, isAI: false, level: null };
    const room = {
      code,
      hostId: player.id,
      players: [player],
      maxPlayers: normalizeMaxPlayers(config?.maxPlayers),
      aiLevels: normalizeAiLevels(config?.aiLevels),
      turnSeconds: normalizeTurnSeconds(config?.turnSeconds),
      started: false,
    };
    this.rooms.set(code, room);
    this.memberships.set(socket, { code, playerId: player.id });
    return { room: publicRoom(room), playerId: player.id };
  }

  joinRoom(code, name, socket) {
    const room = this.rooms.get(code);
    if (!room) throw new Error('找不到房間');
    if (room.started) throw new Error('遊戲已開始，無法加入');
    if (room.players.length >= room.maxPlayers) throw new Error('房間人數已滿');
    if (room.players.some((player) => player.name === name)) throw new Error('房間內已有相同暱稱');

    const player = { id: randomUUID(), name, socket, isAI: false, level: null };
    room.players.push(player);
    this.memberships.set(socket, { code, playerId: player.id });
    return { room: publicRoom(room), playerId: player.id };
  }

  start(socket) {
    const membership = this.memberships.get(socket);
    if (!membership) throw new Error('你尚未加入房間');
    const room = this.rooms.get(membership.code);
    if (!room) throw new Error('找不到房間');
    if (room.hostId !== membership.playerId) throw new Error('只有房主可以開始遊戲');
    if (room.started) throw new Error('遊戲已經開始');

    while (room.players.length < room.maxPlayers) {
      const seatIndex = room.players.length;
      const aiNumber = room.players.filter((player) => player.isAI).length;
      room.players.push({
        id: randomUUID(),
        name: `電腦${String.fromCharCode(65 + aiNumber)}`,
        socket: null,
        isAI: true,
        level: room.aiLevels[seatIndex - 1] ?? 'intermediate',
      });
    }
    room.started = true;
    room.game = createGameSession(room);
    return room;
  }

  leave(socket) {
    const membership = this.memberships.get(socket);
    if (!membership) return null;
    this.memberships.delete(socket);

    const room = this.rooms.get(membership.code);
    if (!room) return null;
    const playerIndex = room.players.findIndex((player) => player.id === membership.playerId);
    if (playerIndex === -1) return room;

    if (room.started) {
      const player = room.players[playerIndex];
      const replacement = {
        ...player,
        name: `${player.name}（電腦接手）`,
        socket: null,
        isAI: true,
        level: player.level ?? 'intermediate',
      };
      room.players[playerIndex] = replacement;
      const gamePlayer = room.game?.players.find((candidate) => candidate.id === player.id);
      if (gamePlayer) {
        gamePlayer.name = replacement.name;
        gamePlayer.isAI = true;
        gamePlayer.level = replacement.level;
      }
      return room;
    }

    room.players.splice(playerIndex, 1);

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
      if (player.socket?.readyState === 1) player.socket.send(message);
    }
  }

  broadcastGame(room) {
    for (const player of room.players) {
      if (player.socket?.readyState !== 1) continue;
      const state = gameViewFor(room, player.id);
      player.socket.send(JSON.stringify({ type: 'game:started', payload: state }));
    }
  }

  gameFor(socket) {
    const membership = this.memberships.get(socket);
    if (!membership) throw new Error('你尚未加入房間');
    const room = this.rooms.get(membership.code);
    if (!room?.started || !room.game) throw new Error('遊戲尚未開始');
    return { room, playerId: membership.playerId, state: gameViewFor(room, membership.playerId) };
  }
}

export function normalizeMaxPlayers(value) {
  const maxPlayers = Number(value);
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > MAX_PLAYERS) {
    throw new Error('最多玩家人數需為 2～4 人');
  }
  return maxPlayers;
}

export function normalizeAiLevels(value) {
  if (!Array.isArray(value) || value.length !== MAX_PLAYERS - 1) {
    throw new Error('電腦等級設定不完整');
  }
  if (value.some((level) => !AI_LEVELS.has(level))) throw new Error('電腦等級不正確');
  return value.slice();
}

export function normalizeTurnSeconds(value) {
  if (value === null) return null;
  const seconds = Number(value);
  if (![30, 60, 120].includes(seconds)) throw new Error('回合限時設定不正確');
  return seconds;
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
