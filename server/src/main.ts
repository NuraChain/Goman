import { verifyMessage, type Address } from 'viem';

import { loadConfig, num, oneOf, str } from './env.ts';
import { createLogger } from './logger.ts';
import { buildApp } from './app.ts';
import { createAdminSession } from './admin-session.ts';
import { diskUploader } from './uploads.ts';
import { ChainReader, loadChainEnv } from './chain/client.ts';
import { IndexStore } from './chain/store.ts';
import { startIndexer } from './chain/indexer.ts';

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
    uploadDir: str('UPLOAD_DIR', { default: 'uploads' })
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

const indexer = startIndexer(store, chain, log);

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
    clientDir: isProduction ? config.clientDir : undefined,
    hardened: true,
    rateLimit: { limit: 200, windowMs: 60_000 }
});

// The index and the watcher outlive individual requests, so they are closed on the way down
// rather than left to the process exiting underneath an open sqlite handle.
const shutdown = async (signal: string): Promise<void> => {
    log.info('shutting down', { signal });
    indexer.stop();
    await app.close();
    store.close();
    process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.port, host: config.host });
log.info('Listening', { url: `http://localhost:${config.port}`, env: config.env });
