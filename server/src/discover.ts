// Market discovery: what is live on Polymarket, and which of it this registry does not have.
//
// It runs HERE, not in the browser: the venue's API sends no CORS headers, and a crawl fanned
// out across every admin's tab is a crawl that gets the deployment rate-limited. One process
// fetches, one cache serves everyone.
//
// The venue is read through its official SDK (`@polymarket/client`, per
// docs.polymarket.com/getting-started/typescript): typed rows, keyset paging with no offset
// ceiling, and the venue's own full-text search for what the crawl does not hold.
//
// Read-only on this side: nothing is written here. Each row carries the venue's full wording -
// question, rules, resolution source, answers, image, end date, tags - so the console can seed
// a draft from it; the market itself still leaves through the admin's own signed transaction.

import { createPublicClient, type PublicClient } from '@polymarket/client';

import type { DiscoveredMarket, DiscoveredOutcome, DiscoverTopic, KnownCategory } from './wire.ts';

/** One client for the process. It holds no credentials: every call made here is a public read. */
const venue: PublicClient = createPublicClient();

/** The venue's ceiling per page; asking for more still returns this many. */
const PAGE_SIZE = 100;

/**
 * How much of the venue the crawl holds, most-traded first. The open feed runs to well over a
 * hundred thousand markets, nearly all of them sports legs nobody trades; this is the slice
 * with activity. Anything past it is still reachable, by name, through `searchVenue`.
 */
const CAP = 3000;

/** A crawl is reused for this long. The feed moves in minutes, not seconds. */
const TTL_MS = 5 * 60 * 1000;

/** Events per search. The venue returns every market of each, so this is already hundreds of rows. */
const SEARCH_PAGE = 20;

/** A search answer is reused for this long - long enough to absorb a word typed letter by letter. */
const SEARCH_TTL_MS = 60 * 1000;

/** Distinct queries remembered at once; the oldest goes when a new one arrives. */
const SEARCH_CACHE_MAX = 50;

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

/** A venue tag. The slug is what the category vocabulary reads; the label is its fallback. */
export interface VenueTag {
    label?: string | null;
    slug?: string | null;
}

interface VenueOutcome {
    label?: string | null;
    price?: string | null;
}

/**
 * The slice of the SDK's `Market` this module reads. Declared structurally rather than
 * imported so a test can hand in a literal, and so a field the SDK renames breaks HERE, as
 * a type error, rather than as an empty column in the console.
 */
export interface VenueMarket {
    id: string;
    question?: string | null;
    slug?: string | null;
    description?: string | null;
    image?: string | null;
    icon?: string | null;
    state?: {
        active?: boolean | null;
        closed?: boolean | null;
        archived?: boolean | null;
        endDate?: string | null;
    } | null;
    outcomes?: { yes: VenueOutcome; no: VenueOutcome } | null;
    metrics?: {
        volume?: string | null;
        volumeNum?: string | null;
        liquidity?: string | null;
        liquidityNum?: string | null;
    } | null;
    resolution?: { source?: string | null } | null;
    events?: ReadonlyArray<{ slug?: string | null }> | null;
    tags?: ReadonlyArray<VenueTag> | null;
}

/** The slice of the SDK's `Event` a search result is read through: its tags and its markets. */
export interface VenueEvent {
    slug?: string | null;
    state?: { closed?: boolean | null; archived?: boolean | null } | null;
    markets?: ReadonlyArray<VenueMarket> | null;
    tags?: ReadonlyArray<VenueTag> | null;
}

interface Cached {
    at: number;
    rows: DiscoveredMarket[];
}

/** One crawl per topic, and the whole feed under ''. */
interface Crawl {
    cache: Cached | null;

    /** In flight, so ten admins opening the tab at once make ONE crawl, not ten. */
    inFlight: Promise<Cached> | null;
}

const crawls = new Map<string, Crawl>();

function crawlOf(topic: string): Crawl {
    let slot = crawls.get(topic);
    if (slot === undefined) {
        slot = { cache: null, inFlight: null };
        crawls.set(topic, slot);
    }
    return slot;
}

/** A topic's numeric tag id at the venue, looked up once: slugs are stable and ids never move. */
const tagIds = new Map<string, number>();

async function tagIdOf(topic: DiscoverTopic): Promise<number> {
    const known = tagIds.get(topic);
    if (known !== undefined) {
        return known;
    }
    const tag = await venue.fetchTag({ slug: topic });
    const id = Number(tag.id);
    if (!Number.isFinite(id)) {
        throw new Error(`Polymarket has no tag id for ${topic}`);
    }
    tagIds.set(topic, id);
    return id;
}

