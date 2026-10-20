# One image, one process: the server runs the API and the indexer, and serves the built client.
#
#   docker build -t goman .
#   docker run -d --name goman --restart unless-stopped --env-file server/.env \
#     -e HOST=0.0.0.0 -e PORT=4500 -p 127.0.0.1:4500:4500 \
#     -v goman-data:/app/server/.data -v goman-uploads:/app/server/uploads goman
#
# The -e flags win over server/.env: a loopback HOST from it would leave the server unreachable
# from outside the container. It is published on the host's loopback only; nginx proxies to it.
# The client's VITE_* values are build args: `docker build --build-arg VITE_SITE_URL=... .`

# --- build: the client bundle, its SSR half, and the prerendered pages ---
FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY application/package.json application/
COPY server/package.json server/
RUN npm ci

COPY . .

# Vite inlines these at BUILD time, so they are build args, not runtime env. The defaults are
# the live Nurachain values from application/.env.example.
ARG VITE_RPC_URL=https://rpc.nurachain.net
ARG VITE_CHAIN_ID=1020
ARG VITE_CHAIN_NAME=Nurachain
ARG VITE_CURRENCY_SYMBOL=NURA
ARG VITE_CURRENCY_DECIMALS=18
ARG VITE_EXPLORER_URL=https://explorer.nurachain.net
ARG VITE_DEPLOY_BLOCK=66806
ARG VITE_ADMIN_ADDRESS=
ARG VITE_SITE_URL=
ENV VITE_RPC_URL=$VITE_RPC_URL \
    VITE_CHAIN_ID=$VITE_CHAIN_ID \
    VITE_CHAIN_NAME=$VITE_CHAIN_NAME \
    VITE_CURRENCY_SYMBOL=$VITE_CURRENCY_SYMBOL \
    VITE_CURRENCY_DECIMALS=$VITE_CURRENCY_DECIMALS \
    VITE_EXPLORER_URL=$VITE_EXPLORER_URL \
    VITE_DEPLOY_BLOCK=$VITE_DEPLOY_BLOCK \
    VITE_ADMIN_ADDRESS=$VITE_ADMIN_ADDRESS \
    VITE_SITE_URL=$VITE_SITE_URL

RUN npm run build

# --- runtime: production dependencies, the server source, the built client ---
FROM node:24-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY application/package.json application/
COPY server/package.json server/
RUN npm ci --omit=dev && npm cache clean --force

# No build step for the server - Node 24 runs the TypeScript source directly.
COPY server/src server/src
COPY --from=build /app/application/dist application/dist
COPY --from=build /app/application/dist-server application/dist-server

# The working directory is the SERVER directory: CLIENT_DIR, SSR_ENTRY, DB_PATH and UPLOAD_DIR
# all resolve against it, as in a local checkout.
WORKDIR /app/server
RUN mkdir -p .data uploads logs && chown -R node:node .data uploads logs
USER node

# The sqlite index (it also holds the admin settings) and the uploaded art must survive a
# redeploy. Logs go to stdout too, so the logs volume is optional.
VOLUME ["/app/server/.data", "/app/server/uploads"]

ENV HOST=0.0.0.0 \
    PORT=4500
EXPOSE 4500

CMD ["node", "--import", "./src/deploy-env.ts", "src/main.ts"]
