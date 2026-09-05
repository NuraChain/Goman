// THE number module. Every price, percentage, volume, and date in the UI renders through
// these functions - components never call Intl or toLocaleString themselves, which is the
// rule that keeps Persian and Latin digits from ever mixing in one view.
//
// The locale contract (decided with the product owner):
//   fa - Persian-Arabic digits with Persian scale words (هزار/میلیون/میلیارد) and the Jalali
//        calendar. It is the ONE language that changes the numerals themselves.
//   everything else - its own Intl locale for grouping, decimal marks, compact suffixes and
//        dates (so ru groups with spaces, hi groups in lakhs, zh says 万), but always LATIN
//        numerals. That is what `-u-nu-latn` on every tag buys: Arabic reads as Arabic while
//        its digits still line up with the Latin ones in the same table.
//   The token SYMBOL stays Latin everywhere (it is a ticker, not prose). Charts opt out of
//   Persian digits via the .latin-nums utility instead of calling different functions.
//
// Amounts are native-token numbers straight from the chain (via the indexer) - there is no
// display-rate fiction anywhere.

import { langRow, type Lang } from './langs.ts';

/** The native token's ticker, stamped on every money amount. */
const SYMBOL = import.meta.env.VITE_CURRENCY_SYMBOL ?? 'ETH';

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'] as const;

/**
 * The BCP-47 tag Intl gets for a language, numerals pinned to Latin. `fa` never reaches this
 * function - it renders through faDigits/faScale instead, which is the only way to get the
 * Persian separators (٬ ٫) that Intl's own fa-IR output does not pair with Latin fallbacks.
 */
function tag(lang: Lang): string {
    return `${langRow(lang).intl}-u-nu-latn`;
}

/** Latin -> Persian-Arabic digits, with the Persian separators (٬ thousands, ٫ decimal). */
export function faDigits(text: string): string {
    let out = '';
    for (const ch of text) {
        if (ch >= '0' && ch <= '9') {
            out += FA_DIGITS[ch.charCodeAt(0) - 48];
        } else if (ch === ',') {
            out += '٬';
        } else if (ch === '.') {
            out += '٫';
        } else {
            out += ch;
        }
    }
    return out;
}

/**
 * A native-token amount body. Amounts here are CRYPTO, not fiat, and the difference is not
 * cosmetic: two-decimal rounding is a currency convention that renders a real 0.0005 ETH bet
 * as `0` - the app telling a trader their stake is nothing. Sub-unit amounts are the normal
 * case on a chain whose unit is worth thousands, so they keep four significant digits, while
 * amounts above 1 keep up to four decimals with no fiat-style trailing-zero padding.
 */
function tokenBody(value: number, lang: Lang): string {
    if (!Number.isFinite(value) || value === 0) {
        return '0';
    }
    if (Math.abs(value) >= 1) {
        return new Intl.NumberFormat(tag(lang), { maximumFractionDigits: 4 }).format(value);
    }
    return new Intl.NumberFormat(tag(lang), { maximumSignificantDigits: 4 }).format(value);
}

/**
 * A money amount in the native token. en: `12,400 ETH` / compact `1.2M ETH` when asked.
 * fa: Persian digits with Persian scale words - `۱٫۲ میلیون ETH` - because a nine-digit
 * figure is noise where a magnitude is the message.
 */
export function formatMoney(amount: number, lang: Lang, options: { compact?: boolean } = {}): string {
    if (lang === 'fa') {
        return `${faScale(amount)} ${SYMBOL}`;
    }
    if (options.compact === true) {
        return `${compact(amount, lang)} ${SYMBOL}`;
    }
    return `${tokenBody(amount, lang)} ${SYMBOL}`;
}

/**
 * A whole count of things - sign-ups, trades, people. Not money, so no ticker and no
 * compaction: a referrer reading "3" wants three, not "3.0K" rounded from 2,951.
 */
export function formatCount(value: number, lang: Lang): string {
    const body = new Intl.NumberFormat(tag(lang), { maximumFractionDigits: 0 }).format(value);
    return lang === 'fa' ? faDigits(body) : body;
}

/** A traded-volume amount: always compact, always labeled by the caller. */
export function formatVolume(amount: number, lang: Lang): string {
    if (lang === 'fa') {
        return `${faScale(amount)} ${SYMBOL}`;
    }
    return `${compact(amount, lang)} ${SYMBOL}`;
}

/**
 * The shared compaction: en `1.2M`, ru `1,2 млн`, zh `124万`. Intl only takes over at a
 * thousand - below it the crypto precision rule wins, because compact notation would render
 * a real 0.25 ETH position as `0.3` and a 0.0005 one as `0`.
 */
function compact(value: number, lang: Lang): string {
    if (Math.abs(value) >= 1_000) {
        return new Intl.NumberFormat(tag(lang), { notation: 'compact', maximumFractionDigits: 1 }).format(value);
    }
    return tokenBody(value, lang);
}

