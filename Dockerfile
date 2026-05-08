FROM node:24-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++ pandoc
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --ignore-scripts && \
    cd $(find /app/node_modules/.pnpm -name "binding.gyp" -path "*/better-sqlite3*" | head -1 | xargs dirname) && \
    npx node-gyp rebuild

COPY packages/server/ packages/server/
COPY packages/web/ packages/web/
RUN pnpm --filter @fragmint/web build

FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++ git pandoc
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --ignore-scripts --prod && \
    cd $(find /app/node_modules/.pnpm -name "binding.gyp" -path "*/better-sqlite3*" | head -1 | xargs dirname) && \
    npx node-gyp rebuild

COPY packages/server/ packages/server/
COPY --from=builder /app/packages/web/dist packages/web/dist

RUN mkdir -p /data/vault

RUN git config --global user.email 'fragmint@localhost' && \
    git config --global user.name 'Fragmint'

EXPOSE 3210
ENV NODE_ENV=production
ENV FRAGMINT_STORE_PATH=/data/vault

CMD ["npx", "tsx", "packages/server/src/index.ts"]
