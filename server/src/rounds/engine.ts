import type { Logger } from '../logger.ts';
import type { IndexStore, RoundRow } from '../chain/store.ts';
import {
    encodeTextMeta,
    encodeTitleMeta,
    ROUND_STATES,
    ROUNDS_CATEGORY,
    type Round,
    type RoundState,
    type RoundsSnapshot
} from '../wire.ts';

import type { PriceSource } from './price.ts';
import type { RoundSigner } from '../chain/signer.ts';

// The round engine: a clock, a price, and a key.
//
// Each slot is one ordinary parimutuel market with two legs, deployed a little before the slot
// opens. Bets are taken for one interval; then the market is CLOSED and the TWAP is written
// down; one interval later the TWAP is read again and the move decides the answer. The two
// windows never overlap, so nobody can bet on a move they have already watched happen.
//
// The schedule lives in sqlite, not in memory, and the slot is the primary key. That is what
// makes a restart safe: the engine re-reads what it owes and carries on, rather than deploying
// a second market for a slot it already claimed.
//
// Every failure path ends in a refund. If the price is not available when a round needs it, the
// round is voided rather than settled on a stale number or left open forever - a paid-out wrong
// answer is worse than no answer.

/** On-chain outcome indices. Order is fixed forever: a round deployed today must read the same
 *  way next year, and the index is what `bet()` and `confirmResolution()` take. */
const UP = 0;
const DOWN = 1;

/** How long past a deadline the engine keeps waiting for a fresh price before voiding. */
const PRICE_GRACE_SECONDS = 60;

/** Consecutive chain failures on one round before it is written off. */
const MAX_ATTEMPTS = 5;

export interface RoundsConfig {
    /** Seconds per window. The betting window and the measured window are each this long. */
    intervalSeconds: number;

    /** How early a slot's market is deployed, in seconds, so betting can start on time. */
    leadSeconds: number;

    /** How often the engine looks at the clock. */
    tickMs: number;

    /** Trading fee in basis points; 0 takes the factory's default. */
    feeBps: number;
    protocolFeeShareBps: number;

    /** How many finished rounds the snapshot carries. */
    historyLimit: number;
}

export const DEFAULT_ROUNDS_CONFIG: RoundsConfig = {
    intervalSeconds: 600,
    leadSeconds: 30,
    tickMs: 2_000,
    feeBps: 0,
    protocolFeeShareBps: 0,
    historyLimit: 12
};

/**
 * What a submitted settlement did.
 *
 * `ok` covers "settled now" and "was already settled" alike - both leave the caller looking at
 * an answered round, and a page that treated the second as an error would show one to whoever
 * pressed a moment later than someone else.
 */
export type SubmitOutcome = 'ok' | 'early' | 'unknown' | 'idle' | 'noprice' | 'busy';

export interface RoundsService {
    start(): void;
    stop(): void;
    snapshot(historyLimit?: number): RoundsSnapshot;

    /** One pass of the state machine. Exposed so a test can drive it without a timer. */
    tick(): Promise<void>;

    /**
     * Answer one round NOW rather than on the next tick. Anyone may ask: the engine re-reads
     * the TWAP and signs it itself, so the caller chooses WHEN the work happens and never what
     * the answer is. It is the same three steps the tick runs, on request.
     */
    submit(epoch: number): Promise<SubmitOutcome>;
}

export interface RoundsDeps {
    store: IndexStore;
    price: PriceSource;
    log: Logger;

    /** Absent in a deployment with no key: the price still flows, nothing is written. */
    signer?: RoundSigner;
    config?: Partial<RoundsConfig>;

    /** Overridable so tests can drive the clock. Seconds. */
    now?: () => number;
}

/** The slot a timestamp belongs to. Slots are aligned to the interval, not to process start. */
function slotOf(at: number, interval: number): number {
    return Math.floor(at / interval) * interval;
}

