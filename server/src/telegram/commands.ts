import type { Logger } from '../logger.ts';
import type { IndexStore } from '../chain/store.ts';

import type { Incoming, TelegramBot } from './bot.ts';

// What the bot does when somebody TALKS to it, as opposed to the feed it pushes out.
//
// The shape of the trust here is the whole point of the file. The bot is a public endpoint:
// anyone who finds its @name can message it, and nothing stops them. So there are exactly two
// tiers. Help and /myid are open, because neither reads nor writes anything - they are how a
// prospective proposer finds the id an admin needs in order to allow them. Everything else is
// gated on the allowlist, which the console owns.
//
// And even a permitted proposer has no authority: /newmarket writes a row to a queue. No
// market is created here and no key is touched. The console approves a proposal by seeding
// the create form with it, and an admin still signs the deploy from their own wallet - which
// is why a proposal can afford to be as loose as whatever they typed.

/** How long a half-finished /newmarket is remembered before it is dropped. Someone who walks
 *  away mid-answer should not find the bot still waiting on them an hour later. */
const DRAFT_TTL_MS = 30 * 60 * 1000;

/** The most pending proposals one account may have waiting at once. The queue is reviewed by
 *  hand, so one enthusiastic proposer must not be able to bury it. */
const PENDING_PER_USER = 10;

/** Field ceilings. Generous for a sentence, far below what would make the queue unreadable. */
const QUESTION_MAX = 300;
const DESCRIPTION_MAX = 1000;
const CATEGORY_MAX = 40;
const OUTCOME_MAX = 60;
const OUTCOMES_MAX = 12;

/** Which answer a half-finished proposal is waiting for. */
type Step = 'question' | 'outcomes' | 'closes' | 'category' | 'description';

interface Draft {
    step: Step;
    question: string;
    outcomes: string[];
    closesAt: string;
    category: string;
    description: string;
    touchedAt: number;
}

export interface CommandOptions {
    store: IndexStore;
    bot: TelegramBot;
    log: Logger;

    /** Told when a proposal lands, so the operator chat hears about it without polling. */
    onProposal?: (summary: string) => void;
}

