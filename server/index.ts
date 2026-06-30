import { createServer } from 'node:http';
import express from 'express';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { MatchRoom } from './rooms/MatchRoom';

const port = Number(process.env.PORT ?? 2567);

const app = express();
app.get('/health', (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define('match', MatchRoom);

gameServer
  .listen(port)
  .then(() => console.log(`▶ Auto-battler server listening on ws://localhost:${port}`))
  .catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
