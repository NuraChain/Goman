import type { Logger } from '@azerothjs/logger';

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

/**
 * Seconds getUpdates may hold a request open waiting for a message. Telegram returns the
 * moment one arrives, so this only governs how long an IDLE connection sits there.
 *
 * Kept short on purpose. A long window is cheaper in theory - fewer requests - but an idle TCP
 * connection is exactly what NAT tables, proxies and filtering middleboxes reap, and each reap
 * surfaces as ECONNRESET. Ten seconds is under the shortest idle timeout worth designing
 * around, and costs six requests a minute on a quiet bot.
 */
const POLL_SECONDS = 10;

/** The poll's own ceiling, comfortably past the long-poll window it is waiting on. */
const POLL_TIMEOUT_MS = (POLL_SECONDS + 15) * 1000;

/**
 * Two different waits, because there are two different failures.
 *
 * A dropped connection - ECONNRESET, a socket timeout, undici giving up - is the ordinary cost
 * of holding a long poll open across the public internet, and the only correct response is to
 * open another one at once. Backing off there would mean a network that resets idle sockets
 * could make the bot answer minutes late, or look dead, while nothing was actually wrong.
 *
 * Anything else - a revoked token, a host that will not resolve - repeats identically however
 * fast it is retried, so it doubles up to a ceiling instead of hammering.
 */
const POLL_DROP_RETRY_MS = 500;
const POLL_RETRY_MS = 5000;
const POLL_MAX_RETRY_MS = 5 * 60_000;

/**
 * Whether a poll failure is a dropped connection rather than a fault.
 *
 * Matched on the codes undici and Node actually raise; the string check catches the timeout
 * shapes that arrive as a name rather than a code. Anything unrecognised is treated as a real
 * fault, which is the safe way round: a genuine outage retried too slowly is a late bot, but a
 * fault retried every half second is a hot loop against someone else's API.
 */
export function isDropped(error: unknown): boolean
{
    const codes = new Set([
        'ECONNRESET',
        'ETIMEDOUT',
        'ECONNABORTED',
        'EPIPE',
        'UND_ERR_SOCKET',
        'UND_ERR_CONNECT_TIMEOUT',
        'UND_ERR_HEADERS_TIMEOUT',
        'UND_ERR_BODY_TIMEOUT'
    ]);
    let current: unknown = error;
    for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth += 1)
    {
        const entry = current as { code?: unknown; name?: unknown; cause?: unknown };
        if (typeof entry.code === 'string' && codes.has(entry.code))
        {
            return true;
        }
        if (entry.name === 'TimeoutError' || entry.name === 'AbortError')
        {
            return true;
        }
        current = entry.cause;
    }
    return false;
}

/** Longest inbound text accepted. Past this the message is ignored: nothing the bot answers
 *  needs a thousand characters of it. */
const INCOMING_MAX = 1000;

/** One inbound message, reduced to what a command needs. */
export interface Incoming {
    /** The chat to answer in. For a private message this equals the sender's id. */
    chatId: string;

    /** True when this is a one-to-one chat rather than a group or channel. */
    private: boolean;

    /** The numeric sender id, which is the identity the allowlist is keyed on. */
    from: string;

    /** The sender's @name without its @, or '' for an account that has none. */
    username: string;

    /** The message text, trimmed. Non-text messages never reach a handler. */
    text: string;
}

/**
 * An error as a log line worth reading.
 *
 * `String(err)` on a failed fetch gives "TypeError: fetch failed" and nothing else - undici
 * puts the actual fault (ENOTFOUND, ECONNREFUSED, ETIMEDOUT, a TLS failure) on `cause`, one
 * or two levels down. An operator staring at "fetch failed" cannot tell a blocked host from a
 * dead DNS server from an expired certificate, so the chain is unwrapped here.
 *
 * Exported for its test: it is the difference between a log line that names the fault and one
 * that says nothing, and nothing else in the file would fail if it quietly stopped working.
 */
export function reason(error: unknown): string
{
    const parts: string[] = [];
    let current: unknown = error;
    for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth += 1)
    {
        const entry = current as { message?: unknown; code?: unknown; cause?: unknown };
        const code = typeof entry.code === 'string' ? entry.code : '';
        const message = typeof entry.message === 'string' ? entry.message : String(current);
        const line = code === '' ? message : `${ code }: ${ message }`;
        if (line !== '' && !parts.includes(line))
        {
            parts.push(line);
        }
        current = entry.cause;
    }
    return parts.length === 0 ? String(error) : parts.join(' <- ');
}

/** Telegram's update envelope, narrowed to the fields the poll loop reads. */
interface TelegramUpdate {
    update_id: number;
    message?: {
        chat: { id: number | string; type?: string };
        from?: { id: number | string; username?: string; is_bot?: boolean };
        text?: string;
    };
}

export interface TelegramBot {
    /** Queues one line. Returns at once - delivery is the queue's problem, not the caller's. */
    say(line: string): void;

