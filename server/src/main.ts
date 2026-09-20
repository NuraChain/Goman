import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { verifyMessage, type Address } from 'viem';

import { loadConfig, logRequests, num, oneOf, pipeline, rateLimit, str } from '@azerothjs/http';
import { handleShutdownSignals, serve } from '@azerothjs/http/node';
import { devPages } from '@azerothjs/kit/dev';
import type { PageRoute } from '@azerothjs/kit';
import type { PageRenderer } from '@azerothjs/kit/ssr';

import { createLogger, teeSink, terminalSink } from '@azerothjs/logger';
import { fileSink } from '@azerothjs/logger/node';

import { buildApp } from './app.ts';
import { CONTENT_LANGS } from './wire.ts';
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
    env: oneOf('NODE_ENV', ['development', 'production', 'test'], { default: 'development' }),
    clientDir: str('CLIENT_DIR', { default: '../application/dist' }),
    ssrEntry: str('SSR_ENTRY', { default: '../application/dist-server/entry.server.js' }),
    uploadDir: str('UPLOAD_DIR', { default: 'uploads' }),
    telegramToken: str('TELEGRAM_BOT_TOKEN', { default: '' }),
    telegramChat: str('TELEGRAM_CHAT_ID', { default: '' }),
    nativeSymbol: str('NATIVE_SYMBOL', { default: 'NURA' }),
    siteUrl: str('SITE_URL', { default: '' })
});
const isProduction = config.env === 'production';

// Pretty lines on the terminal, clean NDJSON in server/logs/ - both, in every mode.
const log = createLogger({
    sink: teeSink(terminalSink(), fileSink(new URL('../logs/', import.meta.url))),
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

// One origin, both halves, in dev as in production: the public pages RENDERED and the rest
// served as a shell, with no CORS between them and no proxy in the middle. A deep link reloads
// into the page rather than into a blank index.html that has to fetch its way back.
//
// The two modes differ only in where the client comes from. Production imports the built SSR
// bundle - `SSR_ENTRY` has named that path since long before anything read it - while dev runs
// a vite session that renders from SOURCE, which is what makes SSR something a developer
// exercises on every reload rather than something only production runs.
const deps = {
    log,
    store,
    chain,
    treasury,
    uploader: diskUploader(config.uploadDir),
    uploadDir: config.uploadDir,
    adminSession,
    telegram,
    hardened: true
};

const session = isProduction
    ? undefined
    : await devPages({
        root: resolve(config.clientDir, '..'),
        entry: 'src/entry.server.ts',
        app: { dev: true, observe: logRequests(log) },
        // No manifest here on purpose: the dev shell has none to embed, and the client falls
        // back to `/api/_manifest`, which this app registers either way. No `images` either:
        // the transform endpoint reads a BUILT client, and there is none under a dev shell.
        pages: { locales: { supported: [...CONTENT_LANGS], default: 'en' } },
        routes: (devApp) => void buildApp({ ...deps, dev: true, app: devApp })
    });

const pages = !isProduction
    ? undefined
    : await (async (): Promise<{ clientDir: string; routes: PageRoute[]; renderPage: PageRenderer }> =>
    {
        const entry = (await import(pathToFileURL(resolve(config.ssrEntry)).href)) as {
            routes: PageRoute[];
            renderPage: PageRenderer;
        };
        return { clientDir: config.clientDir, routes: entry.routes, renderPage: entry.renderPage };
    })();

const app = session?.app ?? buildApp({ ...deps, dev: false, pages }).app;

// The limiter is EDGE middleware, not app middleware: inside the app it would also sit on the
// in-process leg, which has no peer address, and answer 500 rate-limit-key-unavailable.
// nginx is the only thing that talks to this port, in every mode: the bind is loopback and
// `trustProxy` is on, neither configurable. Note the admin lockout in admin-session.ts
// deliberately does NOT trust the forwarding header, because it is attacker-controlled and
// would let one machine reset its own counter.
const served = await serve(pipeline(app, rateLimit({ limit: 200, windowMs: 60_000 })), {
    port: config.port,
    hostname: '127.0.0.1',
    trustProxy: true,
    // Vite sees only its own requests - its module graph, its assets - and everything else
    // reaches the app behind it.
    before: session?.before
});

// HMR rides this server's socket, because the dev session was given none of its own.
session?.attach(served.server);

// The index and the watcher outlive individual requests, so the order matters: stop producing
// work first, let the in-flight requests drain, then close sqlite under nothing.
handleShutdownSignals(served, {
    beforeShutdown: () =>
    {
        log.info('shutting down');
        indexer.stop();
        telegram?.stop();
        void session?.close();
    },
    beforeExit: () => store.close()
});

log.info('Listening', { url: `http://localhost:${ config.port }`, env: config.env });
