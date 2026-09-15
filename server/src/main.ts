import { verifyMessage, type Address } from 'viem';

import { loadConfig, num, oneOf, str } from './env.ts';
import { createLogger } from './logger.ts';
import { buildApp } from './app.ts';
import { createAdminSession } from './admin-session.ts';
import { diskUploader } from './uploads.ts';
import { ChainReader, loadChainEnv } from './chain/client.ts';
import { IndexStore } from './chain/store.ts';
import { startIndexer } from './chain/indexer.ts';
import { createPriceSource, loadPriceEnv } from './rounds/price.ts';
import { createSigner } from './chain/signer.ts';
import { createRoundsService } from './rounds/engine.ts';
import { createOpeningsService } from './openings.ts';
import { createTelegramService } from './telegram/service.ts';
import { readTelegramSettings } from './settings.ts';

try {
    process.loadEnvFile();
} catch {
    // No .env file - the ambient environment is the configuration.
}

const config = loadConfig({
    port: num('PORT', { default: 6000 }),
    host: str('HOST', { default: '0.0.0.0' }),
    env: oneOf('NODE_ENV', ['development', 'production', 'test'], { default: 'development' }),
    clientDir: str('CLIENT_DIR', { default: '../application/dist' }),
    uploadDir: str('UPLOAD_DIR', { default: 'uploads' }),
    rounds: oneOf('ROUNDS_ENABLED', ['on', 'off'], { default: 'on' }),
    roundsInterval: num('ROUNDS_INTERVAL', { default: 600 }),
    roundsKey: str('ROUNDS_PRIVATE_KEY', { default: '' }),
    roundsCategoryId: num('ROUNDS_CATEGORY_ID', { default: 0 }),
    telegramToken: str('TELEGRAM_BOT_TOKEN', { default: '' }),
    telegramChat: str('TELEGRAM_CHAT_ID', { default: '' }),
    nativeSymbol: str('NATIVE_SYMBOL', { default: 'NURA' }),
    siteUrl: str('SITE_URL', { default: '' })
});
const isProduction = config.env === 'production';

// Pretty lines on the terminal, clean NDJSON in server/logs/ - both, in every mode.
const log = createLogger({
    directory: new URL('../logs/', import.meta.url),
    fields: { service: 'goman-server' }
});

// The indexer half: the chain env, the sqlite index, and the watcher that keeps it fresh.
// The RPC may come up after us (`npm run dev` starts both halves together), so the first
// contact retries instead of dying.
const chainEnv = loadChainEnv();
const chain = new ChainReader(chainEnv);
const store = new IndexStore(chainEnv.dbPath);

