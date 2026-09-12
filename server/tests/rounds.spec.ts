// The round engine's state machine, against a real in-memory index and a fake chain. The
// schedule is the part that cannot be checked by reading it: every branch here is one the
// engine takes unattended, at three in the morning, with somebody's stake on the table.
import { describe, it, expect, beforeEach } from 'vitest';
import { encodeAbiParameters, parseAbiParameters } from 'viem';

import { IndexStore } from '../src/chain/store.ts';
import { createRoundsService, decodeRoundState, type RoundsService } from '../src/rounds/engine.ts';
import { decodeReport } from '../src/rounds/price.ts';
import type { PriceSource } from '../src/rounds/price.ts';
import type { RoundSigner } from '../src/chain/signer.ts';
import type { TwapPrice } from '../src/wire.ts';

const INTERVAL = 300;

/** A logger that says nothing - a failing test should print its own reason, not a log. */
const log = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };

function priceSource(): PriceSource & { set(value: number | null): void } {
    let current: TwapPrice | null = null;
    return {
        name: 'test',
        start: () => undefined,
        stop: () => undefined,
        latest: () => current,
        set: (value) => {
            current =
                value === null
                    ? null
                    : {
                          symbol: 'btc/usd',
                          value,
                          windowSeconds: 60,
                          at: new Date().toISOString(),
                          source: 'test-source'
                      };
        }
    };
}

function fakeSigner(): RoundSigner & { calls: string[]; failNext: (stage: string) => void } {
    let nextId = 100;
    const calls: string[] = [];
    let failing: string | null = null;
    const guard = (stage: string): void => {
        calls.push(stage);
        if (failing === stage) {
            throw new Error(`${stage} refused`);
        }
    };
    return {
        calls,
        failNext: (stage) => {
            failing = stage;
        },
        account: '0xbot',
        createPool: async () => {
            guard('create');
            const marketId = nextId++;
            return { marketId, address: `0x${String(marketId).padStart(40, '0')}` as `0x${string}`, hash: '0xdeploy' };
        },
        close: async () => {
            guard('close');
            return '0xclose';
        },
        resolve: async (_marketId, outcome) => {
            guard(`resolve:${outcome}`);
            return '0xresolve';
        },
        voidMarket: async () => {
            guard('void');
            return '0xvoid';
        },
        pause: async () => {
            guard('pause');
            return '0xpause';
        },
        unpause: async () => {
            guard('unpause');
            return '0xunpause';
        }
    };
}