/** The SDK carries money as decimal STRINGS, so the arithmetic downstream never sees a float it did not make. */
function toNumber(value: string | number | null | undefined): number {
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

/**
 * A venue tag word, or a whole tag slug, that names one of this registry's categories. Gamma
 * tags are free-form and plentiful ("CPI Release", "Jobs Report", "EPL"), so this is a
 * vocabulary rather than a lookup, and it is deliberately incomplete: a wrong guess costs the
 * admin more than an empty field they fill with one click.
 */
const TAG_CATEGORY: Record<string, KnownCategory> = {
    politics: 'politics',
    election: 'politics',
    elections: 'politics',
    midterms: 'politics',
    primaries: 'politics',
    congress: 'politics',
    senate: 'politics',
    house: 'politics',
    president: 'politics',
    presidential: 'politics',
    governor: 'politics',
    cabinet: 'politics',
    scotus: 'politics',
    'supreme-court': 'politics',
    parliament: 'politics',
    trump: 'politics',
    democrats: 'politics',
    republicans: 'politics',
    impeachment: 'politics',

    crypto: 'crypto',
    bitcoin: 'crypto',
    btc: 'crypto',
    ethereum: 'crypto',
    eth: 'crypto',
    solana: 'crypto',
    sol: 'crypto',
    xrp: 'crypto',
    dogecoin: 'crypto',
    doge: 'crypto',
    memecoins: 'crypto',
    stablecoins: 'crypto',
    altcoins: 'crypto',
    defi: 'crypto',
    nft: 'crypto',
    nfts: 'crypto',
    airdrops: 'crypto',
    hyperliquid: 'crypto',
    binance: 'crypto',
    coinbase: 'crypto',

    sports: 'sports',
    nba: 'sports',
    nfl: 'sports',
    mlb: 'sports',
    nhl: 'sports',
    wnba: 'sports',
    ncaa: 'sports',
    cfb: 'sports',
    cbb: 'sports',
    mls: 'sports',
    soccer: 'sports',
    football: 'sports',
    basketball: 'sports',
    baseball: 'sports',
    hockey: 'sports',
    epl: 'sports',
    ucl: 'sports',
    uel: 'sports',
    laliga: 'sports',
    'la-liga': 'sports',
    'serie-a': 'sports',
    bundesliga: 'sports',
    'ligue-1': 'sports',
    'world-cup': 'sports',
    olympics: 'sports',
    tennis: 'sports',
    atp: 'sports',
    wta: 'sports',
    golf: 'sports',
    pga: 'sports',
    ufc: 'sports',
    mma: 'sports',
    boxing: 'sports',
    f1: 'sports',
    nascar: 'sports',
    cricket: 'sports',
    ipl: 'sports',
    rugby: 'sports',
    esports: 'sports',
    cs2: 'sports',
    valorant: 'sports',
    dota: 'sports',
    chess: 'sports',
    cycling: 'sports',

    economy: 'economy',
    economics: 'economy',
    macro: 'economy',
    fed: 'economy',
    fomc: 'economy',
    rates: 'economy',
    inflation: 'economy',
    cpi: 'economy',
    jobs: 'economy',
    unemployment: 'economy',
    gdp: 'economy',
    recession: 'economy',
    tariffs: 'economy',
    trade: 'economy',
    stocks: 'economy',
    'stock-market': 'economy',
    nasdaq: 'economy',
    sp500: 'economy',
    dow: 'economy',
    earnings: 'economy',
    business: 'economy',
    finance: 'economy',
    treasury: 'economy',
    commodities: 'economy',
    oil: 'economy',
    gold: 'economy',
    housing: 'economy',

    tech: 'tech',
    technology: 'tech',
    ai: 'tech',
    openai: 'tech',
    chatgpt: 'tech',
    anthropic: 'tech',
    google: 'tech',
    apple: 'tech',
    microsoft: 'tech',
    meta: 'tech',
    nvidia: 'tech',
    tesla: 'tech',
    amazon: 'tech',
    'big-tech': 'tech',
    startups: 'tech',
    ipo: 'tech',
    software: 'tech',
    robotics: 'tech',
    iphone: 'tech',

    culture: 'culture',
    'pop-culture': 'culture',
    pop: 'culture',
    entertainment: 'culture',
    movies: 'culture',
    film: 'culture',
    'box-office': 'culture',
    music: 'culture',
    tv: 'culture',
    television: 'culture',
    celebrities: 'culture',
    celebrity: 'culture',
    awards: 'culture',
    oscars: 'culture',
    grammys: 'culture',
    emmys: 'culture',
    'golden-globes': 'culture',
    eurovision: 'culture',
    gaming: 'culture',
    'video-games': 'culture',
    streaming: 'culture',
    netflix: 'culture',
    youtube: 'culture',
    tiktok: 'culture',
    fashion: 'culture',
    royals: 'culture',

    science: 'science',
    space: 'science',
    nasa: 'science',
    spacex: 'science',
    mars: 'science',
    climate: 'science',
    weather: 'science',
    hurricane: 'science',
    hurricanes: 'science',
    temperature: 'science',
    earthquake: 'science',
    health: 'science',
    pandemic: 'science',
    pandemics: 'science',
    covid: 'science',
    virus: 'science',
    vaccine: 'science',
    medicine: 'science',
    fda: 'science',
    flu: 'science',
    physics: 'science',
    nobel: 'science',

    world: 'world',
    geopolitics: 'world',
    global: 'world',
    international: 'world',
    'foreign-policy': 'world',
    'middle-east': 'world',
    israel: 'world',
    gaza: 'world',
    palestine: 'world',
    ukraine: 'world',
    russia: 'world',
    china: 'world',
    taiwan: 'world',
    iran: 'world',
    korea: 'world',
    war: 'world',
    ceasefire: 'world',
    nato: 'world',
    un: 'world',
    eu: 'world',
    europe: 'world',
    uk: 'world',
    britain: 'world',
    france: 'world',
    germany: 'world',
    india: 'world',
    canada: 'world',
    mexico: 'world',
    brazil: 'world',
    japan: 'world',
    australia: 'world',
    africa: 'world',
    venezuela: 'world',
    syria: 'world',
    turkey: 'world',
    military: 'world',
    nuclear: 'world'
};

/**
 * The venue's tags, mapped onto this registry's categories. Tags are read in the order the
 * venue lists them; a whole slug is tried before its words, so "world-cup" is sports before
 * "world" can make it world. '' means no tag said anything this registry recognises.
 */
export function categoryOf(tags: ReadonlyArray<VenueTag>): string {
    for (const tag of tags) {
        const slug = (tag.slug ?? tag.label ?? '').trim().toLowerCase();
        const whole = TAG_CATEGORY[slug];
        if (whole !== undefined) {
            return whole;
        }
        for (const word of slug.split(/[^a-z0-9]+/)) {
            const hit = TAG_CATEGORY[word];
            if (hit !== undefined) {
                return hit;
            }
        }
    }
    return '';
}

/**
 * One venue market as a row here. `eventTags` stand in when the market carries none of its
 * own - a search result's markets come bare and borrow their event's. A market that can no
 * longer be traded there is not worth creating here, so it reads as nothing.
 */
export function normalize(row: VenueMarket, eventTags: ReadonlyArray<VenueTag> = []): DiscoveredMarket | null {
    const question = (row.question ?? '').trim();
    const id = row.id.trim();
    if (question === '' || id === '') {
        return null;
    }

    const state = row.state;
    if (state?.closed === true || state?.archived === true || state?.active === false) {
        return null;
    }

    const outcomes: DiscoveredOutcome[] = [];
    for (const side of [row.outcomes?.yes, row.outcomes?.no]) {
        const label = (side?.label ?? '').trim();
        if (label !== '') {
            outcomes.push({ label, price: toNumber(side?.price) });
        }
    }

    // A market's public page is its EVENT's page; the market slug alone 404s for anything
    // that is one leg of a grouped event.
    const eventSlug = row.events?.[0]?.slug ?? '';
    const url =
        eventSlug === ''
            ? `https://polymarket.com/market/${row.slug ?? ''}`
            : `https://polymarket.com/event/${eventSlug}`;

    const tags = row.tags !== undefined && row.tags !== null && row.tags.length > 0 ? row.tags : eventTags;

    return {
        source: 'polymarket',
        sourceId: id,
        question,
        url,
        image: row.image ?? row.icon ?? '',
        description: (row.description ?? '').trim(),
        resolutionSource: (row.resolution?.source ?? '').trim(),
        category: categoryOf(tags),
        endsAt: state?.endDate ?? '',
        volume: toNumber(row.metrics?.volumeNum ?? row.metrics?.volume),
        liquidity: toNumber(row.metrics?.liquidityNum ?? row.metrics?.liquidity),
        outcomes,
        match: null
    };
}

/** Every still-open market of a venue event, each tagged by the event. */
export function fromEvent(event: VenueEvent): DiscoveredMarket[] {
    if (event.state?.closed === true || event.state?.archived === true) {
        return [];
    }

    const rows: DiscoveredMarket[] = [];
    for (const market of event.markets ?? []) {
        // A nested market names no event of its own; its page is still the event's.
        const events =
            market.events !== undefined && market.events !== null && market.events.length > 0
                ? market.events
                : [{ slug: event.slug }];
        const entry = normalize({ ...market, events }, event.tags ?? []);
        if (entry !== null) {
            rows.push(entry);
        }
    }
    return rows;
}

/** The venue's most-traded slice - of everything, or of one topic when `topic` names a tag. */
async function crawl(topic: DiscoverTopic | null): Promise<Cached> {
    const rows: DiscoveredMarket[] = [];

    // The feed is ordered by a number that moves between requests, so a market can appear on
    // two adjacent pages; the second sighting is dropped.
    const seen = new Set<string>();

    const tagId = topic === null ? null : await tagIdOf(topic);
    const pages = venue.listMarkets({
        closed: false,
        includeTag: true,
        order: 'volume24hr',
        ascending: false,
        pageSize: PAGE_SIZE,
        ...(tagId === null ? {} : { tagId })
    });

    try {
        for await (const page of pages) {
            for (const market of page.items) {
                const entry = normalize(market);
                if (entry !== null && !seen.has(entry.sourceId)) {
                    seen.add(entry.sourceId);
                    rows.push(entry);
                }
            }
            if (rows.length >= CAP) {
                break;
            }
        }
    } catch (error) {
        // The FIRST page failing is the venue being down. A later one failing must not throw
        // away the pages already in hand.
        if (rows.length === 0) {
            throw error;
        }
    }

    return { at: Date.now(), rows };
}

/**
 * The crawl, cached per topic. A stale crawl is served at once while a fresh one lands behind
 * it; only a console with nothing to show yet, or one that pressed re-crawl (`force`), waits
 * for the venue. Concurrent callers still share one request.
 */
export async function discover(options: { topic?: DiscoverTopic; force?: boolean } = {}): Promise<Cached> {
    const topic = options.topic ?? null;
    const slot = crawlOf(topic ?? '');

    const fresh = slot.cache !== null && Date.now() - slot.cache.at < TTL_MS;
    if (fresh && options.force !== true) {
        return slot.cache as Cached;
    }

    if (slot.inFlight === null) {
        slot.inFlight = crawl(topic)
            .then((result) => {
                slot.cache = result;
                return result;
            })
            .finally(() => {
                slot.inFlight = null;
            });
    }
    const refresh = slot.inFlight;

    if (slot.cache !== null && options.force !== true) {
        refresh.catch(() => {
            /* the stale crawl stays; the next call tries again */
        });
        return slot.cache;
    }

    try {
        return await refresh;
    } catch (error) {
        // A failed refresh must not throw away a good previous crawl.
        if (slot.cache !== null) {
            return slot.cache;
        }
        throw error;
    }
}

interface SearchHit {
    at: number;
    rows: DiscoveredMarket[];
}

const searches = new Map<string, SearchHit>();

/**
 * The venue's own full-text search, for what the crawl's top slice does not hold: one page
 * of events, every open market in them. A market nobody is trading yet is still one query
 * away, which is what makes the console's search complete rather than a filter over a cache.
 */
export async function searchVenue(query: string, topic: DiscoverTopic | null = null): Promise<DiscoveredMarket[]> {
    const q = query.trim().toLowerCase();
    if (q === '') {
        return [];
    }

    const key = `${topic ?? ''}|${q}`;
    const hit = searches.get(key);
    if (hit !== undefined && Date.now() - hit.at < SEARCH_TTL_MS) {
        return hit.rows;
    }

    // Scoped to the topic when one is picked, so "temperature" under Weather does not surface
    // a crypto market that happens to use the word.
    const page = await venue
        .search({ q, pageSize: SEARCH_PAGE, ...(topic === null ? {} : { eventsTag: [topic] }) })
        .firstPage();

    const rows: DiscoveredMarket[] = [];
    const seen = new Set<string>();
    for (const event of page.items.events) {
        for (const entry of fromEvent(event)) {
            if (!seen.has(entry.sourceId)) {
                seen.add(entry.sourceId);
                rows.push(entry);
            }
        }
    }

    if (searches.size >= SEARCH_CACHE_MAX) {
        const oldest = searches.keys().next().value;
        if (oldest !== undefined) {
            searches.delete(oldest);
        }
    }
    searches.set(key, { at: Date.now(), rows });
    return rows;
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
