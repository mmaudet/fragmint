FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile

COPY packages/server/ packages/server/
COPY packages/web/ packages/web/
RUN pnpm --filter @fragmint/web build

FROM node:20-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile --prod

COPY packages/server/ packages/server/
COPY --from=builder /app/packages/web/dist packages/web/dist

RUN mkdir -p /data/vault

EXPOSE 3210
ENV NODE_ENV=production
ENV FRAGMINT_STORE_PATH=/data/vault

CMD ["npx", "tsx", "packages/server/src/index.ts"]
