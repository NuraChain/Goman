import { azeroth } from '@azerothjs/compiler';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// The ONE .env, at the repo root - the server reads the same file.
const ENV_DIR = '..';

// Every VITE_* key is required; none has a default (see .env.example). These may be EMPTY, which
// switches them off - the rest must hold a value.
const REQUIRED = ['VITE_RPC_URL', 'VITE_CHAIN_ID', 'VITE_CHAIN_NAME', 'VITE_CURRENCY_SYMBOL',
    'VITE_CURRENCY_DECIMALS', 'VITE_ADMIN_ADDRESS'];
const MAY_BE_EMPTY = ['VITE_EXPLORER_URL', 'VITE_SITE_URL'];

/** Fails the build (or the dev session) naming every key that is missing. */
function requireEnv(mode: string): void
{
    const env = loadEnv(mode, ENV_DIR, 'VITE_');
    const missing = [
        ...REQUIRED.filter((key) => env[key] === undefined || env[key] === ''),
        ...MAY_BE_EMPTY.filter((key) => env[key] === undefined)
    ];
    if (missing.length > 0)
    {
        throw new Error('Configuration is invalid:\n'
            + missing.map((key) => `  - ${ key } is required and missing`).join('\n'));
    }
}

// Two builds from one config: the client bundle into `dist/`, and `--ssr src/entry.server.ts`
// into `dist-server/`, which the server imports to render the public pages.
export default defineConfig(({ mode }) =>
{
    // The suite pins every value itself (test.env below), whatever the developer's .env names.
    if (mode !== 'test')
    {
        requireEnv(mode);
    }

    return {
        envDir: ENV_DIR,
        plugins: [azeroth(), tailwindcss()],
        ssr: {
            // ONE azerothjs instance per server process. Bundled, the SSR half would carry its own
            // copy of the runtime and its signals would be invisible to the server's.
            external: ['azerothjs']
        },
        // No `server` block and no proxy: the dev SESSION owns this vite (server/src/main.ts),
        // serves it on the server's own port and refuses a proxy outright - it IS that seam.
        test: {
            environment: 'happy-dom',
            globals: true,
            setupFiles: ['./tests/setup.ts'],

            // Pinned, so the suite passes or fails the same whichever chain the developer's .env
            // names - format.spec.ts, for one, pins the exact rendered money strings. And the
            // keys have no defaults, so CI (which has no .env) needs them from here.
            env: {
                VITE_RPC_URL: 'http://127.0.0.1:8545',
                VITE_CHAIN_ID: '31337',
                VITE_CHAIN_NAME: 'Local EVM',
                VITE_CURRENCY_SYMBOL: 'ETH',
                VITE_CURRENCY_DECIMALS: '18',
                VITE_EXPLORER_URL: '',
                VITE_ADMIN_ADDRESS: '0x2Ef2D5A095Fd5Ecd686d99eD3cd1F9ff91fc3167',
                VITE_SITE_URL: ''
            }
        }
    };
});
