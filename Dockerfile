# syntax=docker/dockerfile:1
# Debian slim (glibc) on purpose: ws' native optional deps (bufferutil, utf-8-validate) only ship
# glibc prebuilds, so an Alpine/musl base would fall back to node-gyp and need a compiler.

# ---------- deps ----------
FROM node:22-slim AS deps
# ws' optional native deps (bufferutil, utf-8-validate) have no prebuild for Debian's node ABI here,
# so node-gyp-build compiles them: the toolchain has to exist in this stage (it is discarded afterwards).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- build ----------
FROM node:22-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# BuildKit does NOT include secret contents in the cache key, so a changed .env.local would silently
# reuse a cached build (leaving stale NEXT_PUBLIC_* values inlined in the client bundle). This stamp
# comes from the env file's hash (see docker-compose.yml) and busts the cache when it changes.
ARG NEXT_PUBLIC_ENV_HASH=dev
ENV NEXT_PUBLIC_ENV_HASH=$NEXT_PUBLIC_ENV_HASH
COPY --from=deps /app/node_modules ./node_modules
COPY web/ ./
# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so the env file has to be
# present here. It is mounted as a BuildKit secret, so the service-role key never lands in an image layer.
RUN --mount=type=secret,id=env_local,target=/app/.env.local npm run build

# ---------- runtime ----------
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
