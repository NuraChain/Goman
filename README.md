# Goman — On-Chain Prediction Markets for Nura Chain

**Goman** is an open-source prediction-market application. Users trade shares in markets about real-world outcomes; market prices express the market's implied probability, and market activity is settled on chain.

Goman is configured for **Nura Chain**, an EVM-compatible network, and combines a web application, a Node.js service and a PostgreSQL index of the deployed market contracts.

## Features

- **Prediction markets:** create and follow markets for real-world outcomes.
- **Share trading:** buy and sell outcome shares; prices are presented as implied probabilities.
- **On-chain market infrastructure:** read market state and activity from Nura Chain smart contracts.
- **Wallet-authorised administration:** administrative transactions are signed by the operator's wallet in the browser. The server configuration states that the backend does not hold an administrator private key.
- **Market indexing:** a PostgreSQL-backed indexer follows contract events and serves indexed data to the application.
- **Market media:** store and serve market and outcome images.
- **Optional Telegram integration:** receive indexer notifications and scheduled database/image backups.

## Network

The example configuration targets Nura Chain:

| Setting | Value |
| --- | --- |
| Chain ID | 1020 |
| Native currency | NURA |
| JSON-RPC | [rpc.nurachain.net](https://rpc.nurachain.net) |
| Block explorer | [explorer.nurachain.net](https://explorer.nurachain.net) |

The configured factory contract and deployment start block are documented in [.env.example](.env.example). Use the addresses that match the chain deployment you intend to index; do not mix deployments from different chain resets.

## Technology

- TypeScript and Node.js
- PostgreSQL
- viem for EVM contract and JSON-RPC integration
- AzerothJS and Vite for the browser application
- Server-side rendering and prerendered pages
- Docker for container deployment

## Run locally

You need Node.js 24.11 or newer and a PostgreSQL database. The server and browser build share configuration in the root .env file.

~~~bash
git clone https://github.com/NuraChain/Goman.git
cd Goman
npm ci
cp .env.example .env
~~~

Review every setting in .env. In particular, configure the PostgreSQL connection, Nura Chain RPC endpoint, chain ID, market factory address, deployment start block and public site URL. The example file documents optional Telegram settings and the client-side VITE_ variables.

Start the development server:

~~~bash
npm run dev
~~~

| Command | Purpose |
| --- | --- |
| npm run dev | Start the server in development mode |
| npm run check | Run application and server checks |
| npm run build | Build the browser and server-rendering bundles |
| npm test | Run the project tests |
| npm start | Start the production server |

## Docker

The repository includes a multi-stage Dockerfile. Build-time VITE_ values are embedded in the client bundle; runtime server configuration is supplied through .env. Persist the configured upload directory with a Docker volume, and publish the service on loopback behind a reverse proxy.

## Project links

- [Nura Chain](https://nurachain.net)
- [Nura Chain RPC](https://rpc.nurachain.net)
- [Nura Chain Explorer](https://explorer.nurachain.net)
- [Nura Chain Smart Contracts](https://github.com/NuraChain/SmartContract)

## License

Licensed under the [MIT License](LICENSE).
