// The referral program's arithmetic and naming rules, with no database and no network in
// sight. Everything here is a pure function of rows the store handed over, which is what
// makes the money math testable: an earnings bug is not something to find in production.
//
// The rates and the two tiers are declared in wire.ts, next to the shapes they travel in.

import {
    REFERRAL_DIRECT_RATE,
    REFERRAL_INDIRECT_RATE,
    type ReferralStats,
    type ReferralTier,
    type ReferredUser
} from './wire.ts';

/** A code is what someone pastes into a chat window, so it stays short and unambiguous. */
const CODE_MAX = 16;

/** Appended when a slug is taken. Base 36, so a collision needs 1.7 million tries to matter. */
const SUFFIX_LEN = 4;

/** Campaign names are a label, not prose. */
export const NAME_MAX = 40;

/** Per owner. High enough that nobody real hits it, low enough that a script cannot flood. */
export const CAMPAIGN_LIMIT = 20;

/** How far the cycle guard walks up the referral chain before giving up. */
export const CHAIN_DEPTH = 16;

/** What one tier earns from a protocol fee. */
export function shareOf(fees: number, tier: ReferralTier): number {
    return fees * (tier === 'direct' ? REFERRAL_DIRECT_RATE : REFERRAL_INDIRECT_RATE);
}

/**
 * The URL-safe stem of a campaign code. Latin letters and digits only: a code lives in a
 * query string that gets pasted, shortened and re-encoded, and a Persian campaign name that
 * survived as percent-escapes would be unreadable everywhere it mattered.
 */
export function slugCode(name: string): string {
    const slug = name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, CODE_MAX)
        .replace(/-+$/g, '');
    return slug === '' ? 'ref' : slug;
}

/** A random tail for a slug that is already taken. */
export function suffix(random: () => number = Math.random): string {
    let out = '';
    for (let i = 0; i < SUFFIX_LEN; i += 1) {
        out += Math.floor(random() * 36).toString(36);
    }
    return out;
}

/**
 * Picks the code a new campaign gets: the bare slug when it is free, then the slug plus a
 * random tail. `taken` is the store's uniqueness check, passed in so this stays pure.
 */
export function pickCode(name: string, taken: (code: string) => boolean, random: () => number = Math.random): string {
    const slug = slugCode(name);
    if (!taken(slug)) {
        return slug;
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const candidate = `${slug.slice(0, CODE_MAX - SUFFIX_LEN - 1)}-${suffix(random)}`;
        if (!taken(candidate)) {
            return candidate;
        }
    }
    throw new Error('Could not allocate a referral code');
}

/** One referred account as the store knows it, before any trading is folded in. */
export interface JoinRow {
    account: string;
    code: string;
    at: number;
}

/** What that account traded inside the window. Absent from the map means: did not trade. */
export interface TradeRollup {
    trades: number;
    volume: number;
    fees: number;
    lastAt: number;
}

const EMPTY: TradeRollup = { trades: 0, volume: 0, fees: 0, lastAt: 0 };

function iso(seconds: number): string {
    return new Date(seconds * 1000).toISOString();
}

/**
 * Folds the two tiers and their trading into the dashboard's numbers.
 *
 * Sign-ups count everyone who joined INSIDE the window, whether or not they ever traded -
 * that is the number a referrer shares a link to move. The trading numbers are the window's
 * too, but over every referral regardless of when they joined: last month's sign-up trading
 * today still earns today. The roster itself is never filtered, so a quiet week reads as
 * zeros against real names rather than as an empty page.
 *
 * Earnings only ever count fees that actually reached the treasury, so an inactive referral
 * is worth exactly zero and says so.
 */
export function compose(
    direct: JoinRow[],
    indirect: JoinRow[],
    rollup: Map<string, TradeRollup>,
    since = 0
): { stats: ReferralStats; referred: ReferredUser[] } {
    const referred: ReferredUser[] = [];

    let directEarnings = 0;
    let indirectEarnings = 0;
    let activeTraders = 0;
    let volume = 0;
    let fees = 0;
    let signups = 0;
    let indirectSignups = 0;

    const fold = (rows: JoinRow[], tier: ReferralTier): void => {
        for (const row of rows) {
            const traded = rollup.get(row.account) ?? EMPTY;
            const earned = shareOf(traded.fees, tier);

            if (tier === 'direct') {
                directEarnings += earned;
                signups += row.at >= since ? 1 : 0;
            } else {
                indirectEarnings += earned;
                indirectSignups += row.at >= since ? 1 : 0;
            }
            if (traded.trades > 0) {
                activeTraders += 1;
            }
            volume += traded.volume;
            fees += traded.fees;

            referred.push({
                address: row.account,
                tier,
                joinedAt: iso(row.at),
                // An indirect referral did not arrive through a code of yours, so naming one
                // here would credit a campaign that never saw them.
                campaign: tier === 'direct' ? row.code : '',
                trades: traded.trades,
                volume: traded.volume,
                fees: traded.fees,
                earned,
                lastTradeAt: traded.lastAt === 0 ? null : iso(traded.lastAt)
            });
        }
    };

    fold(direct, 'direct');
    fold(indirect, 'indirect');

    // Biggest earners first, then the most recent joins - a referrer opens this to see what
    // is working, and an alphabetical list of addresses answers nothing.
    referred.sort((a, b) => (b.earned === a.earned ? b.joinedAt.localeCompare(a.joinedAt) : b.earned - a.earned));

    return {
        stats: {
            earnings: directEarnings + indirectEarnings,
            directEarnings,
            indirectEarnings,
            signups,
            indirectSignups,
            activeTraders,
            volume,
            fees
        },
        referred
    };
}
