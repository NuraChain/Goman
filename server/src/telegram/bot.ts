import type { Logger } from '../logger.ts';

// The Telegram transport, and nothing else: what to say is decided in format.ts, when to say
// it in service.ts. No dependency - the Bot API is HTTP with a JSON body, and Node has fetch.
//
// The whole file exists because of one number: Telegram accepts roughly ONE message per second
// per chat and answers a burst with 429. This app indexes every buy, sell, claim and liquidity
// move on the chain, so a busy block can produce a dozen lines at once. Sending them
// one-by-one would spend the next minute being rate-limited and would arrive as a dozen
// notification buzzes; instead pending lines are BATCHED into one message per tick.

/** Telegram's own ceiling on a message. Batches are cut below it, not at it. */
const MESSAGE_LIMIT = 4096;

/** Room left for the join characters when packing lines into one message. */
const BATCH_LIMIT = 3800;

/** One message per chat per this, which is the documented per-chat ceiling plus a margin. */
const PACE_MS = 1100;

/** How long a single send may hang before it is abandoned; the queue outlives one failure. */
const TIMEOUT_MS = 20_000;

export interface TelegramBot {
    /** Queues one line. Returns at once - delivery is the queue's problem, not the caller's. */
    say(line: string): void;

    /** Sends now, bypassing the line queue. Resolves false when Telegram refused it. */
    sendDocument(file: { name: string; bytes: Uint8Array; caption: string }): Promise<boolean>;

    /** Drains nothing further; in-flight requests are left to finish or time out. */
    stop(): void;
}

export interface BotOptions {
    token: string;
    chatId: string;
    log: Logger;
}

export function createTelegramBot(options: BotOptions): TelegramBot {
    const base = `https://api.telegram.org/bot${options.token}`;
    const pending: string[] = [];
    let timer: ReturnType<typeof setInterval> | null = null;
    let sending = false;
    let stopped = false;

    /** Seconds Telegram asked us to wait; set by a 429 and counted down by the tick. */
    let cooldown = 0;

    const call = async (method: string, body: BodyInit, headers?: HeadersInit): Promise<unknown> => {
        const response = await fetch(`${base}/${method}`, {
            method: 'POST',
            body,
            ...(headers === undefined ? {} : { headers }),
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        const payload = (await response.json()) as {
            ok?: boolean;
            description?: string;
            parameters?: { retry_after?: number };
        };
        if (payload.ok !== true) {
            // 429 is not a failure to report, it is an instruction to wait. Everything else -
            // a revoked token, a chat the bot was removed from - is worth one log line.
            const wait = payload.parameters?.retry_after;
            if (typeof wait === 'number') {
                cooldown = wait;
                throw new Error(`rate limited for ${wait}s`);
            }
            throw new Error(payload.description ?? `telegram ${method} failed`);
        }
        return payload;
    };

    const flush = async (): Promise<void> => {
        if (sending || pending.length === 0) {
            return;
        }
        if (cooldown > 0) {
            cooldown -= PACE_MS / 1000;
            return;
        }
        // As many whole lines as fit. A single line longer than the batch limit still goes on
        // its own, truncated by the formatter rather than silently dropped here.
        const lines: string[] = [];
        let size = 0;
        while (pending.length > 0 && (lines.length === 0 || size + pending[0].length + 1 <= BATCH_LIMIT)) {
            const line = pending.shift() as string;
            lines.push(line);
            size += line.length + 1;
        }
        const text = lines.join('\n').slice(0, MESSAGE_LIMIT);

        sending = true;
        try {
            await call(
                'sendMessage',
                JSON.stringify({
                    chat_id: options.chatId,
                    text,
                    parse_mode: 'HTML',
                    link_preview_options: { is_disabled: true }
                }),
                { 'content-type': 'application/json' }
            );
        } catch (error) {
            // Put them BACK at the head of the queue: these are event notifications, and one
            // that is dropped on a transient network failure is simply never told.
            pending.unshift(...lines);
            options.log.warn('telegram send failed', { error: String(error), queued: pending.length });
        } finally {
            sending = false;
        }
    };

    timer = setInterval(() => void flush(), PACE_MS);
    // The queue must never be the reason the process cannot exit.
    timer.unref?.();

    return {
        say: (line) => {
            if (stopped) {
                return;
            }
            pending.push(line);
        },

        sendDocument: async (file) => {
            if (stopped) {
                return false;
            }
            const form = new FormData();
            form.append('chat_id', options.chatId);
            form.append('caption', file.caption.slice(0, 1024));
            // A fresh copy rather than the caller's view: a Blob over a buffer that is reused
            // for the next snapshot would upload whatever it holds by the time it is read.
            form.append('document', new Blob([new Uint8Array(file.bytes)]), file.name);
            try {
                await call('sendDocument', form);
                return true;
            } catch (error) {
                options.log.error('telegram document failed', { error: String(error), name: file.name });
                return false;
            }
        },

        stop: () => {
            stopped = true;
            if (timer !== null) {
                clearInterval(timer);
                timer = null;
            }
            pending.length = 0;
        }
    };
}
