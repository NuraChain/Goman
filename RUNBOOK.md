# Goman local runbook

Everything in this app is REAL data: markets live on an EVM chain, the server is a chain
indexer, and the frontend reads only what the indexer derived from chain state. This is how
you run the whole stack on your machine - and how you trade on it with MetaMask.

## The architecture in one picture

```
hardhat node (chain, port 8545)
    ^   ^
    |   '-- your wallet signs writes: buy / claim / admin actions
    '------ indexer (server, port 6000): scans events -> sqlite -> serves /api
                ^
                '-- application (vite, port 6001): reads /api, writes via the wallet
```

- The chain is the source of truth. The indexer is a cache you can delete at any time.
- The sqlite file lives at `server/.data/index.db`. The indexer stamps the chain's genesis
  hash into it; if you restart the chain, the index notices the mismatch and rebuilds
  itself from block 0 automatically - a stale index can never survive a fresh chain.

## Quick start (4 commands, 2 terminals)

The chain half now lives in the `auctionhouse-contracts` repository - clone it next to this
one. The three chain commands below are ITS scripts; only `npm run dev` belongs to this repo.

Terminal 1 - the chain (keeps running), from the contracts repo:

```
npm run node
```

Terminal 2 - deploy and seed from the contracts repo, then start the app from this one:

```
npm run deploy:local               # treasury + market implementation + factory
npm run seed                       # 150 markets, 400 trades, every lifecycle state
npm run dev                        # indexer (6000) + web (6001) together
```

Open http://localhost:6001. Everything READ-ONLY works with no wallet at all: browse,
search (English AND Persian), open markets, watch the charts, check the leaderboard.
A wallet is needed the moment you want to WRITE: buy shares, claim winnings, or admin.

Bigger world: `SEED_MARKETS=1000 SEED_TRADES=3000 npm run seed` in the contracts repo
(env-tunable; seeding runs
sequentially at roughly 20-40 tx/s locally, so 100k markets is possible but takes hours -
the indexer and the UI handle that size without changes).

## Trading with MetaMask, step by step

### 1. Install MetaMask

Install the MetaMask browser extension (metamask.io) and create any throwaway wallet - the
seed phrase it generates does not matter here, because you will import a test account in a
moment. Any EIP-6963 wallet works the same way (the Connect dialog shows a grid of every
wallet extension it detects); the steps below say MetaMask because it is the common one.

### 2. Add the local network

The app does this FOR you: the first time you confirm a write, it asks MetaMask to switch
to the local chain, and if MetaMask does not know the chain yet it offers to add it -
approve both prompts and you are done. If you prefer to add it by hand (or the prompt was
dismissed), in MetaMask go to the network picker, "Add a custom network", and enter:

| Field | Value |
|---|---|
| Network name | Local EVM |
| Default RPC URL | http://127.0.0.1:8545 |
| Chain ID | 31337 |
| Currency symbol | ETH |
| Block explorer | leave empty |

These are the defaults from `application/.env.example`; if you changed `VITE_CHAIN_*`
values there, enter YOUR values instead - the app and MetaMask must agree.

### 3. Import a test account

The local chain starts with 20 unlocked accounts, each holding 10,000 ETH. They come from
hardhat's well-known development mnemonic, so their keys are public knowledge:

> **NEVER send real funds to these accounts or reuse these keys outside a local chain.
> Everyone on the internet knows them.**

In MetaMask: account menu -> "Add account or hardware wallet" -> "Import account" -> paste
a private key:

| Account | Address | Private key | Use it for |
|---|---|---|---|
| #0 admin | `0xf39F...2266` | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` | Admin console + treasury |
| #1 trader | `0x7099...79c8` | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` | Trading; has seeded history |
| #2 trader | `0x3C44...93bc` | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` | Trading; has seeded history |

The seed script trades from accounts #1-#9, so importing a trader account shows a LIVE
portfolio immediately: open positions, profit/loss, resolved markets with claimable
winnings, and rows on the leaderboard. Import #0 when you want the admin side (below).

### 4. Connect and buy

1. Click **Connect** (top right), pick MetaMask in the wallet grid, and approve the
   connection prompt. The header shows your address and balance.
2. Open any open market, pick an outcome (Yes/No, or a named outcome on multi-outcome
   markets), and enter an amount. The panel quotes the shares you will receive before you
   commit - the quote comes from the market contract itself.
3. Click Buy and confirm in MetaMask. If MetaMask is on the wrong network, the app first
   asks it to switch (or add) the local chain - approve that, then confirm the trade.
   Buys are plain ETH transactions: there is no token, so there is no separate
   "approve" step.
4. The confirmation toast waits for the transaction AND for the indexer to ingest its
   block (typically 2-20 seconds), then everything refreshes: the chart, the activity
   feed, your portfolio. What you see is read back from chain events, not echoed from the
   form you submitted.

### 5. Claim winnings

When a market you hold shares in resolves your way (or is voided), its Portfolio row and
market page show a Claim button. Claiming is one transaction from the same account that
holds the shares; the seeded world already contains resolved markets with unclaimed
positions on accounts #1-#9, so you can try the flow without waiting for a resolution.

