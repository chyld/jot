# syntax=docker/dockerfile:1

# ---- all dependencies (build tools available for native modules) ----
FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---- production-only dependencies ----
FROM deps AS prod-deps
RUN npm prune --omit=dev

# ---- dev / test runner image: full source and all dependencies ----
FROM deps AS dev
COPY . .
# Tests run as the host user; vitest writes a temp config file and a cache under /app.
RUN chmod -R a+rX /app && chmod 777 /app \
 && mkdir -p /app/node_modules/.vite /app/node_modules/.vitest && chmod -R 777 /app/node_modules/.vite /app/node_modules/.vitest
ENV DATA_DIR=/tmp/jot-data
CMD ["npm", "run", "test:unit"]

# ---- frontend build ----
FROM dev AS build
RUN npm run build

# ---- runtime ----
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=9003 \
    DATA_DIR=/data
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY src/server ./src/server
COPY src/shared ./src/shared
COPY src/cli ./src/cli
COPY assets ./assets
COPY --from=build /app/dist/client ./dist/client
COPY bin/jot /usr/local/bin/jot
RUN chmod 755 /usr/local/bin/jot && chmod -R a+rX /app
EXPOSE 9003
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:9003/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/server/main.ts"]
