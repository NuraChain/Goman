// Vitest setup for the client suite. React Testing Library only auto-cleans when the test
// framework exposes a global `afterEach`, which `globals: true` in vite.config.ts provides -
// this file makes that dependency explicit rather than implicit.
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
    cleanup();
});
