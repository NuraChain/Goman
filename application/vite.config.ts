import { azeroth } from '@azerothjs/compiler';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

// Two builds from one config: the client bundle into `dist/`, and `--ssr src/entry.server.ts`
// into `dist-server/`, which the server imports to render the public pages.
export default defineConfig({
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

        // The money formatter stamps `VITE_CURRENCY_SYMBOL` onto every amount, and
        // format.spec.ts pins exact rendered strings on purpose. Without this the suite
        // passes or fails depending on which chain the developer's .env happens to name.
        env: {
            VITE_CURRENCY_SYMBOL: 'ETH'
        }
    }
});
