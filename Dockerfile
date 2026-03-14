FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
# Allow native addon builds (better-sqlite3 requires compilation)
RUN echo '{"better-sqlite3": true, "protobufjs": true, "esbuild": true}' > /app/node_modules/.pnpm-approved-builds.json 2>/dev/null; \
    pnpm install --frozen-lockfile && \
    cd /app/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && \
    npx --yes prebuild-install || npx --yes node-gyp rebuild

COPY packages/server/ packages/server/
COPY packages/web/ packages/web/
RUN pnpm --filter @fragmint/web build

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++ git
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile --prod && \
    cd /app/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && \
    npx --yes prebuild-install || npx --yes node-gyp rebuild

COPY packages/server/ packages/server/
COPY --from=builder /app/packages/web/dist packages/web/dist

RUN mkdir -p /data/vault

EXPOSE 3210
ENV NODE_ENV=production
ENV FRAGMINT_STORE_PATH=/data/vault

CMD ["npx", "tsx", "packages/server/src/index.ts"]
