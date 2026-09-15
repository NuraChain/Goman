// Scheduled market openings: the store's rules and the job that lifts the pause.
//
// The contracts have no start time, so everything that makes "opens on Tuesday" true lives in
// these two places. A bug here does not render wrong - it lets a market take bets days early,
// or leaves one shut past the hour it advertised.
import { describe, it, expect, beforeEach } from 'vitest';

import { IndexStore } from '../src/chain/store.ts';
import { createOpeningsService } from '../src/openings.ts';
import type { JobSigner } from '../src/chain/signer.ts';

const log = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };

function fakeSigner(): JobSigner & { unpaused: number[]; fail: boolean } {
    const state = {
        unpaused: [] as number[],
        fail: false,
        account: '0xbot' as `0x${string}`,
        createPool: async () => ({ marketId: 0, address: '0x0' as `0x${string}`, hash: '0x' as `0x${string}` }),
        close: async () => '0x' as `0x${string}`,
        resolve: async () => '0x' as `0x${string}`,
        voidMarket: async () => '0x' as `0x${string}`,
        pause: async () => '0xpause' as `0x${string}`,
        unpause: async (marketId: number) => {
            if (state.fail) {
                throw new Error('rpc down');
            }
            state.unpaused.push(marketId);
            return '0xopen' as `0x${string}`;
        }
    };
    return state;
}

describe('the openings schedule', () => {
    let store: IndexStore;

    beforeEach(() => {
        store = new IndexStore(':memory:');
    });

    it('keeps one row per market, so re-submitting a time moves it rather than adding one', () => {
        store.scheduleOpening(7, 1000);
        store.scheduleOpening(7, 2000);
        expect(store.opening(7)?.start_at).toBe(2000);
        expect(store.dueOpenings(5000)).toHaveLength(1);
    });

    it('reports only the markets whose time has actually come', () => {
        store.scheduleOpening(1, 1000);
        store.scheduleOpening(2, 3000);
        expect(store.dueOpenings(2000).map((row) => row.market_id)).toEqual([1]);
        expect(store.dueOpenings(3000).map((row) => row.market_id)).toEqual([1, 2]);
    });

    it('does not re-open a market it already opened', () => {
        store.scheduleOpening(1, 1000);
        store.markOpened(1, '0xabc');
        expect(store.dueOpenings(9000)).toHaveLength(0);
        // An edit after the fact must not re-arm it either - the pause is long gone.
        store.scheduleOpening(1, 8000);
        expect(store.dueOpenings(9000)).toHaveLength(0);
    });

    it('forgets a schedule that was cleared, so a hand-opened market is not opened twice', () => {
        store.scheduleOpening(1, 1000);
        store.clearOpening(1);
        expect(store.opening(1)).toBeNull();
        expect(store.dueOpenings(9000)).toHaveLength(0);
    });

    it('joins start times for a whole page in one read', () => {
        store.scheduleOpening(1, 1000);
        store.scheduleOpening(3, 3000);
        const found = store.openingsFor([1, 2, 3]);
        expect(found.get(1)).toBe(1000);
        expect(found.get(2)).toBeUndefined();
        expect(found.get(3)).toBe(3000);
        expect(store.openingsFor([]).size).toBe(0);
    });
});

describe('the openings job', () => {
    let store: IndexStore;
    let signer: ReturnType<typeof fakeSigner>;
    let clock: number;

    beforeEach(() => {
        store = new IndexStore(':memory:');
        signer = fakeSigner();
        clock = 5000;
    });

    const service = (withSigner = true): ReturnType<typeof createOpeningsService> =>
        createOpeningsService({ store, log, signer: withSigner ? signer : undefined, now: () => clock });

    it('lifts the pause once the start time arrives, and only then', async () => {
        store.scheduleOpening(4, 6000);
        const job = service();

        await job.tick();
        expect(signer.unpaused).toEqual([]);

        clock = 6000;
        await job.tick();
        expect(signer.unpaused).toEqual([4]);
        expect(store.opening(4)?.state).toBe('opened');
        expect(store.opening(4)?.tx).toBe('0xopen');
    });

    it('opens each market once, however many times it ticks', async () => {
        store.scheduleOpening(4, 1000);
        const job = service();
        await job.tick();
        await job.tick();
        await job.tick();
        expect(signer.unpaused).toEqual([4]);
    });

    it('keeps retrying a market it could not open rather than leaving it shut in silence', async () => {
        store.scheduleOpening(4, 1000);
        signer.fail = true;
        const job = service();

        await job.tick();
        expect(store.opening(4)?.state).toBe('pending');
        expect(store.opening(4)?.error).toContain('rpc down');

        signer.fail = false;
        await job.tick();
        expect(signer.unpaused).toEqual([4]);
        expect(store.opening(4)?.state).toBe('opened');
        expect(store.opening(4)?.error).toBeNull();
    });

    it('leaves every schedule alone when the deployment has no key', async () => {
        store.scheduleOpening(4, 1000);
        await service(false).tick();
        expect(store.opening(4)?.state).toBe('pending');
    });
});
