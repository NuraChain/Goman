// The bot's inbound half: who it obeys, and what a /newmarket conversation collects.
//
// Nothing here touches Telegram. What is worth testing is what would be quietly wrong in
// production: a stranger getting a proposal into the queue, a conversation that stores a
// mistyped command as somebody's market question, and a date the bot accepted but the chain
// would reject - a market that locks on the wrong day is worse than one the bot refused.
import { describe, it, expect, beforeEach } from 'vitest';

import { IndexStore } from '../src/chain/store.ts';
import type { Incoming, TelegramBot } from '../src/telegram/bot.ts';
import { createCommands } from '../src/telegram/commands.ts';

const log = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };

const ALLOWED = '4242';
const STRANGER = '9999';

/** A bot that records replies instead of sending them. */
function recorder(): TelegramBot & { replies: string[]; prompts: boolean[]; feed: string[] } {
    const state = {
        replies: [] as string[],
        // Whether each reply asked for a reply back. In a group that is the difference between
        // a question the bot can hear the answer to and one it cannot.
        prompts: [] as boolean[],
        feed: [] as string[],
        say: (line: string) => {
            state.feed.push(line);
        },
        reply: async (_chatId: string, text: string, expectReply?: boolean) => {
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
function incoming(text: string, from = ALLOWED): Incoming {
    return { chatId: `chat-${from}`, private: true, from, username: 'someone', text };
}

/** The same, sent in a group - where Telegram's privacy mode changes what the bot can see. */
function inGroup(text: string, from = ALLOWED): Incoming {
    return { chatId: 'group-1', private: false, from, username: 'someone', text };
}

let store: IndexStore;
let bot: ReturnType<typeof recorder>;
let handle: (message: Incoming) => Promise<void>;

beforeEach(() => {
    store = new IndexStore(':memory:');
    store.putTelegramAdmin(ALLOWED, 'someone', '0xadmin', Date.now());
    bot = recorder();
    handle = createCommands({ store, bot, log });
});

/** Walks a full /newmarket, answering each prompt in order. */
async function propose(answers: string[], from = ALLOWED): Promise<void> {
    await handle(incoming('/newmarket', from));
    for (const answer of answers) {
        await handle(incoming(answer, from));
    }
}

const QUESTION = 'Will BTC close above $120,000 on 31 Dec 2026?';

describe('open commands', () => {
    it('answers /help to anyone, allowlisted or not', async () => {
        await handle(incoming('/help', STRANGER));
        expect(bot.replies[0]).toContain('Goman market bot');
        expect(bot.replies[0]).toContain('/newmarket');
    });

    it('strips the @botname Telegram appends in a group', async () => {
        await handle(incoming('/help@goman_test_bot', STRANGER));
        expect(bot.replies[0]).toContain('Goman market bot');
    });

    it('tells an unlisted caller the id an admin needs, rather than only refusing', async () => {
        await handle(incoming('/myid', STRANGER));
        expect(bot.replies[0]).toContain(STRANGER);
    });

    it('stays quiet on ordinary chatter, which is most of a group', async () => {
        await handle(incoming('good morning everyone', STRANGER));
        expect(bot.replies).toEqual([]);
    });
});

describe('the allowlist gate', () => {
    it('refuses /newmarket from an id nobody allowed, and writes nothing', async () => {
        await handle(incoming('/newmarket', STRANGER));
        expect(bot.replies[0]).toContain('Not on the list');
        // The refusal still hands over the id, so the next step is obvious.
        expect(bot.replies[0]).toContain(STRANGER);
        expect(store.countProposals('')).toBe(0);
    });

    it('takes /newmarket from an allowed id', async () => {
        await handle(incoming('/newmarket'));
        expect(bot.replies[0]).toContain('What is the question?');
    });

    it('abandons a conversation whose seat is revoked mid-answer', async () => {
        await handle(incoming('/newmarket'));
        store.removeTelegramAdmin(ALLOWED);

        await handle(incoming(QUESTION));
        expect(store.countProposals('')).toBe(0);
    });
});

describe('/newmarket', () => {
    it('collects every answer and queues one pending proposal', async () => {
        await propose([QUESTION, 'Yes, No', '2026-12-31 18:00', 'crypto', 'Settles on the Coinbase close.']);

        expect(store.countProposals('pending')).toBe(1);
        const [row] = store.listProposals('pending', 10, 0);
        expect(row.question).toBe(QUESTION);
        expect(JSON.parse(row.outcomes_json)).toEqual(['Yes', 'No']);
        expect(row.closes_at).toBe('2026-12-31T18:00:00.000Z');
        expect(row.category).toBe('crypto');
        expect(row.description).toBe('Settles on the Coinbase close.');
        expect(row.tg_id).toBe(ALLOWED);
        expect(bot.replies.at(-1)).toContain('Sent for review');
    });

    it('lets every optional answer be skipped', async () => {
        await propose([QUESTION, '/skip', '/skip', '/skip', '/skip']);

        const [row] = store.listProposals('pending', 10, 0);
        expect(JSON.parse(row.outcomes_json)).toEqual([]);
        expect(row.closes_at).toBe('');
        expect(row.category).toBe('');
        expect(row.description).toBe('');
    });

    it('tells the operator feed about a proposal as it arrives', async () => {
        const announced: string[] = [];
        handle = createCommands({ store, bot, log, onProposal: (line) => announced.push(line) });
        await propose([QUESTION, '/skip', '/skip', '/skip', '/skip']);

        expect(announced).toHaveLength(1);
        expect(announced[0]).toContain('New market suggestion');
    });

    it('re-asks rather than storing an answer it cannot use', async () => {
        await handle(incoming('/newmarket'));
        await handle(incoming('no'));
        expect(bot.replies.at(-1)).toContain('too short');

        await handle(incoming(QUESTION));
        await handle(incoming('Yes'));
        expect(bot.replies.at(-1)).toContain('at least two answers');

        await handle(incoming('Yes, No'));
        await handle(incoming('sometime next year'));
        expect(bot.replies.at(-1)).toContain('could not read that as a future date');

        expect(store.countProposals('')).toBe(0);
    });

    it('refuses a date that has already passed', async () => {
        await handle(incoming('/newmarket'));
        await handle(incoming(QUESTION));
        await handle(incoming('/skip'));
        await handle(incoming('2020-01-01'));
        expect(bot.replies.at(-1)).toContain('future date');
    });

    it('refuses a day that does not exist, which Date.UTC would roll forward in silence', async () => {
        await handle(incoming('/newmarket'));
        await handle(incoming(QUESTION));
        await handle(incoming('/skip'));
        await handle(incoming('2026-02-31'));
        expect(bot.replies.at(-1)).toContain('future date');
    });

    it('treats a mistyped command mid-answer as a typo, not as the answer', async () => {
        await handle(incoming('/newmarket'));
        await handle(incoming('/halp'));

        expect(bot.replies.at(-1)).toContain('I do not know');
        // Still waiting on the question, and nothing stored under it.
        await handle(incoming(QUESTION));
        await handle(incoming('/skip'));
        await handle(incoming('/skip'));
        await handle(incoming('/skip'));
        await handle(incoming('/skip'));
        const [row] = store.listProposals('pending', 10, 0);
        expect(row.question).toBe(QUESTION);
    });

    it('/cancel drops a half-written one', async () => {
        await handle(incoming('/newmarket'));
        await handle(incoming(QUESTION));
        await handle(incoming('/cancel'));
        expect(bot.replies.at(-1)).toBe('Dropped it.');

        // The next line is chatter again, not the answer to a question nobody is asking.
        await handle(incoming('Yes, No'));
        expect(store.countProposals('')).toBe(0);
    });

    it('keeps two chats answering at once from completing each other', async () => {
        store.putTelegramAdmin('777', 'other', '0xadmin', Date.now());

        await handle(incoming('/newmarket', ALLOWED));
        await handle(incoming('/newmarket', '777'));
        await handle(incoming(QUESTION, ALLOWED));
        await handle(incoming('Will it rain in Tehran tomorrow?', '777'));

        await handle(incoming('/skip', ALLOWED));
        await handle(incoming('/skip', ALLOWED));
        await handle(incoming('/skip', ALLOWED));
        await handle(incoming('/skip', ALLOWED));

        const rows = store.listProposals('pending', 10, 0);
        expect(rows).toHaveLength(1);
        expect(rows[0].question).toBe(QUESTION);
    });

    it('caps how many one proposer may leave pending', async () => {
        for (let n = 0; n < 10; n += 1) {
            await propose([`${QUESTION} (${n})`, '/skip', '/skip', '/skip', '/skip']);
        }
        expect(store.countProposals('pending')).toBe(10);

        bot.replies.length = 0;
        await handle(incoming('/newmarket'));
        expect(bot.replies[0]).toContain('waiting to be reviewed');
        expect(store.countProposals('pending')).toBe(10);
    });
});

describe('group chats, where privacy mode limits what the bot sees', () => {
    // With privacy mode on - the BotFather default, and what this bot runs with - a bot in a
    // group is shown slash commands and replies to its own messages, and nothing else. A
    // question asked without force_reply is therefore a question whose answer never arrives.
    it('asks every question as a forced reply, so the answer reaches the bot at all', async () => {
        await handle(inGroup('/newmarket'));
        expect(bot.prompts.at(-1)).toBe(true);

        await handle(inGroup(QUESTION));
        expect(bot.prompts.at(-1)).toBe(true);
    });

    it('says so up front, rather than looking mute after the first answer', async () => {
        await handle(inGroup('/newmarket'));
        expect(bot.replies[0]).toContain('reply');
        expect(bot.replies[0]).toContain('private chat');
    });

    it('still completes a proposal when the answers do come back', async () => {
        await handle(inGroup('/newmarket'));
        for (const answer of [QUESTION, '/skip', '/skip', '/skip', '/skip']) {
            await handle(inGroup(answer));
        }
        expect(store.countProposals('pending')).toBe(1);
    });

    it('leaves a plain statement in a private chat unforced - there is nothing to work around', async () => {
        await handle(incoming('/help'));
        expect(bot.prompts.at(-1)).toBe(false);
    });
});

describe('the operator', () => {
    // Whoever TELEGRAM_CHAT_ID points at holds the bot token. Requiring them to grant
    // themselves a seat before the bot would answer was a lock with the key next to it, and
    // made a fresh install - where the allowlist is empty - look broken.
    it('is trusted without a seat on the allowlist', async () => {
        const fresh = new IndexStore(':memory:');
        const owner = recorder();
        const answer = createCommands({ store: fresh, bot: owner, log, operatorChat: 'chat-1' });

        await answer({ chatId: 'chat-1', private: true, from: '1', username: '', text: '/newmarket' });
        expect(owner.replies[0]).toContain('What is the question?');
    });

    it('does not extend that trust to anybody else', async () => {
        const fresh = new IndexStore(':memory:');
        const other = recorder();
        const answer = createCommands({ store: fresh, bot: other, log, operatorChat: 'chat-1' });

        await answer({ chatId: 'chat-2', private: true, from: '2', username: '', text: '/newmarket' });
        expect(other.replies[0]).toContain('Not on the list');
    });
});

describe('/mine', () => {
    it('reports each suggestion and the verdict on it', async () => {
        await propose([QUESTION, '/skip', '/skip', '/skip', '/skip']);
        const [row] = store.listProposals('pending', 10, 0);
        store.decideProposal(row.id, 'rejected', '0xadmin', 'Too vague', Date.now());

        bot.replies.length = 0;
        await handle(incoming('/mine'));
        expect(bot.replies[0]).toContain(`#${row.id}`);
        expect(bot.replies[0]).toContain('Too vague');
    });

    it('shows one proposer only their own', async () => {
        store.putTelegramAdmin('777', 'other', '0xadmin', Date.now());
        await propose([QUESTION, '/skip', '/skip', '/skip', '/skip'], '777');

        bot.replies.length = 0;
        await handle(incoming('/mine', ALLOWED));
        expect(bot.replies[0]).toContain('not sent any');
    });
});

describe('a decision', () => {
    it('is final - the first one wins', async () => {
        await propose([QUESTION, '/skip', '/skip', '/skip', '/skip']);
        const [row] = store.listProposals('pending', 10, 0);

        expect(store.decideProposal(row.id, 'approved', '0xone', '', Date.now())).toBe(true);
        expect(store.decideProposal(row.id, 'rejected', '0xtwo', '', Date.now())).toBe(false);
        expect(store.proposalById(row.id)?.state).toBe('approved');
    });
});