/**
 * The state column back as the wire union. The column is a plain string - sqlite has no enum -
 * so a row written by an older build, or edited by hand, must land on a value the response
 * schema accepts. Anything unrecognised reads as `failed`: the engine will not act on it, and
 * the page shows it as a round that did not happen rather than dropping it silently.
 */
export function decodeRoundState(raw: string): RoundState {
    return (ROUND_STATES as readonly string[]).includes(raw) ? (raw as RoundState) : 'failed';
}

/**
 * A round on the wire. Stakes come from the indexed bets rather than the market's balance,
 * which also holds whatever winners have not claimed yet.
 */
export function presentRound(row: RoundRow, stakes: Map<number, number>): Round {
    return {
        epoch: row.epoch,
        state: decodeRoundState(row.state),
        marketId: row.market_id === null ? null : String(row.market_id),
        address: row.address,
        opensAt: new Date(row.open_at * 1000).toISOString(),
        locksAt: new Date(row.lock_at * 1000).toISOString(),
        closesAt: new Date(row.close_at * 1000).toISOString(),
        lockPrice: row.lock_price,
        closePrice: row.close_price,
        priceSource: row.price_source,
        upPool: stakes.get(UP) ?? 0,
        downPool: stakes.get(DOWN) ?? 0,
        winner: row.winner === null ? null : row.winner === UP ? 'up' : 'down',
        settleTx: row.settle_tx
    };
}

/**
 * A round's on-chain text. English only, deliberately: this string is written 144 times a day
 * and every translation is bytes somebody pays for. The /live page names a round from its own
 * dictionary; the envelope is what a reader who opens the market page directly sees, and an
 * envelope carrying only `en` already reads as English in every locale.
 */
function roundText(symbol: string, lockAt: number, closeAt: number): { title: string; description: string } {
    const clock = (at: number): string => new Date(at * 1000).toISOString().slice(11, 16);
    const ticker = symbol.toUpperCase();
    return {
        title: encodeTitleMeta({
            en: `${ticker} Up or Down · ${clock(lockAt)}-${clock(closeAt)} UTC`,
            emoji: '⚡'
        }),
        description: encodeTextMeta({
            en:
                `Does ${ticker} close higher than it locked? Bets close at ${clock(lockAt)} UTC, when the ` +
                `Chainlink 60-second TWAP is recorded. The same TWAP is read again at ${clock(closeAt)} UTC: ` +
                'Up wins if it is higher, Down wins if it is lower, and an unchanged price refunds every stake.'
        })
    };
}

