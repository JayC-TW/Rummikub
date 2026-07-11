const WS_URL = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? 'ws://localhost:10000/ws'
  : 'wss://rummikub-ws.onrender.com/ws';

let socket = null;
let handlers = {};

export function connectMultiplayer(nextHandlers = {}) {
  handlers = nextHandlers;
  if (socket?.readyState === WebSocket.OPEN) return Promise.resolve();

  return new Promise((resolve, reject) => {
    socket = new WebSocket(WS_URL);
    socket.addEventListener('open', () => {
      handlers.onStatus?.('connected');
      resolve();
    }, { once: true });
    socket.addEventListener('error', () => reject(new Error('無法連線多人伺服器')), { once: true });
    socket.addEventListener('close', () => handlers.onStatus?.('disconnected'));
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.type === 'room:joined') handlers.onJoined?.(message.payload);
      if (message.type === 'room:state') handlers.onRoomState?.(message.payload);
      if (message.type === 'game:started') handlers.onGameStarted?.(message.payload);
      if (message.type === 'room:left') handlers.onLeft?.();
      if (message.type === 'action:rejected') handlers.onError?.(message.payload.message);
    });
  });
}

function send(type, payload = {}) {
  if (socket?.readyState !== WebSocket.OPEN) throw new Error('多人伺服器尚未連線');
  socket.send(JSON.stringify({ type, payload }));
}

export const createRoom = (playerName, config) => send('room:create', { playerName, ...config });
export const joinRoom = (roomCode, playerName) => send('room:join', { roomCode, playerName });
export const leaveRoom = () => send('room:leave');
export const startMultiplayerGame = () => send('game:start');
export const syncMultiplayerGame = () => send('game:sync');
