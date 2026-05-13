FROM node:24-alpine AS dev
WORKDIR /app
RUN apk add --no-cache python3 make g++ git pandoc
RUN corepack enable && corepack prepare pnpm@latest --activate

# Pre-fetch Node headers from nodejs.org/dist. node-gyp would otherwise fetch
# them from unofficial-builds.nodejs.org (musl default), which is unreachable
# from Docker's default bridge network on some hosts.
RUN NODE_VERSION=$(node -v | tr -d v) && \
    mkdir -p /tmp/node-headers && \
    wget --tries=5 --timeout=30 -q -O /tmp/headers.tar.gz \
      "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-headers.tar.gz" && \
    tar -xzf /tmp/headers.tar.gz -C /tmp/node-headers --strip-components 1 && \
    rm /tmp/headers.tar.gz

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/cli/package.json packages/cli/
COPY packages/mcp/package.json packages/mcp/
COPY packages/obsidian/package.json packages/obsidian/
RUN pnpm install --ignore-scripts && \
    cd $(find /app/node_modules/.pnpm -name "binding.gyp" -path "*/better-sqlite3*" | head -1 | xargs dirname) && \
    npx node-gyp rebuild --nodedir=/tmp/node-headers

COPY packages/server/ packages/server/

RUN mkdir -p /data/vault && \
    git config --global user.email 'fragmint@localhost' && \
    git config --global user.name 'Fragmint'

EXPOSE 3210
ENV NODE_ENV=development
ENV FRAGMINT_STORE_PATH=/data/vault

WORKDIR /app/packages/server
CMD ["node_modules/.bin/tsx", "watch", "src/index.ts"]

FROM node:24-alpine AS web-dev
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/cli/package.json packages/cli/
COPY packages/mcp/package.json packages/mcp/
COPY packages/obsidian/package.json packages/obsidian/
RUN pnpm install --ignore-scripts

COPY packages/web/ packages/web/

EXPOSE 5173
WORKDIR /app/packages/web
CMD ["node_modules/.bin/vite", "--host"]

FROM node:24-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++ pandoc
RUN corepack enable && corepack prepare pnpm@latest --activate

# Pre-fetch musl Node headers (see comment in `dev` stage).
RUN NODE_VERSION=$(node -v | tr -d v) && \
    mkdir -p /tmp/node-headers && \
    wget --tries=5 --timeout=30 -q -O /tmp/headers.tar.gz \
      "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-headers.tar.gz" && \
    tar -xzf /tmp/headers.tar.gz -C /tmp/node-headers --strip-components 1 && \
    rm /tmp/headers.tar.gz

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --ignore-scripts && \
    cd $(find /app/node_modules/.pnpm -name "binding.gyp" -path "*/better-sqlite3*" | head -1 | xargs dirname) && \
    npx node-gyp rebuild --nodedir=/tmp/node-headers

COPY packages/server/ packages/server/
COPY packages/web/ packages/web/
RUN pnpm --filter @fragmint/web build

FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++ git pandoc
RUN corepack enable && corepack prepare pnpm@latest --activate

# Pre-fetch musl Node headers (see comment in `dev` stage).
RUN NODE_VERSION=$(node -v | tr -d v) && \
    mkdir -p /tmp/node-headers && \
    wget --tries=5 --timeout=30 -q -O /tmp/headers.tar.gz \
      "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-headers.tar.gz" && \
    tar -xzf /tmp/headers.tar.gz -C /tmp/node-headers --strip-components 1 && \
    rm /tmp/headers.tar.gz

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --ignore-scripts --prod && \
    cd $(find /app/node_modules/.pnpm -name "binding.gyp" -path "*/better-sqlite3*" | head -1 | xargs dirname) && \
    npx node-gyp rebuild --nodedir=/tmp/node-headers

COPY packages/server/ packages/server/
COPY --from=builder /app/packages/web/dist packages/web/dist

RUN mkdir -p /data/vault

RUN git config --global user.email 'fragmint@localhost' && \
    git config --global user.name 'Fragmint'

EXPOSE 3210
ENV NODE_ENV=production
ENV FRAGMINT_STORE_PATH=/data/vault

CMD ["npx", "tsx", "packages/server/src/index.ts"]