/** fa compaction with Persian scale words and Persian digits. */
function faScale(value: number): string {
    if (value >= 1_000_000_000) {
        return `${faDigits(trim(value / 1_000_000_000))} میلیارد`;
    }
    if (value >= 1_000_000) {
        return `${faDigits(trim(value / 1_000_000))} میلیون`;
    }
    if (value >= 1_000) {
        return `${faDigits(trim(value / 1_000))} هزار`;
    }
    return faDigits(tokenBody(value, 'en'));
}

/** One decimal, trailing zero dropped: 1.0 -> "1", 1.24 -> "1.2". */
function trim(value: number): string {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** How a probability is spelled. The reader's choice, from the Odds format setting. */
export type OddsMode = 'price' | 'percent';

/**
 * A probability (0..1) as whole points, with the two lies a bare `Math.round` tells removed:
 *
 *   - a LIVE outcome never renders 0 or 100. `0¢` on a buy button reads as free, and `100%`
 *     on something still tradeable reads as settled. Only an exact 0 or 1 - a resolved
 *     market - is allowed to say so.
 *   - a non-finite share renders 0 rather than `NaN%`.
 *
 * This clamps the DISPLAY only; no value is ever altered.
 */
function oddsPoints(share: number): number {
    if (!Number.isFinite(share) || share <= 0) {
        return share >= 1 ? 100 : 0;
    }
    if (share >= 1) {
        return 100;
    }
    return Math.min(99, Math.max(1, Math.round(share * 100)));
}

/** Renders whole points in the reader's mode and digits. */
function odds(points: number, lang: Lang, mode: OddsMode): string {
    const body = lang === 'fa' ? faDigits(String(points)) : String(points);
    if (mode === 'percent') {
        // fa puts the sign first in LOGICAL order; RTL renders it trailing (`۳۴٪`).
        return lang === 'fa' ? `٪${body}` : `${body}%`;
    }
    return `${body}¢`;
}

/**
 * A fixed RATE as a percentage - a fee share, a commission. Not a probability, so it never
 * joins the odds set's round-to-100 apportionment, and it keeps a decimal when it has one.
 */
export function formatRate(share: number, lang: Lang): string {
    const points = Math.round(share * 1000) / 10;
    const body = lang === 'fa' ? faDigits(String(points)) : String(points);
    return lang === 'fa' ? `٪${body}` : `${body}%`;
}

/**
 * THE probability renderer. One function for every 0..1 value in the UI, so the same number
 * can never appear as `34¢` in one corner and `34%` in another - which it did, on the same
 * screen. The reader picks the frame once in Settings.
 */
export function formatOdds(share: number, lang: Lang, mode: OddsMode): string {
    return odds(oddsPoints(share), lang, mode);
}

/**
 * A whole outcome set, rounded so the displayed numbers SUM TO EXACTLY 100. Rounding each
 * outcome independently prints 33/33/33 (=99) or 34/34/33 (=101) for a three-way market, and
 * 35¢/66¢ (=101¢) for a binary pair - a market that visibly does not add up reads as broken.
 * Largest-remainder apportionment fixes that: floor everything, then hand the leftover points
 * to the largest fractional parts.
 *
 * @param shares - The outcome probabilities, in display order.
 * @returns One formatted string per outcome, in the same order.
 */
export function formatOddsSet(shares: readonly number[], lang: Lang, mode: OddsMode): string[] {
    const raw = shares.map((share) => (Number.isFinite(share) && share > 0 ? share : 0));
    const total = raw.reduce((sum, share) => sum + share, 0);
    if (total <= 0) {
        return raw.map(() => odds(0, lang, mode));
    }
    // Normalize first: on-chain prices sum to ~1 but not exactly, and the display must.
    const scaled = raw.map((share) => (share / total) * 100);
    const points = scaled.map((value) => Math.floor(value));
    let left = 100 - points.reduce((sum, value) => sum + value, 0);
    const byRemainder = scaled
        .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
        .sort((a, b) => b.remainder - a.remainder);
    for (const entry of byRemainder) {
        if (left <= 0) {
            break;
        }
        points[entry.index] = (points[entry.index] ?? 0) + 1;
        left--;
    }
    return points.map((value) => odds(value, lang, mode));
}

/**
 * A REALIZED fill price - collateral per share, fee included - which is not a probability and
 * is legitimately allowed above 1 (the taker pays the fee on top of a near-certain outcome).
 * Always in cents, never clamped: clamping it would misreport what someone actually paid.
 */
export function formatFillPrice(price: number, lang: Lang): string {
    const cents = Number.isFinite(price) ? Math.round(price * 100) : 0;
    return lang === 'fa' ? `${faDigits(String(cents))}¢` : `${cents}¢`;
}

/**
 * A share count. Exists because six call sites reached for `.toFixed(1)` directly, which
 * leaks Latin digits into the Persian UI - the one thing this module exists to prevent.
 */
export function formatShares(shares: number, lang: Lang): string {
    const value = Number.isFinite(shares) ? shares : 0;
    if (lang === 'fa') {
        return faDigits(value.toFixed(1));
    }
    return oneDecimal(value, lang);
}

/** Exactly one fraction digit, in the language's own decimal mark (fr `39,7`). */
function oneDecimal(value: number, lang: Lang): string {
    return new Intl.NumberFormat(tag(lang), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}

/**
 * A signed profit/loss amount. EVERY signed money value goes through this - rendering one
 * through `formatMoney` instead gives a loss an ASCII hyphen and a gain no sign at all, which
 * is how the leaderboard and the portfolio ended up disagreeing about what a profit looks like.
 */
export function formatSigned(amount: number, lang: Lang, options: { compact?: boolean } = {}): string {
    const sign = amount > 0 ? '+' : amount < 0 ? '−' : '';
    const body = formatMoney(Math.abs(amount), lang, { compact: options.compact ?? true });
    return `${sign}${body}`;
}

/**
 * A change in probability, in PERCENTAGE POINTS - the unit a prediction market moves in.
 * Rendering the raw 0..1 delta printed `+0.0` for anything under five points.
 */
export function formatPoints(delta: number, lang: Lang): string {
    const points = Number.isFinite(delta) ? Math.round(delta * 1000) / 10 : 0;
    const sign = points > 0 ? '+' : points < 0 ? '−' : '';
    const magnitude = Math.abs(points);
    const body = lang === 'fa' ? faDigits(magnitude.toFixed(1)) : oneDecimal(magnitude, lang);
    return `${sign}${body}`;
}

/** Relative time for feeds: en `2h ago`, fa `۲ ساعت پیش`, everything else via Intl (`hace 2 h`,
 *  `2 ч назад`, `2小时前`). Coarse on purpose - a trade feed needs magnitude, not seconds.
 *  `now` is injectable so tests never race the clock. */
export function formatTimeAgo(iso: string, lang: Lang, now: number = Date.now()): string {
    const minutes = Math.max(1, Math.round((now - Date.parse(iso)) / 60_000));
    if (minutes < 60) {
        return ago(minutes, 'minute', lang, `${minutes}m ago`, `${faDigits(String(minutes))} دقیقه پیش`);
    }
    const hours = Math.round(minutes / 60);
    if (hours < 24) {
        return ago(hours, 'hour', lang, `${hours}h ago`, `${faDigits(String(hours))} ساعت پیش`);
    }
    const days = Math.round(hours / 24);
    return ago(days, 'day', lang, `${days}d ago`, `${faDigits(String(days))} روز پیش`);
}

/** en and fa keep their hand-written short forms - Intl's English is `2 hr. ago`, which is
 *  wider than the feed column was built for. The other eight get Intl, which is correct in
 *  languages whose plural rules a template string cannot fake.
 *
 *  `short`, NOT `narrow`: ICU has no narrow past-tense pattern for ru or fr and falls back to
 *  a bare sign, so `2 hours ago` renders as `-2 ч` / `-2 h` - which reads as MINUS two hours
 *  in a feed full of signed numbers. `short` is identical in the other six. */
function ago(value: number, unit: Intl.RelativeTimeFormatUnit, lang: Lang, english: string, persian: string): string {
    if (lang === 'en') {
        return english;
    }
    if (lang === 'fa') {
        return persian;
    }
    return new Intl.RelativeTimeFormat(tag(lang), { numeric: 'always', style: 'short' }).format(-value, unit);
}

/** A resolution date: en `Dec 31, 2026`; fa the Persian (Jalali) calendar via Intl. */
export function formatDate(iso: string, lang: Lang): string {
    const date = new Date(iso);
    if (lang === 'fa') {
        return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' }).format(date);
    }
    return new Intl.DateTimeFormat(tag(lang), { dateStyle: 'medium' }).format(date);
}

/** A resolve deadline WITH its clock time - deadlines are hours-precise on a prediction
 *  market. en `Dec 31, 2026, 4:00 PM`; fa the Jalali date with the ۲۴h clock. */
export function formatDateTime(iso: string, lang: Lang): string {
    const date = new Date(iso);
    if (lang === 'fa') {
        return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
    }
    return new Intl.DateTimeFormat(tag(lang), { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** The card timer chip: the numeric deadline WITH its clock - resolution is hours-precise,
 *  so the card must not hide the time. en `12/31/2026 4:00 PM`; fa the numeric Jalali date
 *  with the ۲۴h clock (`۱۴۰۵/۱۰/۱۰ ۲۰:۰۰`). */
export function formatDateTimeShort(iso: string, lang: Lang): string {
    const date = new Date(iso);
    if (lang === 'fa') {
        const day = new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(
            date
        );
        const clock = new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' }).format(date);
        return `${day} ${clock}`;
    }
    const day = new Intl.DateTimeFormat(tag(lang), { year: 'numeric', month: 'numeric', day: 'numeric' }).format(date);
    const clock = new Intl.DateTimeFormat(tag(lang), { hour: 'numeric', minute: '2-digit' }).format(date);
    return `${day} ${clock}`;
}
