// Market discovery: what is live on Polymarket, and which of it this registry does not have.
//
// It runs HERE, not in the browser: gamma-api sends no CORS headers, and a crawl fanned out
// across every admin's tab is a crawl that gets the deployment rate-limited. One process
// fetches, one cache serves everyone.
//
// Read-only reconnaissance. Nothing is written, nothing is copied into a market - the console
// lists what exists elsewhere so an admin can decide what to create here, in their own words.

import type { DiscoveredMarket, DiscoveredOutcome } from './wire.ts';

/** Gamma's public market feed. No key, no auth - the same JSON the site's own client reads. */
const ENDPOINT = 'https://gamma-api.polymarket.com/markets';

/** Per request, and the crawl walks pages until CAP or until a short page ends it. */
const PAGE_SIZE = 100;
const CAP = 500;

/** A crawl is reused for this long. The feed moves in minutes, not seconds. */
const TTL_MS = 5 * 60 * 1000;

const TIMEOUT_MS = 15_000;

/**
 * Words that carry no signal when deciding whether two market questions are the same one.
 * Every prediction market opens with "Will ... by ...", so leaving these in scores unrelated
 * questions as half-matched.
 */
const STOPWORDS = new Set([
    'will',
    'the',
    'a',
    'an',
    'be',
    'is',
    'are',
    'to',
    'of',
    'in',
    'on',
    'at',
    'by',
    'for',
    'and',
    'or',
    'this',
    'that',
    'it',
    'as',
    'before',
    'after',
    'than',
    'market',
    'markets'
]);

/** The score above which two questions are treated as the same market. */
const MATCH_THRESHOLD = 0.6;

/** Below this many shared words, a high score is an accident of one rare word lining up. */
const MIN_SHARED = 2;

/**
 * What a date word is worth, regardless of how common it is. In a prediction market the
 * resolution date is part of the market's IDENTITY - "Fed rates after the September meeting"
 * and "...after the October meeting" are two markets, not one - but statistically the date is
 * the most common thing in the corpus, so IDF alone rates it as filler. This floor is what
 * makes a date DISAGREE loudly enough to split two otherwise identical questions.
 */
const DATE_WEIGHT = 6;

/** Short forms fold into long ones so "Dec 31" and "December 31" are the SAME date. */
const MONTH_CANON: Record<string, string> = {
    jan: 'january',
    feb: 'february',
    mar: 'march',
    apr: 'april',
    jun: 'june',
    jul: 'july',
    aug: 'august',
    sep: 'september',
    sept: 'september',
    oct: 'october',
    nov: 'november',
    dec: 'december'
};

const MONTHS = new Set([
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
    'jan',
    'feb',
    'mar',
    'apr',
    'jun',
    'jul',
    'aug',
    'sep',
    'sept',
    'oct',
    'nov',
    'dec'
]);

/** A year, a day of the month, or a month name. */
function isDate(word: string): boolean {
    return MONTHS.has(word) || /^(?:19|20)\d{2}$/.test(word) || /^\d{1,2}$/.test(word);
}

interface GammaEvent {
    slug?: string;
    title?: string;
}

interface GammaMarket {
    id?: string | number;
    question?: string;
    slug?: string;
    endDate?: string;
    image?: string;
    icon?: string;
    outcomes?: string;
    outcomePrices?: string;
    volumeNum?: number;
    volume?: number | string;
    liquidityNum?: number;
    liquidity?: number | string;
    closed?: boolean;
    active?: boolean;
    events?: GammaEvent[];
}

interface Cached {
    at: number;
    rows: DiscoveredMarket[];
}

let cache: Cached | null = null;

/** In flight, so ten admins opening the tab at once make ONE crawl, not ten. */
let inFlight: Promise<Cached> | null = null;

/** Gamma sends `outcomes` and `outcomePrices` as JSON-encoded STRINGS, not arrays. */
function parseList(raw: string | undefined): string[] {
    if (raw === undefined || raw === '') {
        return [];
    }
    try {
        const value: unknown = JSON.parse(raw);
        return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
    } catch {
        return [];
    }
}

function toNumber(value: number | string | undefined): number {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

/** Lowercase, strip everything that is not a letter, digit or space, drop the stopwords. */
export function tokenize(title: string): Set<string> {
    const words = title
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((word) => word !== '' && !STOPWORDS.has(word))
        .map((word) => MONTH_CANON[word] ?? word);
    return new Set(words);
}

/**
 * How much a word is worth. Rare words carry the identity of a market ("zverev", "ethereum");
 * words most of the corpus shares ("reach", "price", "above") carry almost none, and an
 * unweighted overlap lets three of them outvote the one word that actually differs.
 */
export function idfOf(corpus: Array<Set<string>>): Map<string, number> {
    const documents = new Map<string, number>();
    for (const tokens of corpus) {
        for (const word of tokens) {
            documents.set(word, (documents.get(word) ?? 0) + 1);
        }
    }

    const total = Math.max(corpus.length, 1);
    const idf = new Map<string, number>();
    for (const [word, count] of documents) {
        idf.set(word, Math.log(total / count) + 1);
    }
    return idf;
}

function dateSet(tokens: Set<string>): Set<string> {
    const dates = new Set<string>();
    for (const word of tokens) {
        if (isDate(word)) {
            dates.add(word);
        }
    }
    return dates;
}

function sameDates(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) {
        return false;
    }
    for (const word of a) {
        if (!b.has(word)) {
            return false;
        }
    }
    return true;
}

function weightOf(word: string, idf: Map<string, number>): number {
    return isDate(word) ? DATE_WEIGHT : (idf.get(word) ?? 1);
}

function weigh(tokens: Set<string>, idf: Map<string, number>): number {
    let sum = 0;
    for (const word of tokens) {
        sum += weightOf(word, idf);
    }
    return sum;
}

