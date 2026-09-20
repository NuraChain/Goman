import { verifyMessage, type Address } from 'viem';

import { loadConfig, num, oneOf, pipeline, rateLimit, str } from '@azerothjs/http';
import { handleShutdownSignals, serve } from '@azerothjs/http/node';

import { createLogger } from './logger.ts';
import { buildApp } from './app.ts';
import { createAdminSession } from './admin-session.ts';
import { diskUploader } from './uploads.ts';
import { ChainReader, loadChainEnv } from './chain/client.ts';
import { IndexStore } from './chain/store.ts';
import { startIndexer } from './chain/indexer.ts';
import { createTelegramService } from './telegram/service.ts';
import { readTelegramSettings } from './settings.ts';

try
{
    process.loadEnvFile();
}
catch
{
    // No .env file - the ambient environment is the configuration.
}

const config = loadConfig({
    port: num('PORT', { default: 6000 }),
    host: str('HOST', { default: '0.0.0.0' }),
    env: oneOf('NODE_ENV', ['development', 'production', 'test'], { default: 'development' }),
    clientDir: str('CLIENT_DIR', { default: '../application/dist' }),
    uploadDir: str('UPLOAD_DIR', { default: 'uploads' }),
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

const treasury = await (async () =>
{
    for (let attempt = 1; ; attempt++)
    {
        try
        {
            return await chain.treasuryAddress();
        }
        catch
        {
            if (attempt === 1)
            {
                log.warn('chain unreachable, retrying', { rpc: chainEnv.rpcUrl });
                // ALSO to stdout, deliberately. This wait happens BEFORE the port is bound, so
                // to anyone at a terminal the process looks hung - and the log goes to a file
                // they have no reason to be tailing yet. A boot that blocks has to say why.
                process.stdout.write(
                    `\n  Waiting for the chain at ${ chainEnv.rpcUrl } ...\n` +
                        '  Start it from the contracts repo (`npm run node`, then `npm run seed`). Giving up after 2 minutes.\n\n'
                );
            }
            if (attempt >= 60)
            {
                throw new Error(
                    `No chain at ${ chainEnv.rpcUrl } - start the node and deploy first (contracts repo: \`npm run node\`, then \`npm run seed\`)`
                );
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }
})();

// The Telegram bot: a PM per indexed event, and the database plus the uploaded images on a
// timer. Inert without BOTH a token and a chat id - a deployment that has not been given a
// bot should run silently, not fail to boot.
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

// This process holds NO key and signs nothing. Every write - deploying a market, pausing it,
// resolving it, lifting a pause when its start time arrives - is signed by an admin's own
// wallet in the browser. A scheduled start time is therefore a note to the operator rather
// than an instruction to this server: the market is deployed paused, and stays that way until
// somebody resumes it from the console.

// One signature opens an admin session; the cookie carries it from there. Verification is
// the same pair the mutations use - the wallet proves the address, the chain proves the role -
// so there is one definition of "is an admin" rather than a session-shaped second one.
const adminSession = createAdminSession({
    secureCookie: isProduction,
    async verify(address, message, signature)
    {
        const signed = await verifyMessage({
            address: address as Address,
            message,
            signature: signature as `0x${ string }`
        }).catch(() => false);
        return signed ? chain.hasAdminRole(address as Address) : false;
    }
});

// In dev, vite serves the client and proxies /api here; in production this server serves the
// whole app from one origin, so there is no CORS between the halves and a deep link reloads
// through the SPA fallback.
const { app } = buildApp({
    dev: !isProduction,
    log,
    store,
    chain,
    treasury,
    uploader: diskUploader(config.uploadDir),
    uploadDir: config.uploadDir,
    adminSession,
    clientDir: isProduction ? config.clientDir : undefined,
    telegram,
    hardened: true
});

// The limiter is EDGE middleware, not app middleware: inside the app it would also sit on the
// in-process leg, which has no peer address, and answer 500 rate-limit-key-unavailable.
// `trustProxy` is on because nginx is the only thing that talks to this port - and note the
// admin lockout in admin-session.ts deliberately does NOT trust it, because a forwarding
// header is attacker-controlled and would let one machine reset its own counter.
const served = await serve(pipeline(app, rateLimit({ limit: 200, windowMs: 60_000 })), {
    port: config.port,
    hostname: config.host,
    trustProxy: true
});

// The index and the watcher outlive individual requests, so the order matters: stop producing
// work first, let the in-flight requests drain, then close sqlite under nothing.
handleShutdownSignals(served, {
    beforeShutdown: () =>
    {
        log.info('shutting down');
        indexer.stop();
        telegram?.stop();
    },
    beforeExit: () => store.close()
});

log.info('Listening', { url: `http://localhost:${ config.port }`, env: config.env });