describe('round engine', () => {
    let store: IndexStore;
    let price: ReturnType<typeof priceSource>;
    let signer: ReturnType<typeof fakeSigner>;
    let clock: number;
    let service: RoundsService;

    beforeEach(() => {
        store = new IndexStore(':memory:');
        price = priceSource();
        signer = fakeSigner();
        // Start exactly on a slot boundary so the arithmetic in each test is readable.
        clock = 1_800_000_000;
        service = createRoundsService({
            store,
            price,
            signer,
            log,
            now: () => clock,
            config: { intervalSeconds: INTERVAL, leadSeconds: 30, historyLimit: 5 }
        });
    });

    it('claims a slot once, however many times it ticks', async () => {
        price.set(100);
        await service.tick();
        await service.tick();
        await service.tick();

        expect(signer.calls.filter((call) => call === 'create')).toHaveLength(1);
        expect(store.round(clock)?.state).toBe('open');
    });

    it('runs a round through lock and settles up when the price rose', async () => {
        price.set(100);
        await service.tick();
        const epoch = clock;

        clock = epoch + INTERVAL;
        price.set(101);
        await service.tick();

        const locked = store.round(epoch);
        expect(locked?.state).toBe('locked');
        // The reference price is the one at LOCK, not the one the round opened at.
        expect(locked?.lock_price).toBe(101);
        expect(signer.calls).toContain('close');

        clock = epoch + 2 * INTERVAL;
        price.set(105);
        await service.tick();

        const settled = store.round(epoch);
        expect(settled?.state).toBe('settled');
        expect(settled?.winner).toBe(0);
        expect(settled?.close_price).toBe(105);
        expect(signer.calls).toContain('resolve:0');
    });

    it('settles down when the price fell', async () => {
        price.set(100);
        await service.tick();
        const epoch = clock;

        clock = epoch + INTERVAL;
        price.set(100);
        await service.tick();

        clock = epoch + 2 * INTERVAL;
        price.set(99.5);
        await service.tick();

        expect(store.round(epoch)?.winner).toBe(1);
        expect(signer.calls).toContain('resolve:1');
    });

    it('voids rather than picking a side when the price did not move', async () => {
        price.set(100);
        await service.tick();
        const epoch = clock;

        clock = epoch + INTERVAL;
        await service.tick();

        clock = epoch + 2 * INTERVAL;
        await service.tick();

        const row = store.round(epoch);
        expect(row?.state).toBe('voided');
        expect(row?.winner).toBeNull();
        expect(signer.calls).toContain('void');
    });

    it('holds the lock open while the price is missing, then voids past the grace', async () => {
        price.set(100);
        await service.tick();
        const epoch = clock;

        // Lock time arrives with no price: the round must NOT be settled on nothing.
        clock = epoch + INTERVAL;
        price.set(null);
        await service.tick();
        expect(store.round(epoch)?.state).toBe('open');
        expect(signer.calls).not.toContain('close');

        // Still nothing well past the measured window - everyone's stake goes back.
        clock = epoch + 2 * INTERVAL + 61;
        await service.tick();
        expect(store.round(epoch)?.state).toBe('voided');
        expect(signer.calls).toContain('void');
    });

    it('does not deploy a market for a slot whose betting window already closed', async () => {
        // A slot is claimed, then the process is away long enough to miss it entirely.
        store.claimRound({ epoch: clock, open_at: clock, lock_at: clock + INTERVAL, close_at: clock + 2 * INTERVAL });
        clock += INTERVAL + 1;

        await service.tick();

        const missed = store.round(clock - INTERVAL - 1);
        expect(missed?.state).toBe('failed');
        // The only deploy is for the CURRENT slot, never the one nobody could bet on.
        expect(signer.calls.filter((call) => call === 'create')).toHaveLength(1);
    });

    it('retries a failing step and writes the reason down', async () => {
        price.set(100);
        signer.failNext('create');
        await service.tick();

        const row = store.round(clock);
        expect(row?.state).toBe('pending');
        expect(row?.error).toContain('create refused');

        signer.failNext('none');
        await service.tick();
        expect(store.round(clock)?.state).toBe('open');
        expect(store.round(clock)?.error).toBeNull();
    });

    it('gives the money back when a round runs out of retries', async () => {
        price.set(100);
        await service.tick();
        const epoch = clock;

        clock = epoch + INTERVAL;
        signer.failNext('close');
        for (let attempt = 0; attempt < 5; attempt++) {
            await service.tick();
        }

        expect(signer.calls).toContain('void');
        expect(store.round(epoch)?.state).toBe('voided');
    });

    it('reports the live round, the locked one and the finished ones separately', async () => {
        price.set(100);
        await service.tick();
        const first = clock;

        clock = first + INTERVAL;
        price.set(102);
        await service.tick();

        const snapshot = service.snapshot();
        expect(snapshot.locked?.epoch).toBe(first);
        expect(snapshot.live?.epoch).toBe(first + INTERVAL);
        expect(snapshot.locked?.lockPrice).toBe(102);
        expect(snapshot.intervalSeconds).toBe(INTERVAL);
        expect(snapshot.price?.value).toBe(102);
    });

    it('reads the stakes on each leg from the indexed bets', async () => {
        price.set(100);
        await service.tick();
        const marketId = store.round(clock)?.market_id ?? 0;

        const bet = (idx: number, amount: number, id: string): void =>
            store.insertTrade({
                id,
                market_id: marketId,
                account: '0xabc',
                outcome_idx: idx,
                action: 'buy',
                amount,
                shares: amount,
                price: 0,
                fee: 0,
                at: clock,
                block: 1
            });
        bet(0, 1.5, 'a');
        bet(0, 0.5, 'b');
        bet(1, 3, 'c');

        const snapshot = service.snapshot();
        expect(snapshot.live?.upPool).toBe(2);
        expect(snapshot.live?.downPool).toBe(3);
    });

    // A submitted settlement. Anyone may ask for one, so what it REFUSES matters as much as
    // what it does: an early answer would be read off a price its bettors can still watch move.
    it('refuses to answer a round whose window is still running', async () => {
        price.set(100);
        await service.tick();
        const epoch = clock;

        expect(await service.submit(epoch)).toBe('early');

        clock = epoch + INTERVAL;
        await service.tick();
        // Locked, measuring, one second short of the close: still not answerable.
        clock = epoch + 2 * INTERVAL - 1;
        expect(await service.submit(epoch)).toBe('early');
        expect(store.round(epoch)?.state).toBe('locked');
    });

    it('answers a finished round on request, without waiting for a tick', async () => {
        price.set(100);
        await service.tick();
        const epoch = clock;

        clock = epoch + INTERVAL;
        await service.tick();

        clock = epoch + 2 * INTERVAL;
        price.set(107);
        expect(await service.submit(epoch)).toBe('ok');

        const row = store.round(epoch);
        expect(row?.state).toBe('settled');
        expect(row?.winner).toBe(0);
        expect(row?.close_price).toBe(107);
    });

    it('reads the price itself, so the caller cannot choose the answer', async () => {
        price.set(100);
        await service.tick();
        const epoch = clock;

        clock = epoch + INTERVAL;
        await service.tick();

        clock = epoch + 2 * INTERVAL;
        price.set(90);
        await service.submit(epoch);
        // Down, because the feed said down. The submitter supplied nothing but the moment.
        expect(store.round(epoch)?.winner).toBe(1);
        expect(signer.calls).toContain('resolve:1');
    });

    it('is idempotent: a second submit answers ok and signs nothing', async () => {
        price.set(100);
        await service.tick();
        const epoch = clock;

        clock = epoch + INTERVAL;
        await service.tick();

        clock = epoch + 2 * INTERVAL;
        price.set(120);
        await service.submit(epoch);
        const signed = signer.calls.length;

        expect(await service.submit(epoch)).toBe('ok');
        expect(signer.calls).toHaveLength(signed);
    });

    it('says so rather than settling on nothing when the feed is down', async () => {
        price.set(100);
        await service.tick();
        const epoch = clock;

        clock = epoch + INTERVAL;
        await service.tick();

        clock = epoch + 2 * INTERVAL;
        price.set(null);
        expect(await service.submit(epoch)).toBe('noprice');
        expect(store.round(epoch)?.state).toBe('locked');
    });

    it('refunds a round that reached its close without ever being locked', async () => {
        price.set(100);
        await service.tick();
        const epoch = clock;

        // The engine never ran between the lock and the close, so no reference price exists.
        clock = epoch + 2 * INTERVAL;
        expect(await service.submit(epoch)).toBe('ok');
        expect(store.round(epoch)?.state).toBe('voided');
        expect(signer.calls).toContain('void');
    });

    it('reports an epoch it has never heard of', async () => {
        expect(await service.submit(clock - INTERVAL * 99)).toBe('unknown');
    });

    it('writes nothing at all without a signer, but still reports the price', async () => {
        const readOnly = createRoundsService({
            store,
            price,
            log,
            now: () => clock,
            config: { intervalSeconds: INTERVAL }
        });
        price.set(100);
        await readOnly.tick();

        expect(store.round(clock)?.state).toBe('pending');
        expect(readOnly.snapshot().running).toBe(false);
        expect(readOnly.snapshot().price?.value).toBe(100);
        // And a submitted settlement cannot borrow a key the process does not have.
        expect(await readOnly.submit(clock)).toBe('idle');
    });
});