    /** Answers ONE chat, outside the feed's queue and its pacing. The feed is a firehose into
     *  a single chat; a reply is one message to whoever just typed, and making it wait behind
     *  a batch of trade notifications would read as the bot ignoring them.
     *
     *  `expectReply` forces the sender's client to open a reply box aimed at this message. It
     *  is not decoration: in a GROUP, a bot with privacy mode on (the BotFather default, and
     *  what this bot is set to) never sees an ordinary message. It sees slash commands, and it
     *  sees replies to its own messages. A question the bot asks is therefore only answerable
     *  if the answer is a reply, so every prompt in a conversation asks for one. */
    reply(chatId: string, text: string, expectReply?: boolean): Promise<boolean>;

    /** Sends now, bypassing the line queue. Resolves false when Telegram refused it. */
    sendDocument(file: { name: string; bytes: Uint8Array; caption: string }): Promise<boolean>;

    /** Starts long-polling for commands and hands each text message to `handler`.
     *
     *  Long-polling rather than a webhook on purpose: a webhook needs a public HTTPS URL that
     *  Telegram can reach, which this server is not guaranteed to have, and it would put an
     *  unauthenticated route on the same origin as the console. getUpdates needs neither. */
    listen(handler: (message: Incoming) => Promise<void>): void;

    /** The bot's own @name, read once at listen time; '' until then or when unreadable. */
    name(): string;

    /** Drains nothing further; in-flight requests are left to finish or time out. */
    stop(): void;
}

export interface BotOptions {
    token: string;
    chatId: string;
    log: Logger;
}