const treasury = await (async () => {
    for (let attempt = 1; ; attempt++) {
        try {
            return await chain.treasuryAddress();
        } catch {
            if (attempt === 1) {
                log.warn('chain unreachable, retrying', { rpc: chainEnv.rpcUrl });
                // ALSO to stdout, deliberately. This wait happens BEFORE the port is bound, so
                // to anyone at a terminal the process looks hung - and the log goes to a file
                // they have no reason to be tailing yet. A boot that blocks has to say why.
                process.stdout.write(
                    `\n  Waiting for the chain at ${chainEnv.rpcUrl} ...\n` +
                        '  Start it from the contracts repo (`npm run node`, then `npm run seed`). Giving up after 2 minutes.\n\n'
                );
            }
            if (attempt >= 60) {
                throw new Error(
                    `No chain at ${chainEnv.rpcUrl} - start the node and deploy first (contracts repo: \`npm run node\`, then \`npm run seed\`)`
                );
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }
})();

// The Telegram bot: a PM per indexed event, and the database plus the uploaded images on a
// timer. Inert without BOTH a token and a chat id, exactly as the rounds engine is without a
// key - a deployment that has not been given a bot should run silently, not fail to boot.
//
// The backup period and the event switch are read from the DATABASE, not the environment: they
// are settings an operator changes on a running server from the admin console, and putting
// them in .env meant a redeploy to change a number.
const telegramSettings = readTelegramSettings(store);
const telegram =
    config.telegramToken === '' || config.telegramChat === ''
        ? undefined
        : createTelegramService({
              token: config.telegramToken,
              chatId: config.telegramChat,
              store,
              log,
              uploadDir: config.uploadDir,
              backupMinutes: telegramSettings.backupMinutes,
              symbol: config.nativeSymbol,
              siteUrl: config.siteUrl,
              events: telegramSettings.events
          });
telegram?.start();

const indexer = startIndexer(store, chain, log, (events) => telegram?.onEvents(events));

// The feed opens only once the index has reached the chain head. Before that every batch is a
// REPLAY of history - a fresh database walks the chain from the deploy block - and reporting
// it would arrive as thousands of messages about markets that resolved months ago.
void indexer.ready.then(() => telegram?.arm());

// The rounds engine. It is the ONE part of this process that signs: `ROUNDS_PRIVATE_KEY` is a
// key of its own, needing ADMIN_ROLE on the factory and a seat in the resolution signer set -
// never the factory owner's key, which can also move the treasury.
//
// Without the key the service still runs, and still serves the live TWAP, but writes nothing:
// the page then says the rounds are not running rather than showing an empty schedule as if it
// were a quiet market.
// The engine's key, read once. Two jobs share it: the price rounds, and lifting the pause on a
// market whose scheduled start time has arrived.
const jobSigner = config.roundsKey === '' ? undefined : createSigner(chainEnv, config.roundsKey, chain.client);

const rounds =
    config.rounds === 'off'
        ? undefined
        : createRoundsService({
              store,
              log,
              price: createPriceSource(
                  loadPriceEnv((name, fallback) => str(name, { default: fallback }).read(name)),
                  log
              ),
              signer: jobSigner,
              config: { intervalSeconds: config.roundsInterval, categoryId: config.roundsCategoryId }
          });
rounds?.start();

// Scheduled market openings. Always on: it costs one query every fifteen seconds and does
// nothing at all until an admin schedules a market, whereas a deployment that forgot to enable
// it would leave a market shut past its own advertised opening.
const openings = createOpeningsService({ store, log, signer: jobSigner });
openings.start();

// One signature opens an admin session; the cookie carries it from there. Verification is
// the same pair the mutations use - the wallet proves the address, the chain proves the role -
// so there is one definition of "is an admin" rather than a session-shaped second one.
const adminSession = createAdminSession({
    secureCookie: isProduction,
    async verify(address, message, signature) {
        const signed = await verifyMessage({
            address: address as Address,
            message,
            signature: signature as `0x${string}`
        }).catch(() => false);
        return signed ? chain.hasAdminRole(address as Address) : false;
    }
});

// In dev, vite serves the client and proxies /api here; in production this server serves the
// whole app from one origin, so there is no CORS between the halves and a deep link reloads
// through the SPA fallback.
const app = buildApp({
    dev: !isProduction,
    log,
    store,
    chain,
    treasury,
    uploader: diskUploader(config.uploadDir),
    uploadDir: config.uploadDir,
    adminSession,
    rounds,
    roundsCategory: config.roundsCategoryId > 0 ? String(config.roundsCategoryId) : undefined,
    clientDir: isProduction ? config.clientDir : undefined,
    telegram,
    hardened: true,
    rateLimit: { limit: 200, windowMs: 60_000 }
});

// The index and the watcher outlive individual requests, so they are closed on the way down
// rather than left to the process exiting underneath an open sqlite handle.
const shutdown = async (signal: string): Promise<void> => {
    log.info('shutting down', { signal });
    indexer.stop();
    rounds?.stop();
    openings.stop();
    telegram?.stop();
    await app.close();
    store.close();
    process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.port, host: config.host });
log.info('Listening', { url: `http://localhost:${config.port}`, env: config.env });
