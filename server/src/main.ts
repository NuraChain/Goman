import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { verifyMessage, type Address } from 'viem';

import { edge, loadConfig, logRequests, num, oneOf, pipeline, rateLimit, str } from '@azerothjs/http';
import { compressResponse } from '@azerothjs/http/node';
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
import { connectionOf, loadDatabaseEnv } from './chain/data-source.ts';
import { IndexStore } from './chain/store.ts';
import { startIndexer } from './chain/indexer.ts';
import { createTelegramService } from './telegram/service.ts';
import { readTelegramSettings } from './settings.ts';

try
{
    // The ONE .env, at the repo root - the client's VITE_* keys live in it too.
    process.loadEnvFile(new URL('../../.env', import.meta.url));
}
catch
{
    // No .env file - the ambient environment is the configuration.
}

/**
 * A key that must be SET but may be empty - empty is how it is switched off. loadConfig reads an
 * empty value as a missing one, so these are checked here instead.
 */
function present(name: string): string
{
    const value = process.env[name];
    if (value === undefined)
    {
        throw new Error(`Configuration is invalid:\n  - ${ name } is required and missing`);
    }
    return value;
}

// Every key is required; none has a default (see .env.example). NODE_ENV is not one of the file's:
// `npm run dev` and `npm start` pin it (src/dev-env.ts and src/deploy-env.ts).
const config = {
    ...loadConfig({
        port: num('PORT'),
        host: str('HOST'),
        env: oneOf('NODE_ENV', ['development', 'production', 'test']),
        clientDir: str('CLIENT_DIR'),
        ssrEntry: str('SSR_ENTRY'),
        uploadDir: str('UPLOAD_DIR'),
        nativeSymbol: str('NATIVE_SYMBOL'),
        rateMax: num('API_RATE_MAX')
    }),
    telegramToken: present('TELEGRAM_BOT_TOKEN'),
    telegramChat: present('TELEGRAM_CHAT_ID'),
    siteUrl: present('SITE_URL')
};
const isProduction = config.env === 'production';

// Pretty lines on the terminal, clean NDJSON in server/logs/ - both, in every mode.
const log = createLogger({
    sink: teeSink(terminalSink(), fileSink(new URL('../logs/', import.meta.url))),
    fields: { service: 'goman-server' }
});

// The indexer half: the chain env, the index in PostgreSQL, and the watcher that keeps it fresh.
// The RPC may come up after us (`npm run dev` starts both halves together), so the first
// contact retries instead of dying.
const chainEnv = loadChainEnv();
const chain = new ChainReader(chainEnv);
const store = await IndexStore.open({ connection: connectionOf(loadDatabaseEnv()), log });

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
const telegramSettings = await readTelegramSettings(store);
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

const indexer = startIndexer(store, chain, log, (events) => void telegram?.onEvents(events));

// The feed opens only once the index has reached the chain head. Before that every batch is a
// REPLAY of history - a fresh database walks the chain from the deploy block - and reporting
// it would arrive as thousands of messages about markets that resolved months ago.
void indexer.ready.then(() => telegram?.arm());

// This process holds NO key and signs nothing. Every write - deploying a market, resolving it,
// cancelling it - is signed by an admin's own wallet in the browser.

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
    siteUrl: config.siteUrl,
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
        pages: { locales: { supported: [...CONTENT_LANGS], default: 'en', routing: 'prefix' } },
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
// nginx is the only thing that talks to this port, in every mode: the bind is loopback (HOST
// widens it only inside a container) and `trustProxy` is on, which is not configurable. Note the
// admin lockout in admin-session.ts deliberately does NOT trust the forwarding header, because it is attacker-controlled and
// would let one machine reset its own counter.
const stamped = (response: Response): Response =>
{
    if (response.status < 200 || response.headers.has('cache-control'))
    {
        return response;
    }

    const headers = new Headers(response.headers);
    headers.set('cache-control', 'private, no-store');

    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

const compress = edge((next) => ({
    handle: async (request) => compressResponse(request, stamped(await next.handle(request)))
}));

const metered = (path: string): boolean =>
    !path.startsWith('/assets/') && path !== '/robots.txt' && path !== '/sitemap.xml';

const limiter = rateLimit({ limit: config.rateMax, windowMs: 60_000 });

const limit = edge((next) => ({
    handle: (request) => metered(new URL(request.url).pathname)
        ? limiter(next).handle(request)
        : next.handle(request)
}));

const served = await serve(pipeline(app, compress, limit), {
    port: config.port,
    hostname: config.host,
    trustProxy: true,
    // Vite sees only its own requests - its module graph, its assets - and everything else
    // reaches the app behind it.
    before: session?.before
});

// HMR rides this server's socket, because the dev session was given none of its own.
session?.attach(served.server);

/**
 * Waits for one shutdown step, but never longer than `ms`. A step still running when its time is
 * up is left behind, and a rejection it lands later is dropped - the sequence has moved on, and
 * there is nobody left to tell.
 */
function within(step: Promise<unknown> | undefined, ms: number): Promise<void>
{
    return new Promise<void>((resolve, reject) =>
    {
        if (step === undefined)
        {
            resolve();
            return;
        }
        // Unref'd: a cap must never be the thing that keeps a finished process alive.
        const timer = setTimeout(resolve, ms).unref();
        step.then(
            () =>
            {
                clearTimeout(timer);
                resolve();
            },
            (error: unknown) =>
            {
                clearTimeout(timer);
                reject(error);
            });
    });
}

// The index and the watcher outlive individual requests, so the order matters: stop producing
// work first, let the in-flight requests drain, then close the index's pool under nothing.
//
// Every wait is capped, and a hard exit caps them all: a close that never returns must not hold
// the port until the supervisor's kill. Exiting with the index still open loses nothing - a chunk
// commits together with the cursor that covers it, and the next boot resumes from there.
let stopping: Promise<void> | undefined;
handleShutdownSignals(served, {
    beforeShutdown: () =>
    {
        log.info('shutting down');
        setTimeout(() => process.exit(1), 25_000).unref();
        stopping = indexer.stop();
        telegram?.stop();
        void session?.close();
    },
    beforeExit: async () =>
    {
        try
        {
            await within(stopping, 5_000);
        }
        finally
        {
            await within(store.close(), 5_000);
        }
    },
    onError: (error: unknown) => log.error('shutdown failed', { error: String(error) })
});

log.info('Listening', { url: `http://localhost:${ config.port }`, env: config.env });
