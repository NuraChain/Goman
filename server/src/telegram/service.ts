import type { Logger } from '../logger.ts';
import type { IndexedEvent } from '../chain/indexer.ts';
import type { IndexStore } from '../chain/store.ts';

import { createTelegramBot, type TelegramBot } from './bot.ts';
import { lineFor } from './format.ts';
import { makeBackup } from './backup.ts';

// The Telegram side of the server: a PM for every event the indexer records, and the whole
// database plus the uploaded images on a timer.
//
// Two things it deliberately does NOT do. It never notifies during the first catch-up, because
// a fresh index replays the chain from the deploy block and would arrive as thousands of
// messages about markets that resolved months ago - `arm()` is what opens the tap, and main.ts
// calls it when the indexer says it has reached the head. And it never lets a Telegram failure
// reach the caller: a chat that is unreachable is not a reason for the indexer to stop.

/** How long after a failed backup before trying again, rather than waiting a whole period. */
const RETRY_MS = 60_000;

export interface TelegramService {
    /** Starts the backup timer and says hello. */
    start(): void;

    /** Opens the event feed. Before this every batch is counted and dropped. */
    arm(): void;

    /** Hands one indexed batch to the feed. Safe to call before {@link arm}. */
    onEvents(events: readonly IndexedEvent[]): void;

    /** Builds and sends one archive now. Resolves false when it could not be delivered. */
    backupNow(): Promise<boolean>;

    stop(): void;
}

export interface TelegramOptions {
    token: string;
    chatId: string;
    store: IndexStore;
    log: Logger;

    /** Where uploaded images live; bundled into every archive. */
    uploadDir: string;

    /** Minutes between backups. */
    backupMinutes: number;

    /** Native ticker for amounts, and the public site root for market links ('' for none). */
    symbol: string;
    siteUrl: string;

    /** Off silences the per-event feed and keeps the backups. */
    events: boolean;

    /** Injectable so a test can drive the transport without the network. */
    bot?: TelegramBot;
}

export function createTelegramService(options: TelegramOptions): TelegramService {
    const bot = options.bot ?? createTelegramBot({ token: options.token, chatId: options.chatId, log: options.log });

    let armed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    let skipped = 0;

    const periodMs = Math.max(1, options.backupMinutes) * 60_000;

    const backupNow = async (): Promise<boolean> => {
        const archive = await makeBackup({ store: options.store, uploadDir: options.uploadDir, log: options.log });
        if (archive === null) {
            return false;
        }
        return bot.sendDocument({ name: archive.name, bytes: archive.bytes, caption: archive.caption });
    };

    /** Self-rescheduling rather than an interval: a slow upload must not overlap the next one,
     *  and a failure retries sooner than a whole period away. */
    const tick = async (): Promise<void> => {
        let ok = false;
        try {
            ok = await backupNow();
        } catch (error) {
            options.log.error('backup failed', { error: String(error) });
        }
        if (running) {
            timer = setTimeout(() => void tick(), ok ? periodMs : RETRY_MS);
            timer.unref?.();
        }
    };

    return {
        start: () => {
            running = true;
            bot.say('✅ <b>Goman server started</b>');
            timer = setTimeout(() => void tick(), periodMs);
            timer.unref?.();
        },

        arm: () => {
            armed = true;
            if (skipped > 0) {
                // Said out loud rather than passed over: the operator should know the feed
                // began at the head and that the backfill was not reported.
                bot.say(`📚 <b>Index caught up</b> · ${skipped} historical events were not reported`);
                skipped = 0;
            }
        },

        onEvents: (events) => {
            if (!options.events) {
                return;
            }
            if (!armed) {
                skipped += events.length;
                return;
            }
            for (const event of events) {
                const line = lineFor(event, {
                    store: options.store,
                    symbol: options.symbol,
                    siteUrl: options.siteUrl
                });
                if (line !== null) {
                    bot.say(line);
                }
            }
        },

        backupNow,

        stop: () => {
            running = false;
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
            bot.stop();
        }
    };
}
