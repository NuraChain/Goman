// The bot's inbound half, and the two error predicates the long poll leans on.
//
// The bot used to take market suggestions here - /newmarket walked a proposer through a draft
// and queued it for the console. That is gone: a market is prepared in the create form by a
// wallet the console invited. So the whole inbound surface is /help, and what is worth testing
// is that it stays quiet otherwise - a bot that answers every line is unusable in a group.
import { describe, it, expect, beforeEach } from 'vitest';

import type { Incoming, TelegramBot } from '../src/telegram/bot.ts';
import { createLogger } from '@azerothjs/logger';
import { isDropped, reason } from '../src/telegram/bot.ts';
import { createCommands } from '../src/telegram/commands.ts';

const log = createLogger({ level: 'silent' });

const SOMEBODY = '9999';

/** A bot that records replies instead of sending them. */
function recorder(): TelegramBot & { replies: string[]; prompts: boolean[]; feed: string[] }
{
    const state = {
        replies: [] as string[],
        prompts: [] as boolean[],
        feed: [] as string[],
        say: (line: string) =>
        {
            state.feed.push(line);
        },
        reply: async (_chatId: string, text: string, expectReply?: boolean) =>
        {
            state.replies.push(text);
            state.prompts.push(expectReply === true);
            return true;
        },
        sendDocument: async () => true,
        listen: () => undefined,
        name: () => 'goman_test_bot',
        stop: () => undefined
    };
    return state;
}

/** A private message, which is how the bot is normally used. */
function incoming(text: string, from = SOMEBODY): Incoming
{
    return { chatId: `chat-${ from }`, private: true, from, username: 'someone', text };
}

let bot: ReturnType<typeof recorder>;
let handle: (message: Incoming) => Promise<void>;

beforeEach(() =>
{
    bot = recorder();
    handle = createCommands({ bot, log });
});

describe('commands', () =>
{
    it('answers /help to anyone', async () =>
    {
        await handle(incoming('/help'));
        expect(bot.replies[0]).toContain('Goman market bot');
    });

    it('strips the @botname Telegram appends in a group', async () =>
    {
        await handle(incoming('/help@goman_test_bot'));
        expect(bot.replies[0]).toContain('Goman market bot');
    });

    it('no longer offers a way to suggest a market here', async () =>
    {
        await handle(incoming('/help'));
        expect(bot.replies[0]).not.toContain('/newmarket');
        // Said out loud rather than left as a silence, because the command was public for a
        // while and whoever used it will come back looking for it.
        expect(bot.replies[0]).toContain('create link');
    });

    it('stays quiet on ordinary chatter, which is most of a group', async () =>
    {
        await handle(incoming('good morning everyone'));
        expect(bot.replies).toEqual([]);
    });

    it('answers a command it does not know with the help it does', async () =>
    {
        await handle(incoming('/newmarket'));
        expect(bot.replies[0]).toContain('Goman market bot');
    });
});

describe('reason', () =>
{
    // `String(err)` on a failed fetch is "TypeError: fetch failed" and nothing more. The fault
    // undici actually hit is on `cause`, and without it an operator cannot tell a blocked host
    // from a dead resolver from an expired certificate.
    it('unwraps the cause chain a failed fetch hides', () =>
    {
        const dns = Object.assign(new Error('getaddrinfo ENOTFOUND api.telegram.org'), { code: 'ENOTFOUND' });
        const wrapped = new TypeError('fetch failed', { cause: dns });

        expect(String(wrapped)).toBe('TypeError: fetch failed');
        expect(reason(wrapped)).toBe('fetch failed <- ENOTFOUND: getaddrinfo ENOTFOUND api.telegram.org');
    });

    it('keeps a plain error readable, and does not repeat a cause that restates its parent', () =>
    {
        expect(reason(new Error('rate limited for 3s'))).toBe('rate limited for 3s');
        const same = new Error('boom', { cause: new Error('boom') });
        expect(reason(same)).toBe('boom');
    });

    it('survives something that is not an Error at all', () =>
    {
        expect(reason('just a string')).toContain('just a string');
        expect(reason(null)).toBe('null');
    });
});

describe('isDropped', () =>
{
    // A long poll holds an idle connection open on purpose, and idle connections are what NAT
    // tables and middleboxes reap. Reconnecting at once is correct; backing off would let a
    // network that merely resets sockets make the bot answer minutes late.
    it('calls a reset long poll a dropped connection, not a fault', () =>
    {
        const reset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
        expect(isDropped(new TypeError('fetch failed', { cause: reset }))).toBe(true);
    });

    it('recognises undici socket and timeout shapes', () =>
    {
        for (const code of ['ETIMEDOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'EPIPE'])
        {
            expect(isDropped(Object.assign(new Error('x'), { code }))).toBe(true);
        }
        expect(isDropped(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))).toBe(true);
    });

    it('does NOT excuse a fault that would repeat however fast it is retried', () =>
    {
        const dns = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
        expect(isDropped(new TypeError('fetch failed', { cause: dns }))).toBe(false);
        expect(isDropped(new Error('Unauthorized'))).toBe(false);
        expect(isDropped(null)).toBe(false);
    });
});
