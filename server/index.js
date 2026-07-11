import http from 'node:http';
import { WebSocketServer } from 'ws';

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
    webSocket.send(JSON.stringify({
      type: 'echo',
      data: data.toString(),
    }));
  });
});

const port = Number(process.env.PORT) || 10000;

server.listen(port, '0.0.0.0', () => {
  console.log(`Rummikub WebSocket server listening on port ${port}`);
});
