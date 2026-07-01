// Colyseus server bootstrap (spec §9.1, §9.7). Listens on ws://localhost:2567 and defines the
// single room type 'match' (one room = one match). The room is a transport/authority wrapper
// around the pure `@cardgame/shared` engine — no game rules live here.

import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { MatchRoom } from './rooms/MatchRoom';

const PORT = Number(process.env.PORT ?? 2567);

const gameServer = new Server({
  transport: new WebSocketTransport(),
});

// 'match' is the only room definition; clients create/join it by room id (= the join code).
gameServer.define('match', MatchRoom);

gameServer
  .listen(PORT)
  .then(() => {
    console.log(`[cardgame] Colyseus listening on ws://localhost:${PORT}`);
  })
  .catch((err) => {
    console.error('[cardgame] failed to start server:', err);
    process.exit(1);
  });
