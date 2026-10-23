import { afterAll, afterEach } from 'vitest';

import { closeTestDatabase, releaseTestStores } from './database.ts';

// Runs around every test in every file: whatever indexes a test opened are closed here rather than
// by each spec remembering to, the ones a file shared go after its last test, and the worker lets
// go of the database at the end.
afterEach(releaseTestStores);
afterAll(closeTestDatabase);
