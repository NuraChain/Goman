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
    // 6001, not 6000: every major browser REFUSES port 6000 outright. It is the X11 port, so it
    // sits on Chrome's and Firefox's blocked list, and `http://localhost:6000` answers
    // ERR_UNSAFE_PORT / "This address is restricted" before a request is ever made. The server
    // itself binds and serves perfectly, which is what makes it confusing - curl works, the log
    // says Listening, and only the browser refuses. A deployment behind nginx never sees it
    // because PORT is set there; the person running it locally sees nothing else.
    port: num('PORT', { default: 6001 }),
    env: oneOf('NODE_ENV', ['development', 'production', 'test'], { default: 'development' }),
    clientDir: str('CLIENT_DIR', { default: '../application/dist' }),
    ssrEntry: str('SSR_ENTRY', { default: '../application/dist-server/entry.server.js' }),
    uploadDir: str('UPLOAD_DIR', { default: 'uploads' }),
    telegramToken: str('TELEGRAM_BOT_TOKEN', { default: '' }),
    telegramChat: str('TELEGRAM_CHAT_ID', { default: '' }),
    nativeSymbol: str('NATIVE_SYMBOL', { default: 'NURA' }),
    siteUrl: str('SITE_URL', { default: '' }),
    rateMax: num('API_RATE_MAX', { default: 600 })
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
    // One line covers dev and production: `deps` is what both halves build their app from, so
    // robots.txt and the sitemap emit the same origin either way.
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
// nginx is the only thing that talks to this port, in every mode: the bind is loopback and
// `trustProxy` is on, neither configurable. Note the admin lockout in admin-session.ts
// deliberately does NOT trust the forwarding header, because it is attacker-controlled and
// would let one machine reset its own counter.
// Compression, as the outermost wrapper so it sees the finished response.
//
// `compressResponse` is a `(request, response) => Response` rather than an edge middleware, so
// it needs these four lines to become one - and outermost is deliberate: `pipeline(app, a, b)`
// puts `a` on the outside, so this wraps the rate limiter's answers too. It negotiates br/gzip,
// skips event streams and anything already compressed, and passes small bodies through, so it
// is safe to apply to everything. Server-rendered HTML is the largest thing this origin sends
// and nginx will not re-encode a response that arrives already encoded.
//
// It also says out loud that a page carrying a price is not cacheable, which nothing else did:
// `render: 'server'` answers 200 with no freshness headers at all, and RFC 9111 lets a shared
// cache store such a response on a heuristic. The route table's whole argument is that a cached
// price is a wrong one, so the response has to carry that rather than rely on nobody guessing.
// Only where nothing has decided already, which is why it is a default rather than a rule: the
// hashed assets say `immutable`, robots.txt and the sitemap say an hour, and an ISR page would
// say `must-revalidate`. Each of those is an answer, and none of them is this one.
const compress = edge((next) => ({
    handle: async (request) =>
    {
        const response = await next.handle(request);

        if (!response.headers.has('cache-control'))
        {
            try
            {
                response.headers.set('cache-control', 'private, no-store');
            }
            catch
            {
                // `Response.redirect()` and `Response.error()` guard their headers immutable.
                // Neither carries a body, so neither is a price anybody could cache.
            }
        }

        return compressResponse(request, response);
    }
}));

// What the limiter is allowed to SEE, and it is not everything.
//
// One budget cannot be right for a chain read and for a hashed file served off disk with an
// `immutable` ETag, and wrapping the limiter around the whole handler prices the cheap thing at
// the expensive thing's rate. A page load here pulls a dozen assets, so a 200/minute budget was
// really twenty page loads a minute - and the first thing a reader over that line loses is their
// own JavaScript, which reads as a broken site rather than as a refusal. The browser tour proved
// it before anybody complained: thirty-two navigations took 429s on the last five.
//
// So `/assets` and the two crawler files are unmetered. They are static bytes with a year of
// cache time on them, and nginx answers most of them without reaching this process at all. What
// is left is every api call and every server render, which is the work worth protecting.
//
// `API_RATE_MAX` exists because the right number is a fact about the DEPLOYMENT, not about this
// code: mobile carriers here put whole cities behind one address, so a budget sized for one
// household refuses a city. The default is ten a second sustained, which no person reaches and
// which still caps a scraper.
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