/**
 * Weighted Jaccard: shared weight over total weight, so a word only ONE side has costs. That
 * is deliberately stricter than containment - a registry title worded more tersely than the
 * venue's scores below the threshold and reads as missing. Wrong in the safe direction: an
 * extra row to glance at, never a market quietly reported as already covered.
 *
 * There is no synonym table either, so "BTC" and "Bitcoin" are different words here.
 */
export function similarity(a: Set<string>, b: Set<string>, idf: Map<string, number>): number {
    if (a.size === 0 || b.size === 0) {
        return 0;
    }

    // Same question, different resolution period, different market. This is the one rule a
    // similarity score cannot express on its own: "Fed rates after the September meeting" and
    // "...after the October meeting" share every other word, and no threshold that keeps real
    // rewordings will also split those two. Only applied when BOTH sides state a date - a
    // terse registry title that omits one still falls through to the score.
    const datesA = dateSet(a);
    const datesB = dateSet(b);
    if (datesA.size > 0 && datesB.size > 0 && !sameDates(datesA, datesB)) {
        return 0;
    }

    let shared = 0;
    let sharedWeight = 0;
    for (const word of a) {
        if (b.has(word)) {
            shared += 1;
            sharedWeight += weightOf(word, idf);
        }
    }

    if (shared < MIN_SHARED) {
        return 0;
    }

    const union = weigh(a, idf) + weigh(b, idf) - sharedWeight;
    return union === 0 ? 0 : sharedWeight / union;
}

function normalize(row: GammaMarket): DiscoveredMarket | null {
    const question = (row.question ?? '').trim();
    const id = row.id === undefined ? '' : String(row.id);
    if (question === '' || id === '') {
        return null;
    }

    const labels = parseList(row.outcomes);
    const prices = parseList(row.outcomePrices);
    const outcomes: DiscoveredOutcome[] = labels.map((label, index) => ({
        label,
        price: toNumber(prices[index])
    }));

    // A market's public page is its EVENT's page; the market slug alone 404s for anything
    // that is one leg of a grouped event.
    const eventSlug = row.events?.[0]?.slug ?? '';
    const url =
        eventSlug === ''
            ? `https://polymarket.com/market/${row.slug ?? ''}`
            : `https://polymarket.com/event/${eventSlug}`;

    return {
        source: 'polymarket',
        sourceId: id,
        question,
        url,
        image: row.image ?? row.icon ?? '',
        endsAt: row.endDate ?? '',
        volume: toNumber(row.volumeNum ?? row.volume),
        liquidity: toNumber(row.liquidityNum ?? row.liquidity),
        outcomes,
        match: null
    };
}

async function fetchPage(offset: number): Promise<GammaMarket[]> {
    const url =
        `${ENDPOINT}?closed=false&active=true&archived=false` +
        `&order=volume24hr&ascending=false&limit=${PAGE_SIZE}&offset=${offset}`;

    const response = await fetch(url, {
        headers: {
            accept: 'application/json',
            // Identify the caller. An anonymous scraper is the one that gets blocked.
            'user-agent': 'Goman-Admin-Discovery/1.0 (+https://github.com/NuraChain/Market)'
        },
        signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    if (!response.ok) {
        throw new Error(`Polymarket responded ${response.status}`);
    }

    const body: unknown = await response.json();
    return Array.isArray(body) ? (body as GammaMarket[]) : [];
}

async function crawl(): Promise<Cached> {
    const rows: DiscoveredMarket[] = [];

    for (let offset = 0; offset < CAP; offset += PAGE_SIZE) {
        const page = await fetchPage(offset);
        for (const row of page) {
            const entry = normalize(row);
            if (entry !== null) {
                rows.push(entry);
            }
        }
        // A short page is the end of the feed - asking for the next one only wastes a request.
        if (page.length < PAGE_SIZE) {
            break;
        }
    }

    return { at: Date.now(), rows };
}

/**
 * The crawl, cached. `force` skips the TTL for the console's refresh button; concurrent
 * callers still share one request.
 */
export async function discover(options: { force?: boolean } = {}): Promise<Cached> {
    const fresh = cache !== null && Date.now() - cache.at < TTL_MS;
    if (fresh && options.force !== true) {
        return cache as Cached;
    }
    if (inFlight !== null) {
        return inFlight;
    }

    inFlight = crawl()
        .then((result) => {
            cache = result;
            return result;
        })
        .finally(() => {
            inFlight = null;
        });

    try {
        return await inFlight;
    } catch (error) {
        // A failed refresh must not throw away a good previous crawl.
        if (cache !== null) {
            return cache;
        }
        throw error;
    }
}

/** Attaches the closest local market to each discovered row, or null when nothing is close. */
export function matchAgainst(
    rows: DiscoveredMarket[],
    local: Array<{ id: string; title: string }>
): DiscoveredMarket[] {
    const discovered = rows.map((row) => ({ row, tokens: tokenize(row.question) }));
    const indexed = local.map((entry) => ({ ...entry, tokens: tokenize(entry.title) }));

    // One corpus over both sides: the weights have to agree, or the same word is worth
    // different amounts depending on which list it came from.
    const idf = idfOf([...discovered.map((entry) => entry.tokens), ...indexed.map((entry) => entry.tokens)]);

    return discovered.map(({ row, tokens }) => {
        let best: { id: string; title: string; score: number } | null = null;

        for (const candidate of indexed) {
            const score = similarity(tokens, candidate.tokens, idf);
            if (score >= MATCH_THRESHOLD && (best === null || score > best.score)) {
                best = { id: candidate.id, title: candidate.title, score: Math.round(score * 100) / 100 };
            }
        }

        return { ...row, match: best };
    });
}