/** Telegram renders a subset of HTML, and every string below is something a person typed. */
function escape(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const HELP = [
    '<b>Goman market bot</b>',
    '',
    'I post every trade on the exchange, back the database up on a timer, and take market',
    'suggestions for the team to review.',
    '',
    '<b>Commands</b>',
    '/help - this message',
    '/myid - your Telegram id, which an admin needs in order to allow you',
    '/newmarket - suggest a market, one question at a time',
    '/cancel - abandon a suggestion half-written',
    '/mine - the suggestions you have sent and where they stand',
    '',
    '<b>Suggesting a market</b>',
    'Send /newmarket and answer as I ask. I need a question that can only end up true or',
    'false, the answers people pick between, and when trading should stop. Category and',
    'rules are optional - send /skip to leave either out.',
    '',
    'A good question names what settles it and when:',
    '<i>Will BTC close above $120,000 on 31 Dec 2026, per Coinbase?</i>',
    '',
    'Nothing you send goes live by itself. Every suggestion is reviewed by an admin, who',
    'creates the market from their own wallet - so tell me what should exist, not what you',
    'want it to cost.'
].join('\n');

/**
 * The inbound half of the bot. Returns a handler, so the transport stays a transport and this
 * file is testable by calling the handler with a plain object.
 */
export function createCommands(options: CommandOptions): (message: Incoming) => Promise<void> {
    const { store, bot, log } = options;

    /** Half-written proposals, keyed by CHAT rather than by user: two people answering in the
     *  same group would otherwise complete each other's sentences. In memory on purpose - a
     *  restart mid-answer costs one retyped question, and persisting it would mean storing
     *  text from accounts that have not been allowed anything. */
    const drafts = new Map<string, Draft>();

    const sweep = (now: number): void => {
        for (const [key, draft] of drafts) {
            if (now - draft.touchedAt > DRAFT_TTL_MS) {
                drafts.delete(key);
            }
        }
    };

    const ask = async (chatId: string, text: string): Promise<void> => {
        await bot.reply(chatId, text);
    };

    /** The prompt for each step, so asking and re-asking cannot drift apart. */
    const promptFor = (step: Step): string => {
        switch (step) {
            case 'question':
                return [
                    '<b>What is the question?</b>',
                    'One sentence, and it has to have a definite answer by a definite date.',
                    '',
                    '<i>Will BTC close above $120,000 on 31 Dec 2026, per Coinbase?</i>',
                    '',
                    '/cancel to stop.'
                ].join('\n');
            case 'outcomes':
                return [
                    '<b>What are the answers?</b>',
                    'Send them separated by commas - <i>Yes, No</i> or <i>City, Draw, United</i>.',
                    '',
                    '/skip for a plain Yes/No.'
                ].join('\n');
            case 'closes':
                return [
                    '<b>When should trading close?</b>',
                    'A date, and a time if it matters: <i>2026-12-31</i> or <i>2026-12-31 18:00</i>.',
                    'Times are read as UTC.',
                    '',
                    '/skip if the admin should decide.'
                ].join('\n');
            case 'category':
                return [
                    '<b>Which category?</b>',
                    'One word - <i>crypto</i>, <i>sports</i>, <i>politics</i>.',
                    '',
                    '/skip to leave it.'
                ].join('\n');
            case 'description':
                return [
                    '<b>Anything else the admin should know?</b>',
                    'How it settles, which source decides it, edge cases.',
                    '',
                    '/skip to send it as it is.'
                ].join('\n');
        }
    };

    /**
     * A date as a proposer writes one. Deliberately narrow: `2026-12-31`, optionally with
     * `18:00`, read as UTC. `new Date(text)` accepts far more and disagrees with itself across
     * runtimes about half of it, and a market that locks on the wrong day is worse than one
     * the bot refused to take.
     */
    const parseWhen = (text: string): string | null => {
        const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(text.trim());
        if (match === null) {
            return null;
        }
        const [, year, month, day, hour, minute] = match;
        const at = Date.UTC(
            Number(year),
            Number(month) - 1,
            Number(day),
            hour === undefined ? 0 : Number(hour),
            minute === undefined ? 0 : Number(minute)
        );
        const iso = new Date(at);
        // Round-tripped rather than trusted: Date.UTC rolls 2026-02-31 forward into March
        // without complaint, and a proposer who typed a day that does not exist meant a
        // different day - not the one the arithmetic landed on.
        if (iso.getUTCMonth() !== Number(month) - 1 || iso.getUTCDate() !== Number(day)) {
            return null;
        }
        if (at <= Date.now()) {
            return null;
        }
        return iso.toISOString();
    };

    const finish = async (message: Incoming, draft: Draft): Promise<void> => {
        const id = store.addProposal({
            tgId: message.from,
            username: message.username,
            question: draft.question,
            description: draft.description,
            outcomesJson: JSON.stringify(draft.outcomes),
            closesAt: draft.closesAt,
            category: draft.category,
            createdAt: Date.now()
        });
        drafts.delete(message.chatId);

        const answers = draft.outcomes.length === 0 ? 'Yes / No' : draft.outcomes.join(' / ');
        const when =
            draft.closesAt === '' ? 'the admin to decide' : `${draft.closesAt.slice(0, 16).replace('T', ' ')} UTC`;
        await ask(
            message.chatId,
            [
                `<b>Sent for review</b> · #${id}`,
                '',
                escape(draft.question),
                `${escape(answers)} · closes ${escape(when)}`,
                '',
                'An admin will look at it. /mine shows where it stands.'
            ].join('\n')
        );

        log.info('proposal received', { id, from: message.from });
        const who = message.username === '' ? message.from : `@${message.username}`;
        options.onProposal?.(
            `💡 <b>New market suggestion</b> · #${id}\n${escape(draft.question)}\n<i>from ${escape(who)}</i>`
        );
    };

    /** One answer in a running /newmarket. */
    const advance = async (message: Incoming, draft: Draft): Promise<void> => {
        const text = message.text;
        const skipped = text.toLowerCase() === '/skip';
        draft.touchedAt = Date.now();

        switch (draft.step) {
            case 'question': {
                if (skipped || text.length < 10) {
                    await ask(message.chatId, 'That is too short to be a question. Try again, or /cancel.');
                    return;
                }
                draft.question = text.slice(0, QUESTION_MAX);
                draft.step = 'outcomes';
                break;
            }
            case 'outcomes': {
                if (!skipped) {
                    const parts = text
                        .split(',')
                        .map((part) => part.trim().slice(0, OUTCOME_MAX))
                        .filter((part) => part !== '');
                    if (parts.length < 2) {
                        await ask(
                            message.chatId,
                            'A market needs at least two answers. Send them comma separated, or /skip for Yes/No.'
                        );
                        return;
                    }
                    if (parts.length > OUTCOMES_MAX) {
                        await ask(message.chatId, `That is more than ${OUTCOMES_MAX} answers. Send fewer, or /skip.`);
                        return;
                    }
                    draft.outcomes = parts;
                }
                draft.step = 'closes';
                break;
            }
            case 'closes': {
                if (!skipped) {
                    const when = parseWhen(text);
                    if (when === null) {
                        await ask(
                            message.chatId,
                            'I could not read that as a future date. Try <i>2026-12-31</i> or <i>2026-12-31 18:00</i>, or /skip.'
                        );
                        return;
                    }
                    draft.closesAt = when;
                }
                draft.step = 'category';
                break;
            }
            case 'category': {
                if (!skipped) {
                    draft.category = text
                        .toLowerCase()
                        .replace(/[^a-z0-9-]/g, '')
                        .slice(0, CATEGORY_MAX);
                }
                draft.step = 'description';
                break;
            }
            case 'description': {
                if (!skipped) {
                    draft.description = text.slice(0, DESCRIPTION_MAX);
                }
                await finish(message, draft);
                return;
            }
        }

        await ask(message.chatId, promptFor(draft.step));
    };

    return async (message: Incoming): Promise<void> => {
        sweep(Date.now());

        const lower = message.text.toLowerCase();
        // `/help@thebot` is how Telegram addresses a command in a group; the suffix is not part
        // of the command, and a bot that does not strip it looks broken in every group.
        const command = lower.startsWith('/') ? lower.split(/[\s@]/)[0] : '';

        if (command === '/start' || command === '/help') {
            await ask(message.chatId, HELP);
            return;
        }

        if (command === '/myid') {
            await ask(
                message.chatId,
                [
                    '<b>Your Telegram id</b>',
                    `<code>${escape(message.from)}</code>`,
                    '',
                    'Send it to an admin and ask them to allow you. Until then /newmarket will not run.'
                ].join('\n')
            );
            return;
        }

        if (command === '/cancel') {
            const had = drafts.delete(message.chatId);
            await ask(message.chatId, had ? 'Dropped it.' : 'Nothing to cancel.');
            return;
        }

        // Everything past here is allowlisted. The refusal says how to ASK for access rather
        // than only saying no - the id is the thing an admin needs, and making someone hunt for
        // it is how a bot ends up with nobody using it.
        const allowed = store.isTelegramAdmin(message.from);

        if ((command === '/newmarket' || command === '/mine') && !allowed) {
            await ask(
                message.chatId,
                [
                    '<b>Not on the list</b>',
                    'Suggesting markets is limited to people an admin has allowed.',
                    '',
                    `Your id is <code>${escape(message.from)}</code> - send it to an admin to be added.`
                ].join('\n')
            );
            return;
        }

        if (command === '/mine') {
            const mine = store.proposalsFrom(message.from, 10);
            if (mine.length === 0) {
                await ask(message.chatId, 'You have not sent any yet. /newmarket starts one.');
                return;
            }
            const mark: Record<string, string> = { pending: '⏳', approved: '✅', rejected: '❌' };
            const lines = mine.map((row) => {
                const note = row.state === 'rejected' && row.note !== '' ? ` - ${escape(row.note)}` : '';
                return `${mark[row.state] ?? '·'} #${row.id} ${escape(row.question.slice(0, 70))}${note}`;
            });
            await ask(message.chatId, ['<b>Your suggestions</b>', ''].concat(lines).join('\n'));
            return;
        }

        if (command === '/newmarket') {
            const waiting = store.pendingFrom(message.from);
            if (waiting >= PENDING_PER_USER) {
                await ask(
                    message.chatId,
                    `You already have ${waiting} waiting to be reviewed. Wait for those before sending more.`
                );
                return;
            }
            drafts.set(message.chatId, {
                step: 'question',
                question: '',
                outcomes: [],
                closesAt: '',
                category: '',
                description: '',
                touchedAt: Date.now()
            });
            await ask(message.chatId, promptFor('question'));
            return;
        }

        const draft = drafts.get(message.chatId);
        if (draft !== undefined) {
            // An unknown slash command mid-answer is a typo, not an answer: storing `/halp` as
            // somebody's market question is the kind of thing nobody notices until review.
            if (command !== '' && command !== '/skip') {
                await ask(message.chatId, `I do not know ${escape(command)}. /cancel to stop, or answer the question.`);
                return;
            }
            // A seat revoked mid-conversation ends it. Checked here rather than only at the
            // start, because the answers are what actually reach the database.
            if (!allowed) {
                drafts.delete(message.chatId);
                return;
            }
            await advance(message, draft);
            return;
        }

        // Only answer an unprompted COMMAND. A bot that replies to every stray line is unusable
        // in a group, where most messages are not addressed to it.
        if (command !== '') {
            await ask(message.chatId, `I do not know ${escape(command)}. /help lists what I take.`);
        }
    };
}
