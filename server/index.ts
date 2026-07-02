// Colyseus server bootstrap (spec §9.1, §9.7, §9.8). Defines the single room type 'match'
// (one room = one match). The room is a transport/authority wrapper around the pure
// `@cardgame/shared` engine — no game rules live here.
//
// Single-service deploy (§9.8, decision #41): in production this same process ALSO serves the
// built React client (client/dist) over HTTP, so the browser opens its WebSocket back to the
// same origin — one Railway service, one domain, no CORS. Colyseus wraps the Express request
// listener: '/matchmake' HTTP requests go to Colyseus, everything else falls through to
// Express (static files), and WebSocket upgrades ride the same port.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { MatchRoom } from './rooms/MatchRoom';

const PORT = Number(process.env.PORT ?? 2567);

// Serve the built client. In dev this folder may not exist (Vite serves the client on :5173);
// express.static simply no-ops on a missing dir, so dev is unaffected.
const app = express();
const clientDist = fileURLToPath(new URL('../client/dist', import.meta.url));
app.use(express.static(clientDist));
// SPA fallback: any non-asset, non-matchmake path returns index.html so client-side routing
// and hard refreshes work. (Colyseus already intercepts '/matchmake' before Express sees it.)
app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

// 'match' is the only room definition; clients create/join it by room id (= the join code).
gameServer.define('match', MatchRoom);

gameServer
  .listen(PORT)
  .then(() => {
    console.log(`[cardgame] listening on :${PORT} (ws + static client)`);
  })
  .catch((err) => {
    console.error('[cardgame] failed to start server:', err);
    process.exit(1);
  });
