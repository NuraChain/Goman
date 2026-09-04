import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

// A plain SPA build: one client bundle, no SSR half. Every route rendered on the client
// already, so the server serves `dist/` as static files with an index.html fallback.
export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
        // Declared, not inherited: the README and the dev proxy below both name these ports,
        // so they belong in the config rather than in vite's defaults. Vite still steps to
        // the next free port if this one is taken.
        port: 6001,
        proxy: {
            // The server half of this app. `npm run dev` at the root runs both halves; this
            // line is the whole DEV wiring. In production the server serves the built client
            // itself (one origin) - see server/src/app.ts.
            '/api': 'http://localhost:6000',
            '/uploads': 'http://localhost:6000'
        }
    },
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
