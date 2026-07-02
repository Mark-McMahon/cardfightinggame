# syntax=docker/dockerfile:1

# One image, one service (design-spec §9.8): build the static React client, then run the
# Colyseus server, which serves that build AND the WebSocket game on a SINGLE port. Railway
# injects $PORT; the server reads it (server/index.ts).
#
# NOTE: the server runs TypeScript directly via `tsx` and imports `@cardgame/shared` as raw
# .ts (no compile/dist step, by design). So the runtime image keeps the full install + all
# sources — this is deliberately not a slim "copy dist/ only" image.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH="/pnpm:$PATH"
RUN corepack enable
WORKDIR /app

# 1. Install deps from manifests first so this layer is cached until a manifest/lockfile
#    changes (not on every source edit). Copy every workspace's package.json.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
COPY sim/package.json ./sim/
RUN pnpm install --frozen-lockfile

# 2. Copy the monorepo and build the client bundle -> client/dist (served by the server).
COPY . .
RUN pnpm build:client

# 3. Run the server. It binds 0.0.0.0:$PORT and serves client/dist + ws on that one port.
ENV NODE_ENV=production
EXPOSE 2567
CMD ["pnpm", "--filter", "@cardgame/server", "start"]
