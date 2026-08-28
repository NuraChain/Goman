<div align="center">

# Goman

**Trade on what happens next.**

An open-source prediction market: people buy and sell shares in real-world outcomes, prices read
as probabilities, and markets settle on chain. Ten languages including right-to-left Persian and
Arabic, native on mobile and on desktop.

[![CI](https://github.com/NuraChain/Market/actions/workflows/ci.yml/badge.svg)](https://github.com/NuraChain/Market/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-F5B94A)](LICENSE)
[![Node >= 24](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org)
[![Built with AzerothJS](https://img.shields.io/badge/built%20with-AzerothJS-10B981)](https://github.com/AzerothJS/AzerothJS)

<img src="docs/screenshots/home-desktop-dark.png" alt="Goman home, dark theme" width="840" />

</div>

---

## What it is

A share in an outcome costs between 0c and 100c, and its price is the market's estimate of the
odds: a share trading at 34c means the market gives that outcome a 34% chance. Buy it, and if the
outcome happens the share settles at 100c.

Trades and settlement happen on chain through a browser wallet. The server owns what a chain
should not: market metadata, uploaded images, and the read models the pages are built from. The
admin console creates, pauses and resolves markets against the deployed contracts.

> **Status:** working software, not yet battle-tested at scale. The contracts have a test suite
> and the money rules below are enforced server-side, but this has not been audited. Run it on a
> testnet before it holds anything you would miss.

<div align="center">

| | |
| --- | --- |
| <img src="docs/screenshots/market-desktop-dark.png" alt="Market detail with live chart and trade ticket" /> | <img src="docs/screenshots/home-desktop-light.png" alt="Home in the light theme" /> |
| <img src="docs/screenshots/browse-mobile-dark.png" alt="Browsing markets on mobile" width="390" /> | <img src="docs/screenshots/market-mobile-fa.png" alt="Persian RTL market page" width="390" /> |

</div>

## Features

- **Prices that read as odds.** Full-height outcome buttons carry their own price, and one
  convention holds everywhere: 34c means a 34% chance, said in plain words on the market page.
- **Ten languages, RTL as a first-class layout.** English, Persian, Arabic, Spanish, Portuguese,
  Hindi, Chinese, Russian, French and Turkish. Direction comes from the language registry, so
  Persian and Arabic mirror the whole app through logical properties. Persian additionally keeps
  its own numerals, scale words and the Jalali calendar; every other language gets its native
  grouping, compact suffixes and dates with Latin digits, so a table never mixes scripts.
- **Native on both form factors.** Mobile gets a bottom tab bar, drag-handled sheets, a sticky
  trade bar and 44px targets. Desktop gets hover, density, a sticky trade ticket and keyboard
  paths. One component, two presentations - not a scaled-down desktop.
- **Dark first, light complete.** Two full parallel colour scales flipped by one `data-theme`
  attribute. Light is a first-class theme, never a derived tint.
- **Accessible by construction.** WCAG AA contrast in both themes, visible focus rings, and
  YES/NO that always travel with an icon and a label - never colour alone.
- **Designed empty and error states.** Every empty list carries a next action, and a render that
  throws swaps in a recoverable page instead of a blank screen.
- **Search that works in both languages**, instantly, from either keyboard.
- **On-chain settlement** with an admin console for creating, pausing and resolving markets.

## Quick start

Requires **Node >= 24** and a browser wallet for the trading flows.

```sh
npm install
cp server/.env.example server/.env
npm run dev            # the app
```

`npm run dev` runs both halves: the API server on **:6000**, vite on **:6001** with `/api`
proxied. Open <http://localhost:6001>.

The Solidity lives in its own repository (`auctionhouse-contracts`). To get a local chain with
markets on it, clone that repo alongside this one and run its `node`, `deploy:local` and `seed`
scripts - it starts a node on `:8545` and writes the deployed addresses this app reads. The ABIs
this client compiles against are checked in at `application/src/lib/abis/`; re-export them from
the contracts repo whenever the interfaces change.

Point your wallet at the local chain (chain id `31337`, RPC `http://127.0.0.1:8545`) and import
one of the node's funded test accounts to trade. Without a running chain the pages render but
every trade fails - there is nothing to trade against.

## Configuration

Copy `server/.env.example` to `server/.env`. Every key the server reads is listed there; keep the
two files in step.

| Key | Default | What it does |
| --- | --- | --- |
| `PORT` | `6000` | Server port |
| `NODE_ENV` | `development` | `production` serves the built client |
| `CLIENT_DIR` | `../application/dist` | Built client, served from the same origin |
| `SSR_ENTRY` | `../application/dist-server/entry.server.js` | SSR bundle |
| `UPLOAD_DIR` | `uploads` | Where market and outcome images are written |

## Deployment

```sh
npm run build
NODE_ENV=production npm start
```

One process serves the API and the built client on one origin, so there is no CORS to configure.
Put a reverse proxy in front for TLS.

In a container - build from the repository root, where the workspace lockfile lives:

```sh
docker build -f server/Dockerfile -t goman .
docker run -p 6000:6000 --env-file server/.env -v goman-uploads:/app/uploads goman
```

Before running it for real:

- **`UPLOAD_DIR` must survive a deploy.** Market images live on disk, not in the database. Mount a
  volume, or they 404 after the next release.
- **Contract addresses are build-time input.** Re-deploying the contracts means re-exporting the
  ABIs from the contracts repo into `application/src/lib/abis/` and rebuilding the client.
- **The admin console is key-gated.** Whoever holds the admin key can resolve markets, which
  decides who gets paid. Treat it as a production credential.

## Architecture

Compiled `.azeroth` components on the client, an `@azerothjs/http` server, and **one typed API
declaration between them** - the browser's client is inferred from the server's own route
declarations, so a handler and its caller cannot drift.

Two rules to know before touching anything:

- **One number module.** Every price, volume, percentage and date renders through
  `application/src/i18n/format.ts`. Persian-digit bugs die in its unit tests, not in production.
- **Tokens are the source of truth for style.** Colour, radius and motion live in
  `application/src/styles/tokens.css`. Components consume tokens; they never invent values.

```
application/            the web client (vite + azeroth compiler + tailwind)
  src/styles/           tokens.css (the Ledger design system), base.css
  src/i18n/             langs.ts (THE language registry), one dictionary per language,
                        format.ts (THE number module)
  src/icons/            Icon component + lucide registry + RTL mirror list
  src/components/ui/    Button, Chip, Badge, Input, Tabs, Sheet, Skeleton,
                        Chart, ChanceRing, Ticker
  src/components/       layout/ (Header, TabBar, Footer, sheets)  market/ (cards, ticket)
  src/pages/            home, market, browse, portfolio, leaderboard, settings,
                        not-found, error
  src/routes.ts         ONE route table; per-route render mode
server/                 @azerothjs/http - the declared API
  src/schemas.ts        the wire vocabulary (client-safe)
  src/app.ts            feature() declarations: markets, portfolio, leaderboard, admin
  src/derive.ts         the read models the pages are built from
  src/uploads.ts        market and outcome images (writes to UPLOAD_DIR)
```

The Solidity is NOT in this repository - it has its own (`auctionhouse-contracts`). What crosses
the boundary is the exported ABI JSON in `application/src/lib/abis/`, which the viem clients in
`application/src/lib/contracts.ts` and the indexer in `server/src/chain/` compile against.

## Development

| Script | What it does |
| --- | --- |
| `npm run dev` | Server + client, one banner, hot reload on both |
| `npm run check` | Type-check (azeroth-tsc + tsc) and lint, both workspaces |
| `npm test` | Unit and component tests (vitest, happy-dom) |
| `npm run build` | Client bundle + SSR bundle + prerender |
| `npm start` | Run the built app (set `NODE_ENV=production`) |

The chain-side scripts (`node`, `deploy:local`, `seed`, `export-abis`) live in the contracts
repository.

## Contributing

Issues and pull requests are welcome. For anything larger than a fix, open an issue first so the
approach can be agreed before you spend the time.

Before opening a pull request, both gates must pass:

```sh
npm run check
npm test
```

House style is enforced by the linter and visible in any neighbouring file: Allman braces, one
import per module, and comments that state a constraint the code cannot show rather than
narrating what changed.

- **Adding a page:** one row in `application/src/routes.ts` plus its `*.page.azeroth` component.
- **Adding a component:** shared UI goes in `components/ui/` and consumes tokens, never raw values.
- **Adding user-facing copy:** it goes in `src/i18n/en.ts` **and** every other dictionary
  beside it - `Record<Lang, Dictionary>` in the locale store makes a missing one a compile
  error. An inline string in a component is a review comment.
- **Adding a language:** a row in `src/i18n/langs.ts` and a dictionary bound to its code in
  `src/stores/locale.store.ts`. Nothing else enumerates languages.

## Security

**Do not open a public issue for a security bug.** Report it privately to the maintainer so a fix
can ship before the details are public.

The money rules are enforced on the server, not in the UI, and are the right place to start if you
are reviewing:

- The charged amount comes from the stored row, never from the request.
- Settlement is idempotent - a paid position cannot be paid twice.
- A resolved market cannot be resolved again.
- Admin routes are key-gated, and that key decides who gets paid.

## License

[MIT](LICENSE) (c) 2026 IntelligentQuantum
