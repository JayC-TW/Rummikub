import http from 'node:http';
import { WebSocketServer } from 'ws';
import { RoomManager, normalizePlayerName, normalizeRoomCode } from './room-manager.js';
import { applyHumanDraw, applyHumanPlay, applyPreparedAiTurn, prepareAiTurn } from './game-session.js';

const allowedOrigins = new Set([
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'https://jayc-tw.github.io',
]);

const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ error: 'not_found' }));
});

const wss = new WebSocketServer({ noServer: true });
const rooms = new RoomManager();

function armTurnClock(room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;
  if (!room.game || room.game.gameOver || room.game.turnSeconds === null) {
    if (room.game) room.game.turnDeadline = null;
    return;
  }
  room.game.turnDeadline = Date.now() + room.game.turnSeconds * 1000;
  room.turnTimer = setTimeout(() => {
    room.turnTimer = null;
    const player = room.game.players[room.game.currentPlayerIndex];
    if (!player || room.game.gameOver) return;
    if (player.isAI) {
      scheduleAiTurn(room);
      return;
    }
    try {
      applyHumanDraw(room, player.id);
      armTurnClock(room);
      rooms.broadcastGame(room);
      scheduleAiTurn(room);
    } catch {
      // 牌局已在計時器觸發前推進，不再處理此逾時。
    }
  }, room.game.turnSeconds * 1000);
}

function scheduleAiTurn(room) {
  if (room.aiTimer || !room.game || room.game.gameOver) return;
  const prepared = prepareAiTurn(room);
  if (!prepared) return;
  room.aiTimer = setTimeout(() => {
    room.aiTimer = null;
    if (!applyPreparedAiTurn(room, prepared)) return;
    armTurnClock(room);
    rooms.broadcastGame(room);
    scheduleAiTurn(room);
  }, prepared.action.thinkMs);
}

function broadcastDeparture(room) {
  if (!room) return;
  rooms.broadcast(room);
  if (room.started && room.game) {
    rooms.broadcastGame(room);
    scheduleAiTurn(room);
  }
}

server.on('upgrade', (request, socket, head) => {
  if (request.url !== '/ws') {
    socket.destroy();
    return;
  }

  const origin = request.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (webSocket) => {
    wss.emit('connection', webSocket, request);
  });
});

wss.on('connection', (webSocket) => {
  webSocket.send(JSON.stringify({
    type: 'connection:ready',
    timestamp: Date.now(),
  }));

  webSocket.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
      const payload = message.payload ?? {};

      if (message.type === 'room:create') {
        rooms.leave(webSocket);
        const result = rooms.createRoom(normalizePlayerName(payload.playerName), webSocket, {
          maxPlayers: payload.maxPlayers,
          aiLevels: payload.aiLevels,
          turnSeconds: payload.turnSeconds,
        });
        webSocket.send(JSON.stringify({ type: 'room:joined', payload: result }));
        rooms.broadcast(rooms.rooms.get(result.room.code));
        return;
      }

      if (message.type === 'room:join') {
        rooms.leave(webSocket);
        const result = rooms.joinRoom(
          normalizeRoomCode(payload.roomCode),
          normalizePlayerName(payload.playerName),
          webSocket,
        );
        webSocket.send(JSON.stringify({ type: 'room:joined', payload: result }));
        rooms.broadcast(rooms.rooms.get(result.room.code));
        return;
      }

      if (message.type === 'room:leave') {
        const room = rooms.leave(webSocket);
        broadcastDeparture(room);
        webSocket.send(JSON.stringify({ type: 'room:left' }));
        return;
      }

      if (message.type === 'game:start') {
        const room = rooms.start(webSocket);
        armTurnClock(room);
        rooms.broadcast(room);
        rooms.broadcastGame(room);
        scheduleAiTurn(room);
        return;
      }

      if (message.type === 'game:sync') {
        const { state } = rooms.gameFor(webSocket);
        webSocket.send(JSON.stringify({ type: 'game:started', payload: state }));
        return;
      }

      if (message.type === 'game:restart') {
        const room = rooms.restart(webSocket);
        armTurnClock(room);
        rooms.broadcastGame(room);
        scheduleAiTurn(room);
        return;
      }

      if (message.type === 'turn:draw') {
        const { room, playerId } = rooms.gameFor(webSocket);
        applyHumanDraw(room, playerId);
        armTurnClock(room);
        rooms.broadcastGame(room);
        scheduleAiTurn(room);
        return;
      }

      if (message.type === 'turn:play') {
        const { room, playerId } = rooms.gameFor(webSocket);
        applyHumanPlay(room, playerId, payload.board, payload.hand);
        armTurnClock(room);
        rooms.broadcastGame(room);
        scheduleAiTurn(room);
        return;
      }

      throw new Error('不支援的操作');
    } catch (error) {
      webSocket.send(JSON.stringify({
        type: 'action:rejected',
        payload: { message: error instanceof Error ? error.message : '訊息格式錯誤' },
      }));
    }
  });

  webSocket.on('close', () => {
    const room = rooms.leave(webSocket);
    broadcastDeparture(room);
  });
});

const port = Number(process.env.PORT) || 10000;

server.listen(port, '0.0.0.0', () => {
  console.log(`Rummikub WebSocket server listening on port ${port}`);
});