export function createTelegramBot(options: BotOptions): TelegramBot
{
    const base = `https://api.telegram.org/bot${ options.token }`;
    const pending: string[] = [];
    let timer: ReturnType<typeof setInterval> | null = null;
    let sending = false;
    let stopped = false;

    /** Seconds Telegram asked us to wait; set by a 429 and counted down by the tick. */
    let cooldown = 0;

    const call = async (
        method: string,
        body: BodyInit,
        headers?: HeadersInit,
        timeoutMs: number = TIMEOUT_MS
    ): Promise<unknown> =>
    {
        const response = await fetch(`${ base }/${ method }`, {
            method: 'POST',
            body,
            ...(headers === undefined ? {} : { headers }),
            signal: AbortSignal.timeout(timeoutMs)
        });
        const payload = (await response.json()) as {
            ok?: boolean;
            description?: string;
            parameters?: { retry_after?: number };
        };
        if (payload.ok !== true)
        {
            // 429 is not a failure to report, it is an instruction to wait. Everything else -
            // a revoked token, a chat the bot was removed from - is worth one log line.
            const wait = payload.parameters?.retry_after;
            if (typeof wait === 'number')
            {
                cooldown = wait;
                throw new Error(`rate limited for ${ wait }s`);
            }
            throw new Error(payload.description ?? `telegram ${ method } failed`);
        }
        return payload;
    };

    /** Sends one message to one chat. Shared by the reply path and the feed's flush. */
    const send = async (chatId: string, text: string, expectReply = false): Promise<void> =>
    {
        await call(
            'sendMessage',
            JSON.stringify({
                chat_id: chatId,
                text: text.slice(0, MESSAGE_LIMIT),
                parse_mode: 'HTML',
                link_preview_options: { is_disabled: true },
                // `selective` aims the reply box at the person who asked, so a prompt in a busy
                // group does not open a keyboard for everyone in it.
                ...(expectReply ? { reply_markup: { force_reply: true, selective: true } } : {})
            }),
            { 'content-type': 'application/json' }
        );
    };

    const flush = async (): Promise<void> =>
    {
        if (sending || pending.length === 0)
        {
            return;
        }
        if (cooldown > 0)
        {
            cooldown -= PACE_MS / 1000;
            return;
        }
        // As many whole lines as fit. A single line longer than the batch limit still goes on
        // its own, truncated by the formatter rather than silently dropped here.
        const lines: string[] = [];
        let size = 0;
        while (pending.length > 0 && (lines.length === 0 || size + pending[0].length + 1 <= BATCH_LIMIT))
        {
            const line = pending.shift() as string;
            lines.push(line);
            size += line.length + 1;
        }
        const text = lines.join('\n').slice(0, MESSAGE_LIMIT);

        sending = true;
        try
        {
            await send(options.chatId, text);
        }
        catch (error)
        {
            // Put them BACK at the head of the queue: these are event notifications, and one
            // that is dropped on a transient network failure is simply never told.
            pending.unshift(...lines);
            options.log.warn('telegram send failed', { error: reason(error), queued: pending.length });
        }
        finally
        {
            sending = false;
        }
    };

    timer = setInterval(() => void flush(), PACE_MS);
    // The queue must never be the reason the process cannot exit.
    timer.unref?.();

    /** Raised past the last update handed to the handler, which is how Telegram is told the
     *  batch was taken: an offset is an ACK, and without it the same messages arrive forever. */
    let offset = 0;
    let polling = false;
    let botName = '';

    /** Consecutive poll failures, which drive the backoff and keep the log from repeating. */
    let failures = 0;
    let lastFailure = '';

    /** Dropped connections since boot. Not failures - see isDropped - but worth a count. */
    let drops = 0;

    const poll = async (handler: (message: Incoming) => Promise<void>): Promise<void> =>
    {
        while (polling)
        {
            try
            {
                const payload = (await call(
                    'getUpdates',
                    JSON.stringify({
                        offset,
                        timeout: POLL_SECONDS,
                        // Only what a command can arrive in. Telegram keeps everything else
                        // out of the queue entirely rather than making this loop skip it.
                        allowed_updates: ['message']
                    }),
                    { 'content-type': 'application/json' },
                    // Past the long-poll window it is waiting on. The send timeout is shorter
                    // than that window, and would abort every idle poll on the way to it.
                    POLL_TIMEOUT_MS
                )) as { result?: TelegramUpdate[] };

                if (failures > 0)
                {
                    options.log.info('telegram poll recovered', { afterAttempts: failures });
                    failures = 0;
                    lastFailure = '';
                }

                for (const update of payload.result ?? [])
                {
                    // Raised BEFORE the handler runs, not after. A message that makes a
                    // handler throw is a message that would be redelivered on the next poll
                    // and throw again, and the loop would never advance past it.
                    offset = Math.max(offset, update.update_id + 1);

                    const message = update.message;
                    const text = message?.text?.trim() ?? '';
                    const from = message?.from;
                    if (message === undefined || from === undefined || text === '' || from.is_bot === true)
                    {
                        continue;
                    }
                    try
                    {
                        await handler({
                            chatId: String(message.chat.id),
                            private: message.chat.type === 'private',
                            from: String(from.id),
                            username: from.username ?? '',
                            text: text.slice(0, INCOMING_MAX)
                        });
                    }
                    catch (error)
                    {
                        options.log.warn('telegram command failed', { error: reason(error), from: String(from.id) });
                    }
                }
            }
            catch (error)
            {
                if (!polling)
                {
                    return;
                }
                const why = reason(error);

                // A dropped long poll is not an outage. Reconnect straight away and say nothing:
                // on a path that reaps idle sockets this is the normal shape of every cycle, and
                // logging it would bury the failures that do mean something.
                if (isDropped(error))
                {
                    drops += 1;
                    // Still counted, and mentioned occasionally - a path dropping every single
                    // poll is worth knowing about even though the bot works through it.
                    if (drops % 50 === 0)
                    {
                        options.log.info('telegram poll reconnecting', { drops, lastError: why });
                    }
                    await new Promise((resolve) => setTimeout(resolve, POLL_DROP_RETRY_MS));
                    continue;
                }

                failures += 1;
                // Every failure logged at full volume turns one unreachable host into a log
                // line every few seconds forever. The first few are the useful ones; after
                // that it is the same fact repeated, so the wait grows and the line is only
                // written when something changes or the backoff has stretched.
                const wait = Math.min(POLL_RETRY_MS * 2 ** Math.min(failures - 1, 5), POLL_MAX_RETRY_MS);
                if (failures <= 3 || why !== lastFailure)
                {
                    options.log.warn('telegram poll failed', { error: why, attempt: failures, retryInMs: wait });
                }
                lastFailure = why;
                await new Promise((resolve) => setTimeout(resolve, wait));
            }
        }
    };

    return {
        say: (line) =>
        {
            if (stopped)
            {
                return;
            }
            pending.push(line);
        },

        reply: async (chatId, text, expectReply) =>
        {
            if (stopped)
            {
                return false;
            }
            try
            {
                await send(chatId, text, expectReply === true);
                return true;
            }
            catch (error)
            {
                options.log.warn('telegram reply failed', { error: reason(error), chat: chatId });
                return false;
            }
        },

        listen: (handler) =>
        {
            if (stopped || polling)
            {
                return;
            }
            polling = true;
            // Best effort and never awaited: the name is decoration for the console, and a
            // bot that cannot introspect itself should still answer commands.
            void call('getMe', JSON.stringify({}), { 'content-type': 'application/json' })
                .then((payload) =>
                {
                    botName = (payload as { result?: { username?: string } }).result?.username ?? '';
                })
                .catch(() => {});
            void poll(handler);
        },

        name: () => botName,

        sendDocument: async (file) =>
        {
            if (stopped)
            {
                return false;
            }
            const form = new FormData();
            form.append('chat_id', options.chatId);
            form.append('caption', file.caption.slice(0, 1024));
            // A fresh copy rather than the caller's view: a Blob over a buffer that is reused
            // for the next snapshot would upload whatever it holds by the time it is read.
            form.append('document', new Blob([new Uint8Array(file.bytes)]), file.name);
            try
            {
                await call('sendDocument', form);
                return true;
            }
            catch (error)
            {
                options.log.error('telegram document failed', { error: reason(error), name: file.name });
                return false;
            }
        },

        stop: () =>
        {
            stopped = true;
            polling = false;
            if (timer !== null)
            {
                clearInterval(timer);
                timer = null;
            }
            pending.length = 0;
        }
    };
}