export function createRoundsService(deps: RoundsDeps): RoundsService {
    const config = { ...DEFAULT_ROUNDS_CONFIG, ...deps.config };
    const { store, price, log, signer } = deps;
    const now = deps.now ?? ((): number => Math.floor(Date.now() / 1000));
    const symbol = 'btc/usd';

    let timer: NodeJS.Timeout | null = null;
    let running = false;

    /** Consecutive chain failures per slot. In memory: a restart is itself a fresh attempt. */
    const attempts = new Map<number, number>();

    /** Slots with a step in flight. The tick and a submitted settlement run on different
     *  schedules, so without this both could send a transaction for the same answer. */
    const working = new Set<number>();

    /** Runs one step under the slot's lock. False when somebody else already holds it. */
    const step = async (epoch: number, run: () => Promise<void>): Promise<boolean> => {
        if (working.has(epoch)) {
            return false;
        }
        working.add(epoch);
        try {
            await run();
        } finally {
            working.delete(epoch);
        }
        return true;
    };

    const fail = (row: RoundRow, stage: string, error: unknown): void => {
        const count = (attempts.get(row.epoch) ?? 0) + 1;
        attempts.set(row.epoch, count);
        log.error('round step failed', { epoch: row.epoch, stage, attempt: count, error: String(error) });
        store.updateRound(row.epoch, { error: `${stage}: ${String(error)}` });
        if (count >= MAX_ATTEMPTS) {
            // Out of retries. A round with a market still on chain is voided so its stakes come
            // back; one that never got a market has nothing to refund and is simply written off.
            attempts.delete(row.epoch);
            if (row.market_id === null) {
                store.updateRound(row.epoch, { state: 'failed' });
            } else {
                void giveUp(row);
            }
        }
    };

    const giveUp = async (row: RoundRow): Promise<void> => {
        if (signer === undefined || row.market_id === null) {
            return;
        }
        try {
            const hash = await signer.voidMarket(row.market_id);
            store.updateRound(row.epoch, { state: 'voided', settle_tx: hash });
            log.warn('round voided', { epoch: row.epoch, reason: 'gave up' });
        } catch (error) {
            log.error('round void failed', { epoch: row.epoch, error: String(error) });
            store.updateRound(row.epoch, { state: 'failed', error: `void: ${String(error)}` });
        }
    };

    /** Claims a slot and deploys its market. Idempotent: the row's PRIMARY KEY is the guard. */
    const open = async (epoch: number): Promise<void> => {
        const interval = config.intervalSeconds;
        const row = store.claimRound({
            epoch,
            open_at: epoch,
            lock_at: epoch + interval,
            close_at: epoch + 2 * interval
        });
        if (row.state !== 'pending' || signer === undefined) {
            return;
        }
        // Nobody could have bet on a window that has already closed, so there is nothing to
        // deploy - only a row explaining the gap.
        if (now() >= row.lock_at) {
            store.updateRound(epoch, { state: 'failed', error: 'missed: lock time passed before deploy' });
            return;
        }
        try {
            const text = roundText(symbol, row.lock_at, row.close_at);
            const created = await signer.createPool({
                title: text.title,
                description: text.description,
                category: ROUNDS_CATEGORY,
                imageURI: '',
                lockTime: row.lock_at,
                resolveTime: row.close_at,
                feeBps: config.feeBps,
                protocolFeeShareBps: config.protocolFeeShareBps,
                outcomeNames: [encodeTextMeta({ en: 'Up' }), encodeTextMeta({ en: 'Down' })]
            });
            attempts.delete(epoch);
            store.updateRound(epoch, {
                state: 'open',
                market_id: created.marketId,
                address: created.address.toLowerCase(),
                create_tx: created.hash,
                error: null
            });
            log.info('round opened', { epoch, marketId: created.marketId });
        } catch (error) {
            fail(row, 'open', error);
        }
    };

    /**
     * Ends betting and writes down the reference price. The CLOSE is what actually stops bets -
     * the engine does not assume the clone enforces its own lockTime, because a round that kept
     * taking bets after the price was fixed would be free money for whoever noticed.
     */
    const lock = async (row: RoundRow): Promise<void> => {
        if (signer === undefined || row.market_id === null) {
            return;
        }
        const observed = price.latest();
        if (observed === null) {
            // No price and the measured window is already over: this round can never be
            // answered honestly, so everyone gets their stake back.
            if (now() >= row.close_at + PRICE_GRACE_SECONDS) {
                log.warn('round voided', { epoch: row.epoch, reason: 'no price at lock' });
                await giveUp(row);
            }
            return;
        }
        try {
            const hash = await signer.close(row.market_id);
            attempts.delete(row.epoch);
            store.updateRound(row.epoch, {
                state: 'locked',
                lock_price: observed.value,
                price_source: observed.source,
                close_tx: hash,
                error: null
            });
            log.info('round locked', { epoch: row.epoch, price: observed.value, source: observed.source });
        } catch (error) {
            fail(row, 'lock', error);
        }
    };

    /** Reads the price again and answers the round. An unchanged price refunds instead. */
    const settle = async (row: RoundRow): Promise<void> => {
        if (signer === undefined || row.market_id === null || row.lock_price === null) {
            return;
        }
        const observed = price.latest();
        if (observed === null) {
            if (now() >= row.close_at + PRICE_GRACE_SECONDS) {
                log.warn('round voided', { epoch: row.epoch, reason: 'no price at close' });
                await giveUp(row);
            }
            return;
        }
        try {
            if (observed.value === row.lock_price) {
                const hash = await signer.voidMarket(row.market_id);
                attempts.delete(row.epoch);
                store.updateRound(row.epoch, {
                    state: 'voided',
                    close_price: observed.value,
                    settle_tx: hash,
                    error: null
                });
                log.info('round flat', { epoch: row.epoch, price: observed.value });
                return;
            }
            const winner = observed.value > row.lock_price ? UP : DOWN;
            const hash = await signer.resolve(row.market_id, winner);
            attempts.delete(row.epoch);
            store.updateRound(row.epoch, {
                state: 'settled',
                close_price: observed.value,
                winner,
                settle_tx: hash,
                error: null
            });
            log.info('round settled', {
                epoch: row.epoch,
                lock: row.lock_price,
                close: observed.value,
                winner: winner === UP ? 'up' : 'down'
            });
        } catch (error) {
            fail(row, 'settle', error);
        }
    };

    const tick = async (): Promise<void> => {
        const at = now();
        // `+ lead` reaches into the next slot early, so its market is on chain and taking bets
        // the moment the slot starts rather than one deploy later.
        const next = slotOf(at + config.leadSeconds, config.intervalSeconds);
        await step(next, () => open(next));

        for (const row of store.unfinishedRounds()) {
            if (row.state === 'pending') {
                await step(row.epoch, () => open(row.epoch));
            } else if (row.state === 'open' && at >= row.lock_at) {
                await step(row.epoch, () => lock(row));
            } else if (row.state === 'locked' && at >= row.close_at) {
                await step(row.epoch, () => settle(row));
            }
        }
    };

    /**
     * A round asked to answer itself. The window has to be over - not "nearly over" - because
     * the closing TWAP is read at the moment of the call, and a round answered a minute early
     * would be answered from a price its bettors could still watch moving.
     */
    const submit = async (epoch: number): Promise<SubmitOutcome> => {
        if (signer === undefined) {
            return 'idle';
        }
        const row = store.round(epoch);
        if (row === null) {
            return 'unknown';
        }
        if (row.state === 'settled' || row.state === 'voided' || row.state === 'failed') {
            return 'ok';
        }
        if (working.has(epoch)) {
            return 'busy';
        }
        if (now() < row.close_at) {
            return 'early';
        }
        if (row.state === 'pending' || row.state === 'open') {
            // Past its own close with no reference price ever taken: there is no honest answer
            // to give, only stakes to hand back.
            await step(epoch, () => giveUp(row));
            return store.round(epoch)?.state === 'voided' ? 'ok' : 'noprice';
        }
        await step(epoch, () => settle(row));
        return store.round(epoch)?.state === 'locked' ? 'noprice' : 'ok';
    };

    const loop = async (): Promise<void> => {
        while (running) {
            try {
                await tick();
            } catch (error) {
                log.error('rounds tick failed', { error: String(error) });
            }
            await new Promise((resolve) => {
                timer = setTimeout(resolve, config.tickMs);
            });
        }
    };

    const stakesOf = (row: RoundRow): Map<number, number> =>
        row.market_id === null ? new Map() : store.stakeByOutcome(row.market_id);

    return {
        start: () => {
            if (running) {
                return;
            }
            running = true;
            price.start();
            if (signer === undefined) {
                log.warn('rounds engine idle - no signer key configured');
                return;
            }
            log.info('rounds engine started', { signer: signer.account, interval: config.intervalSeconds });
            void loop();
        },

        stop: () => {
            running = false;
            price.stop();
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
        },

        tick,
        submit,

        snapshot: (historyLimit) => {
            const open = store.roundsInState('open', 1)[0] ?? null;
            const locked = store.roundsInState('locked', 1)[0] ?? null;
            const history = store.finishedRounds(historyLimit ?? config.historyLimit);
            return {
                price: price.latest(),
                intervalSeconds: config.intervalSeconds,
                running: running && signer !== undefined,
                live: open === null ? null : presentRound(open, stakesOf(open)),
                locked: locked === null ? null : presentRound(locked, stakesOf(locked)),
                history: history.map((row) => presentRound(row, stakesOf(row)))
            };
        }
    };
}