describe('rounds are kept out of the curated feed', () => {
    it('hides the rounds category from a listing that did not ask for it', () => {
        const store = new IndexStore(':memory:');
        const row = (id: number, category: string): void =>
            store.insertMarket(
                {
                    id,
                    address: `0x${String(id).padStart(40, '0')}`,
                    status: 0,
                    category,
                    title_json: JSON.stringify({ en: `M${id}` }),
                    emoji: '',
                    rules_json: JSON.stringify({ en: '' }),
                    image: '',
                    creator: '0xcafe',
                    created_at: 1,
                    lock_time: 2,
                    resolve_time: 3,
                    outcome_count: 2,
                    volume: 0,
                    liquidity: 0,
                    collected: 0,
                    winning_outcome: null,
                    featured: 0,
                    search_text: `m${id}`,
                    kind: 1
                },
                []
            );
        row(1, 'crypto');
        row(2, 'live-btc');
        row(3, 'live-btc');

        const feed = store.listMarkets({ hideCategory: 'live-btc', sort: 'newest', page: 1, limit: 10 });
        expect(feed.total).toBe(1);
        expect(feed.rows[0]?.id).toBe(1);

        const asked = store.listMarkets({ category: 'live-btc', sort: 'newest', page: 1, limit: 10 });
        expect(asked.total).toBe(2);

        expect(store.categories('live-btc').map((entry) => entry.id)).toEqual(['crypto']);
        store.close();
    });
});

describe('data streams report decoding', () => {
    it('refuses a schema it cannot read rather than guessing at the price', () => {
        // A v1 blob: the version lives in the first two bytes of the feed id, and there is no
        // field naming it, so an unknown one has to stop here rather than decode as something.
        const blob = `0x0001${'0'.repeat(60)}`;
        const envelope = encodeEnvelope(blob);
        expect(() => decodeReport(envelope)).toThrow(/schema v1/);
    });
});

/** Wraps a report blob in the envelope the API ships, so the decoder sees its real input. */
function encodeEnvelope(blob: string): string {
    return encodeAbiParameters(
        parseAbiParameters('bytes32[3] reportContext, bytes reportBlob, bytes32[] rs, bytes32[] ss, bytes32 rawVs'),
        [
            [`0x${'0'.repeat(64)}`, `0x${'0'.repeat(64)}`, `0x${'0'.repeat(64)}`],
            blob as `0x${string}`,
            [],
            [],
            `0x${'0'.repeat(64)}`
        ]
    );
}

/** The state column is a plain string; this pins the values the wire type accepts. */
describe('round state vocabulary', () => {
    it('maps every stored state onto the wire union', () => {
        for (const state of ['pending', 'open', 'locked', 'settled', 'voided', 'failed']) {
            expect(decodeRoundState(state)).toBe(state);
        }
        expect(decodeRoundState('nonsense')).toBe('failed');
    });
});
