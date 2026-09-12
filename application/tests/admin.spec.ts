// The admin contract layer that stayed client-side: the on-chain role gate (with addresses
// injected from the indexer's config, never a local map) and the display helper.
import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    readContract: vi.fn()
}));

vi.mock('../src/lib/contracts.ts', () => ({
    publicClient: { readContract: mocks.readContract },
    walletFor: vi.fn(),
    factoryAbi: [],
    marketAbi: []
}));

import { isAdmin, factoryConfig, shortEther } from '../src/lib/admin.ts';

const FACTORY = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
const OWNER = '0x430b4409891c6A821c81e92C960c94A80Ef626dc';

describe('isAdmin', () => {
    it('short-circuits a disconnected wallet without touching the chain', async () => {
        mocks.readContract.mockReset();
        await expect(isAdmin(FACTORY, '')).resolves.toBe(false);
        expect(mocks.readContract).not.toHaveBeenCalled();
    });

    it('asks hasRole with the ADMIN_ROLE the factory reports', async () => {
        mocks.readContract.mockReset();
        mocks.readContract.mockImplementation(async (call: { functionName: string; args?: unknown[] }) => {
            if (call.functionName === 'ADMIN_ROLE') {
                return '0xrole';
            }
            expect(call.functionName).toBe('hasRole');
            expect(call.args).toEqual(['0xrole', OWNER]);
            return true;
        });
        await expect(isAdmin(FACTORY, OWNER)).resolves.toBe(true);
    });
});

describe('factoryConfig', () => {
    // The implementations are READ, never configured: an operator checking a deployment needs
    // the clones the live factory actually cuts from, which is what a half-run deploy gets wrong.
    const MARKET_IMPL = '0x4b94c8F32Ff506D31d79d21D94eC1d8AE3d1F145';
    const POOL_IMPL = '0x675b24758B199c3A5674f0288dfdeaA217fB2A86';

    it('reads the fee knobs and the clones the factory cuts markets from', async () => {
        mocks.readContract.mockReset();
        mocks.readContract.mockImplementation(async (call: { functionName: string }) => {
            if (call.functionName === 'defaultFeeBps') {
                return 200;
            }
            if (call.functionName === 'defaultProtocolFeeShareBps') {
                return 5000;
            }
            return call.functionName === 'marketImplementation' ? MARKET_IMPL : POOL_IMPL;
        });
        await expect(factoryConfig(FACTORY)).resolves.toEqual({
            defaultFeeBps: 200,
            defaultProtocolFeeShareBps: 5000,
            marketImplementation: MARKET_IMPL,
            poolImplementation: POOL_IMPL
        });
    });
});

describe('shortEther', () => {
    it('trims to four decimals and drops trailing zeros', () => {
        expect(shortEther(0n)).toBe('0');
        expect(shortEther(1_000_000_000_000_000_000n)).toBe('1');
        expect(shortEther(1_500_000_000_000_000_000n)).toBe('1.5');
        expect(shortEther(1_234_567_890_000_000_000n)).toBe('1.2345');
        expect(shortEther(25_000_000_000_000_000n)).toBe('0.025');
    });
});