### 6. After you restart the chain: reset MetaMask's nonce

MetaMask remembers how many transactions each account has sent. A fresh chain starts that
count at zero again, so the FIRST write after a chain restart fails with a nonce error
("nonce too high" or a transaction that hangs forever). Fix it in MetaMask:

Settings -> Advanced -> **Clear activity tab data** (do it once per imported account you
have used).

That clears MetaMask's local transaction history and nonce cache for the selected network;
your imported accounts and the network entry stay. This is the single most common "it
suddenly stopped working" cause on local chains.

## Being the admin

The deployer (account #0 above) holds `ADMIN_ROLE` on the factory and owns the treasury.
Import its key (table in step 3) and connect with it, and an Admin entry appears in the
nav: create markets (bilingual title + emoji ride an on-chain JSON envelope; typing a new
category mints it), pause/resume/close, resolve or void through the confirming dialog,
feature markets for the home rail (a signed request the indexer verifies against the
on-chain role), manage default fees, and withdraw treasury fees.

Connected with any OTHER account, the admin route shows a gate instead - the role check is
on-chain, not a frontend switch.

## Environment variables

`server` (read from `server/.env` or the ambient environment):

| Variable | Default | Meaning |
|---|---|---|
| `RPC_URL` | `http://127.0.0.1:8545` | The chain's JSON-RPC endpoint |
| `CHAIN_ID` | `31337` | EVM chain id |
| `FACTORY_ADDRESS` | local deterministic address | The PredictionFactory to index |
| `DEPLOY_BLOCK` | `0` | First block the scan reads (set to the deploy block on a real chain) |
| `DB_PATH` | `.data/index.db` | The sqlite index file |
| `POLL_MS` | `1500` | How often the watcher polls for new blocks |
| `PORT` | `6000` | API port |
| `UPLOAD_DIR` | `uploads` | Where uploaded market/category art is written; served read-only at /uploads |

`application` (`application/.env`, read at BUILD time - restart `npm run dev` after edits):
`VITE_RPC_URL`, `VITE_CHAIN_ID`, `VITE_CHAIN_NAME`, `VITE_CURRENCY_SYMBOL`,
`VITE_CURRENCY_DECIMALS`, `VITE_EXPLORER_URL` - what the WALLET side of the app uses (the
network MetaMask is asked to add comes from these). Contract addresses are NOT frontend
env: the app asks the indexer (`/api/chain`).

The contracts repo has its own `.env`: `RPC_URL` + `PRIVATE_KEY` for `npm run deploy`
against a real Cosmos EVM chain.

## Pointing at a real chain

1. In the contracts repo: `.env` with your RPC + deployer key, then `npm run deploy`.
2. Server env: `RPC_URL`, `CHAIN_ID`, `FACTORY_ADDRESS` and `DEPLOY_BLOCK` from that repo's
   `deployments/<chainId>.json`.
3. `application/.env`: the same chain's `VITE_*` values so wallets switch networks correctly.
4. Start the server; it backfills from `DEPLOY_BLOCK` and then follows the head.

On a real chain you connect with your REAL wallet account - the test keys above must never
leave the local setup.

## Resetting

- Fresh world, same chain: kill the chain, start it again, redeploy, reseed. The genesis
  guard wipes the index by itself. Then clear MetaMask's activity data (step 6 above) or
  your first write will hit the nonce error.
- Just the index: stop the server, delete `server/.data/`, start it - full resync.

## Storage note (sqlite vs Postgres)

The index is SQLite (`node:sqlite`, zero setup) because this workload is a single-writer
scanner with read-heavy queries on one machine - 100k markets is small for it. Every SQL
statement lives in ONE module, `server/src/chain/store.ts`; if the project outgrows a
single node (multiple API replicas, concurrent writers), that file is the entire surface a
Postgres/TypeORM port has to replace.

## Troubleshooting

- **"No chain at http://127.0.0.1:8545"** - start the contracts repo's `npm run node`
  first; the server retries
  for 2 minutes, then exits with this message.
- **Port already bound (8545/6000/6001)** - a previous run is still alive; kill it
  (`Get-NetTCPConnection -LocalPort 8545 -State Listen` on Windows shows the PID).
- **MetaMask is not in the Connect grid** - the extension is not installed, is disabled for
  this browser profile, or is locked; unlock it and reload the page. The grid only lists
  wallets that announce themselves (EIP-6963).
- **First write fails with a nonce error, or the transaction spins forever** - the chain
  was restarted since MetaMask last wrote; Settings -> Advanced -> Clear activity tab data
  (see the MetaMask section, step 6).
- **Wallet on the wrong network** - the app asks the wallet to switch/add the chain on the
  first write; approve it, or add the chain manually with the table in step 2.
- **Balance looks wrong after a restart** - MetaMask caches balances per network; switch
  networks away and back, or clear activity data, and it refetches.
- **A confirmed transaction is not visible** - the UI waits for the indexer to ingest the
  transaction's block before refetching (up to ~20s); if it still lags, check the server
  log for `sync failed` lines (usually the RPC died).
- **Empty app after restarting the chain** - expected for a few seconds: the genesis guard
  wiped the stale index and is resyncing; reseed if you also restarted from scratch.
