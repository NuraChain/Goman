import type { Logger } from '@azerothjs/logger';

import type { Incoming, TelegramBot } from './bot.ts';

// What the bot does when somebody TALKS to it, as opposed to the feed it pushes out.
//
// The bot is a public endpoint: anyone who finds its @name can message it, and nothing stops
// them. So it answers exactly one thing, and that thing reads nothing and writes nothing.
//
// It used to take market suggestions here - `/newmarket` walked a proposer through a draft,
// wrote it to a queue, and the console approved one by seeding the create form with it. That
// whole path is gone: a market is prepared in the create form itself now, by a wallet the
// console invited, and handed back as a link for an admin to sign. A chat window was a poor
// place to compose ten translated fields, and the queue was a second inbox to watch.

export interface CommandOptions {
    bot: TelegramBot;
    log: Logger;
}

const HELP = [
    '<b>Goman market bot</b>',
    '',
    'I post every trade and claim on the exchange, and back the database up on a timer.',
    '',
    '<b>Commands</b>',
    '/help - this message',
    '',
    'I do not take market suggestions here. Ask an admin for a create link: it opens the',
    'market form itself, which is a better place to write ten fields than a chat window.'
].join('\n');

/**
 * The inbound half of the bot. Returns a handler, so the transport stays a transport and this
 * file is testable by calling the handler with a plain object.
 */
export function createCommands(options: CommandOptions): (message: Incoming) => Promise<void>
{
    const { bot } = options;

    return async (message: Incoming): Promise<void> =>
    {
        const lower = message.text.toLowerCase();
        // `/help@thebot` is how Telegram addresses a command in a group; the suffix is not part
        // of the command, and a bot that does not strip it looks broken in every group.
        const command = lower.startsWith('/') ? lower.split(/[\s@]/)[0] : '';

        // Only answer a COMMAND. A bot that replies to every stray line is unusable in a group,
        // where most messages are not addressed to it.
        if (command === '')
        {
            return;
        }

        await bot.reply(message.chatId, HELP);
    };
}
