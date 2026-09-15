import type { Logger } from './logger.ts';
import type { IndexStore } from './chain/store.ts';
import type { JobSigner } from './chain/signer.ts';

// Scheduled market openings.
//
// The contracts carry a lock time and a resolve time but no START time, so a market that is
// meant to open next Tuesday has nothing on chain that says so. Writing the date in the index
// and having the UI hide the market would be a curtain, not a door: `bet()` is a public
// function, and anyone reading the chain directly could take the good side of a market nobody
// else could see yet.
//
// So the enforcement is a real pause. The admin deploys the market and pauses it in the same
// breath, from their own wallet; this job lifts the pause when the clock says so. A paused
// market rejects trades in the contract, which means the guarantee holds for everyone, not
// just for people who came through this app.
//
// The consequence worth being honest about: a market scheduled this way stays shut until the
// key configured for this process opens it. Without the key it does not open on its own, and
// the console still can.

/** How often the clock is checked. A start time is a minute-grained promise, not a second. */
const TICK_MS = 15_000;

export interface OpeningsService {
    start(): void;
    stop(): void;

    /** One pass. Exposed so a test can drive it without a timer. */
    tick(): Promise<void>;
}

export interface OpeningsDeps {
    store: IndexStore;
    log: Logger;

    /** Absent in a deployment with no key: nothing is opened, and the console must do it. */
    signer?: JobSigner;

    /** Overridable so tests can drive the clock. Seconds. */
    now?: () => number;
    tickMs?: number;
}

export function createOpeningsService(deps: OpeningsDeps): OpeningsService {
    const { store, log, signer } = deps;
    const now = deps.now ?? ((): number => Math.floor(Date.now() / 1000));
    const tickMs = deps.tickMs ?? TICK_MS;

    let timer: NodeJS.Timeout | null = null;
    let running = false;

    const tick = async (): Promise<void> => {
        if (signer === undefined) {
            return;
        }
        for (const row of store.dueOpenings(now())) {
            try {
                const hash = await signer.unpause(row.market_id);
                store.markOpened(row.market_id, hash);
                log.info('market opened on schedule', { marketId: row.market_id, at: row.start_at });
            } catch (error) {
                // Left `pending` deliberately: the next tick tries again. A market that failed
                // to open is a market still shut, and giving up silently would leave it shut
                // forever with nothing but a log line to say why.
                store.markOpeningFailed(row.market_id, String(error));
                log.error('market open failed', { marketId: row.market_id, error: String(error) });
            }
        }
    };

    const loop = async (): Promise<void> => {
        while (running) {
            try {
                await tick();
            } catch (error) {
                log.error('openings tick failed', { error: String(error) });
            }
            await new Promise((resolve) => {
                timer = setTimeout(resolve, tickMs);
            });
        }
    };

    return {
        start: () => {
            if (running) {
                return;
            }
            running = true;
            if (signer === undefined) {
                log.warn('scheduled openings idle - no signer key configured');
                return;
            }
            void loop();
        },
        stop: () => {
            running = false;
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
        },
        tick
    };
}
