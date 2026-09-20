import { parseLocalized } from '../derive.ts';
import { marketPath } from '../wire.ts';
import type { IndexedEvent } from '../chain/indexer.ts';
import type { IndexStore } from '../chain/store.ts';

// What a chain event reads like in a chat window.
//
// The rule the whole file follows: every value here came off a public chain and half of it was
// typed by a market's author, so nothing is interpolated into HTML without being escaped
// first. A market titled `<b>` would otherwise either break the message or style the rest of
// it - and Telegram rejects the whole batch when the markup does not parse, which would take
// the unrelated events sharing that batch down with it.

/** Longest a market title is allowed to be in a line before it is cut. */
const TITLE_MAX = 60;

export interface FormatOptions {
    store: IndexStore;

    /** Native currency ticker, purely cosmetic. */
    symbol: string;

    /** Public site root, or '' for none - when set, a market's name becomes a link. */
    siteUrl: string;
}

/**
 * One line for one event, or null for an event that is not news on its own.
 *
 * The share transfers that ride along with every buy, sell and claim are the null case: they
 * are the same act seen a second time from the token's side, and reporting both would double
 * every message in the feed. A transfer between two ACCOUNTS has no other event behind it, so
 * that one is reported.
 */
export function lineFor(event: IndexedEvent, options: FormatOptions): string | null {
    const market = event.marketId === null ? null : options.store.marketById(event.marketId);
    const name = market === null ? `#${event.marketId ?? '?'}` : titleOf(market.title_json, market.emoji);
    const link =
        market === null || options.siteUrl === ''
            ? name
            : `<a href="${escape(
                  `${options.siteUrl.replace(/\/$/, '')}${marketPath({
                      id: String(market.id),
                      title: parseLocalized(market.title_json),
                      rules: parseLocalized(market.rules_json)
                  })}`
              )}">${name}</a>`;

    const args = event.args;
    const amount = (key: string): string => `${ether(args[key])} ${escape(options.symbol)}`;
    const outcome = (key: string): string => outcomeName(options.store, event.marketId, args[key]);

    switch (event.event) {
        case 'MarketCreated':
            return `🆕 <b>New market</b> ${link}`;
        case 'PredictionPlaced':
            return `📈 <b>Buy</b> ${amount('amountIn')} on ${outcome('outcome')} — ${link} · ${who(args.buyer)}`;
        case 'PredictionSold':
            return `📉 <b>Sell</b> ${amount('amountOut')} of ${outcome('outcome')} — ${link} · ${who(args.seller)}`;
        case 'BetPlaced':
            return `🎯 <b>Bet</b> ${amount('amount')} on ${outcome('outcome')} — ${link} · ${who(args.better)}`;
        case 'LiquidityAdded':
            return `💧 <b>Liquidity added</b> ${amount('amount')} — ${link} · ${who(args.funder)}`;
        case 'LiquidityRemoved':
            return `🪣 <b>Liquidity removed</b> — ${link} · ${who(args.provider)}`;
        case 'MarketPaused':
            return `⏸️ <b>Paused</b> ${link}`;
        case 'MarketUnpaused':
            return `▶️ <b>Resumed</b> ${link}`;
        case 'MarketClosed':
            return `🔒 <b>Trading closed</b> ${link}`;
        case 'MarketResolved':
            return `🏁 <b>Resolved</b> ${outcome('winningOutcome')} — ${link}`;
        case 'MarketVoided':
            return `⛔ <b>Voided</b> ${link}`;
        case 'RewardClaimed':
            return `💰 <b>Claim</b> ${amount('amount')} — ${link} · ${who(args.claimant)}`;
        case 'FeeCollected':
            return `🏦 <b>Fee</b> ${amount('amount')} — ${link}`;
        case 'TransferSingle':
        case 'TransferBatch':
            return peerTransfer(args) ? `🔁 <b>Shares moved</b> ${link} · ${who(args.from)} → ${who(args.to)}` : null;
        default:
            return null;
    }
}

/** True when both ends of a transfer are real accounts - not the mint/burn behind a trade. */
function peerTransfer(args: Record<string, unknown>): boolean {
    const zero = '0x0000000000000000000000000000000000000000';
    const from = String(args.from ?? zero).toLowerCase();
    const to = String(args.to ?? zero).toLowerCase();
    return from !== zero && to !== zero;
}

/** `🏛️ Will the bill pass?`, escaped and cut to a length a chat line can carry. */
function titleOf(titleJson: string, emoji: string): string {
    const text = parseLocalized(titleJson).en;
    const cut = text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 1)}…` : text;
    return `${emoji === '' ? '' : `${emoji} `}<b>${escape(cut)}</b>`;
}

function outcomeName(store: IndexStore, marketId: number | null, raw: unknown): string {
    const idx = Number(raw ?? -1);
    if (marketId === null || !Number.isFinite(idx)) {
        return '?';
    }
    const row = store.outcomesOf(marketId)[idx];
    return row === undefined ? `#${idx}` : `“${escape(parseLocalized(row.label_json).en)}”`;
}

/** `0x4ac0…3712` - enough of an address to recognise, short enough to read in a line. */
function who(raw: unknown): string {
    const address = String(raw ?? '');
    return /^0x[0-9a-fA-F]{40}$/.test(address)
        ? `<code>${address.slice(0, 6)}…${address.slice(-4)}</code>`
        : '<code>?</code>';
}

/** Wei to a readable amount. Chain values arrive as bigint, so this never sees a float. */
function ether(raw: unknown): string {
    const value = typeof raw === 'bigint' ? Number(raw) / 1e18 : Number(raw ?? 0);
    if (!Number.isFinite(value)) {
        return '0';
    }
    return value >= 1000 ? value.toFixed(0) : value.toFixed(4).replace(/\.?0+$/, '');
}

/** The three characters Telegram's HTML mode parses. Everything user-typed goes through it. */
function escape(text: string): string {
    return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
