import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import { defineConfig } from 'vitest/config';

// The server's test configuration. Every spec runs against a stubbed chain and, where it needs an
// index, a real PostgreSQL: TEST_DATABASE_URL, a database the suite may create schemas in (see
// tests/support/database.ts). Nothing else - no server to start, no node to reach.

/**
 * TEST_DATABASE_URL from the environment, or else that ONE key of the repo root's .env.
 *
 * Only that key: the rest of .env configures a running server - a port, a production NODE_ENV -
 * and a suite that inherited it would be testing a deployment rather than the code.
 */
function testDatabaseUrl(): string | undefined
{
    if (process.env.TEST_DATABASE_URL !== undefined && process.env.TEST_DATABASE_URL !== '')
    {
        return process.env.TEST_DATABASE_URL;
    }
    try
    {
        return parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8')).TEST_DATABASE_URL;
    }
    catch
    {
        return undefined;
    }
}

const database = testDatabaseUrl();
if (database !== undefined)
{
    // Set here, in the main process, so the global setup and every worker forked from it see it.
    process.env.TEST_DATABASE_URL = database;
}

export default defineConfig({
    test:
    {
        environment: 'node',
        // Fixtures live under tests/support and are not themselves tests.
        include: ['tests/**/*.spec.ts'],
        // Closes every index a test opened - see tests/support/database.ts.
        setupFiles: ['tests/support/setup.ts'],
        // Sweeps the schemas a run that died mid-way left in the test database.
        globalSetup: ['tests/support/global-setup.ts'],
        // Every worker holds a connection of its own and two per store it has open. Uncapped, a
        // many-core machine would run a worker per core and ask a default PostgreSQL - a hundred
        // connections, shared with whatever else uses that server - for more than it has.
        maxWorkers: 4
    }
});
