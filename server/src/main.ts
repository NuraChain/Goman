import { pathToFileURL } from 'node:url';

import { pipeline, requestId, securityHeaders, rateLimit, logRequests, loadConfig, num, oneOf, str } from '@azerothjs/http';
import { serve, handleShutdownSignals } from '@azerothjs/http/node';
import type { PageRenderer, PageRoute } from '@azerothjs/kit';
import { createLogger, teeSink, terminalSink } from '@azerothjs/logger';
import { fileSink } from '@azerothjs/logger/node';
import { verifyMessage, type Address } from 'viem';

import { buildApp } from './app.ts';
import { createAdminSession } from './admin-session.ts';
import { diskUploader } from './uploads.ts';
import { ChainReader, loadChainEnv } from './chain/client.ts';
import { IndexStore } from './chain/store.ts';
import { startIndexer } from './chain/indexer.ts';

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
    uploadDir: str('UPLOAD_DIR', { default: 'uploads' })
});
const isProduction = config.env === 'production';

// Pretty lines on the terminal, clean NDJSON in server/logs/ - both, in every mode.
const log = createLogger({
    sink: teeSink(terminalSink(), fileSink(new URL('../logs/', import.meta.url))),
    fields: { service: 'auctionhouse-server' }
});

// The indexer half: the chain env, the sqlite index, and the watcher that keeps it fresh.
// The RPC may come up after us (the runbook starts everything together), so the first
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
                    `\n  Waiting for the chain at ${ chainEnv.rpcUrl } ...\n`
                    + '  Start it from the contracts repo (`npm run node`, then `npm run seed`). Giving up after 2 minutes.\n\n'
                );
            }
            if (attempt >= 60)
            {
                throw new Error(`No chain at ${ chainEnv.rpcUrl } - start the node and deploy first (see RUNBOOK.md)`);
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }
})();

const indexer = startIndexer(store, chain, log);

// In dev, vite serves the client and proxies /api here; in production this server serves
// the whole app - one origin, no CORS between halves. The SSR bundle is ONE self-contained
// file, so importing it gives the kit both the route table and the page renderer.
const ssr = isProduction
    ? await import(pathToFileURL(config.ssrEntry).href) as { routes: PageRoute[]; renderPage: PageRenderer }
    : undefined;

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

const app = buildApp({
    dev: !isProduction,
    observe: logRequests(log),
    store,
    chain,
    treasury,
    uploader: diskUploader(config.uploadDir),
    uploadDir: config.uploadDir,
    adminSession,
    pages: ssr === undefined ? undefined : { routes: ssr.routes, clientDir: config.clientDir, renderer: ssr.renderPage }
});

const handler = pipeline(
    app,
    requestId(),
    securityHeaders(),
    rateLimit({ limit: 200, windowMs: 60_000 })
);

const served = await serve(handler, { port: config.port });
handleShutdownSignals(served);
served.server.on('close', () =>
{
    indexer.stop();
    store.close();
});

// The panel's Server tab connects here and mirrors the server's reactive graph: request roots,
// their per-request state, and long-lived stores. That is live application data, so the bridge
// attaches ONLY under NODE_ENV=development and every upgrade must present the token below from a
// loopback peer. The token is minted per boot: it is never written to disk and never committed.
// Reads the RAW variable, not `config.env`. `loadConfig` defaults an unset NODE_ENV to
// 'development' for this app's own purposes, but the bridge refuses anything that is not
// literally development - so guarding on the defaulted value would call it in a scaffold where
// nothing is set, and the boot would die on a bridge that was never going to attach.
// `azeroth dev` sets NODE_ENV=development, so `npm run dev` gets the panel.
if (process.env.NODE_ENV === 'development')
{
    // The token is read, never minted. A dev server restarts on every file save, so a
    // per-boot secret would differ each time and the panel - which remembers the URL you
    // gave it - would 403 from your first edit onward. .env outlives the process.
    const token = process.env.DEVTOOLS_TOKEN;
    if (token === undefined || token.length < 16)
    {
        log.warn('devtools bridge off - set DEVTOOLS_TOKEN in server/.env (16+ chars) to enable it');
    }
    else
    {
        const { attachDevtools } = await import('@azerothjs/devtools/server');
        attachDevtools(served.server, { token });
        log.info('devtools bridge', { url: `ws://localhost:${ served.port }/__azeroth/devtools?token=${ token }` });
    }
}

log.info('Listening', { url: `http://localhost:${ served.port }`, env: config.env });
