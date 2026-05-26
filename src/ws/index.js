import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { downloadQueue } from '../services/queue.js';

const clients = new Map();

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'Authentication required');
      return;
    }

    let user;
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      user = { id: payload.sub, role: payload.role };
    } catch {
      ws.close(4001, 'Invalid token');
      return;
    }

    if (!clients.has(user.id)) {
      clients.set(user.id, new Set());
    }
    clients.get(user.id).add(ws);

    ws.on('close', () => {
      const set = clients.get(user.id);
      if (set) {
        set.delete(ws);
        if (set.size === 0) clients.delete(user.id);
      }
    });

    ws.send(JSON.stringify({ type: 'connected', userId: user.id }));
  });

  downloadQueue.on('progress', ({ id, progress }) => {
    for (const [userId, sockets] of clients) {
      for (const ws of sockets) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'progress', downloadId: id, progress }));
        }
      }
    }
  });
}

export function notifyDownloadComplete(userId, data) {
  const sockets = clients.get(userId);
  if (!sockets) return;
  for (const ws of sockets) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'completed', ...data }));
    }
  }
}

export function notifyDownloadError(userId, data) {
  const sockets = clients.get(userId);
  if (!sockets) return;
  for (const ws of sockets) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'error', ...data }));
    }
  }
}
