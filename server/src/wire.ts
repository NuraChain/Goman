// THE wire vocabulary: every shape that crosses between the server and the browser, the
// on-chain metadata codec both halves share, and - at the bottom - the schema that validates
// all of it. CLIENT-SAFE BY CONSTRUCTION: the one import is `@azerothjs/schema`, which is
// browser-safe by design, so the application still pulls no server dependency and no byte of
// Node through this module.
//
// The schemas at the bottom are being ported from the TypeBox ones in schemas.ts. While both
// exist, each is asserted against the SAME interface - `Static<typebox>` over there and
// `Infer<azeroth>` down here - which makes the port a compile-time proof rather than a promise.
// schemas.ts and the interfaces go together when the routes move over.
//
// Every value is REAL: the server derives it from chain state, never from seeded fiction.
import { array, boolean, enumOf, number, object, string, type Infer } from '@azerothjs/schema';

/**
 * The categories with first-class icons and i18n labels. A market may carry ANY category
 * string (admins mint categories freely); these are only the ones the UI decorates.
 */
export const KNOWN_CATEGORIES = [
    'politics',
    'crypto',
    'sports',
    'economy',
    'tech',
    'culture',
    'science',
    'world'
] as const;
export type KnownCategory = (typeof KNOWN_CATEGORIES)[number];

/** Lifecycle on the wire; the contract's MarketStatus enum in lowercase. */
export const MARKET_STATUSES = ['open', 'paused', 'closed', 'resolved', 'voided'] as const;
export type MarketStatusName = (typeof MARKET_STATUSES)[number];

export const MARKET_KINDS = ['amm', 'pool'] as const;
export type MarketKindName = (typeof MARKET_KINDS)[number];

export const MARKET_SORTS = ['volume', 'newest', 'ending'] as const;
export type MarketSort = (typeof MARKET_SORTS)[number];

export const RANGES = ['1d', '1w', '1m', 'all'] as const;
export type Range = (typeof RANGES)[number];

export const PERIODS = ['day', 'week', 'month', 'all'] as const;
export type Period = (typeof PERIODS)[number];

export const SIDES = ['yes', 'no'] as const;
export type Side = (typeof SIDES)[number];

export const TRADE_ACTIONS = ['buy', 'sell'] as const;
export type TradeAction = (typeof TRADE_ACTIONS)[number];

/**
 * How a multi-tag filter combines its tags: `any` is OR (the default - a wider net, and the
 * relevance score then floats the markets that matched several of them to the top), `all` is
 * AND (every named tag must be present).
 */
export const TAG_MODES = ['any', 'all'] as const;
export type TagMode = (typeof TAG_MODES)[number];

/** Longest a single tag may be, in characters. Longer is a sentence, not a label. */
export const TAG_MAX_LENGTH = 48;

/** Most tags one market may carry. A market tagged thirty ways is tagged no way at all. */
export const TAGS_PER_MARKET = 12;

/**
 * THE tag normaliser. A tag is identified by this function's output and by nothing else, so
 * every writer and every reader - the create form, the envelope decoder, the index, the
 * search box, the autocomplete - has to go through here or two spellings of one subject
 * become two subjects.
 *
 * `Football`, `FOOTBALL`, ` Iran Football ` and `iran--football!` all land on the same slug.
 *
 * Unicode-safe rather than ASCII-safe: the rule keeps letters, digits and combining MARKS in
 * any script, which is what lets `فوتبال ایران` and `足球` be tags at all. `\p{M}` is the
 * reason - strip it and Persian and Devanagari lose the vowel marks attached to their
 * letters, silently mangling the word. Everything else (punctuation, emoji, the zero-width
 * non-joiner) reads as a word separator and collapses to a single `-`.
 *
 * Returns '' for input with no word characters in it, which is the caller's signal to drop
 * the tag: an empty tag is never created.
 */
export function normalizeTag(raw: string): string
{
    // Clipped by CODE POINT, not by unit: `.slice` on a string of emoji or of an astral
    // script would cut a surrogate pair in half and leave an unpaired half in the slug.
    return clip(slugify(raw)).replace(/-+$/g, '');
}

/**
 * Words joined by hyphens, with everything that is not a letter, a digit or a combining mark
 * collapsed to one separator. The rule a tag is identified by and the rule a market's URL is
 * built from, written once: two spellings of one slug rule is how the two drift apart.
 */
export function slugify(raw: string): string
{
    return raw
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
        .replace(/^-+|-+$/g, '');
}

/** A tag's display form: the author's own spelling, tidied. Never used to identify it. */
export function tagNameOf(raw: string): string
{
    return clip(raw.normalize('NFKC').trim().replace(/\s+/g, ' '));
}

function clip(value: string): string
{
    const points = [...value];
    return points.length <= TAG_MAX_LENGTH ? value : points.slice(0, TAG_MAX_LENGTH).join('');
}

/**
 * A written list of tags as it is stored: author spelling preserved, but deduplicated BY SLUG
 * (so `Football` and `football` are one entry, the first spelling winning), empties dropped,
 * and capped at {@link TAGS_PER_MARKET}.
 */
export function dedupeTags(raw: readonly string[]): string[]
{
    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of raw)
    {
        const slug = normalizeTag(entry);
        if (slug === '' || seen.has(slug))
        {
            continue;
        }
        seen.add(slug);
        out.push(tagNameOf(entry));
        if (out.length === TAGS_PER_MARKET)
        {
            break;
        }
    }
    return out;
}

/** The slugs a written list resolves to, in order and without repeats. */
export function tagSlugs(raw: readonly string[]): string[]
{
    return [...new Set(raw.map(normalizeTag).filter((slug) => slug !== ''))].slice(0, TAGS_PER_MARKET);
}

// ----------------------------------------------------------------------------------------
// Market URLs
//
// A market's address on the web is its QUESTION, not its row number: `/market/12` told a
// reader and a search engine nothing, and a search result is mostly its URL. The number is
// still what resolves the page - it just moved to the end, where it stops being the thing you
// read and starts being the thing the router parses.
//
// Built from the ENGLISH text in every language, deliberately. English is the one variant a
// market cannot be deployed without, and one canonical URL per market is worth more than a
// localised one: ten translations of a path would be ten URLs competing for one page's
// ranking, and the page they open is identical either way.

/** Longest the question may run in a path. Past this a URL stops fitting a search result. */
const SLUG_TITLE_MAX = 60;

/** The rules get a clause, not a paragraph - enough to say what settles it. */
const SLUG_DESCRIPTION_MAX = 40;

/** What a market's path falls back to when its text slugifies to nothing at all - an
 *  emoji-only question is legal on chain, and a path of just digits would not resolve. */
const SLUG_FALLBACK = 'market';

/** Cuts a slug to `max` code points WITHOUT splitting a word: a path ending in `-derb` reads
 *  as a typo, and half a word is no use to a reader or to a search engine. */
function clipWords(slug: string, max: number): string
{
    const points = [...slug];
    if (points.length <= max)
    {
        return slug;
    }
    const cut = points.slice(0, max).join('');
    const lastBreak = cut.lastIndexOf('-');
    return (lastBreak > 0 ? cut.slice(0, lastBreak) : cut).replace(/-+$/g, '');
}

/**
 * A market's path segment: question, then what settles it, then the id.
 *
 * The ID IS THE ADDRESS - everything before it is decoration a reader and a crawler can use,
 * and {@link marketIdFromSlug} ignores it entirely. That is what lets an admin fix a typo in a
 * title without breaking a link somebody already shared.
 */
export function marketSlug(market: { id: string; title: Localized; rules: Localized }): string
{
    const words = [
        clipWords(slugify(market.title.en), SLUG_TITLE_MAX),
        clipWords(slugify(market.rules.en), SLUG_DESCRIPTION_MAX)
    ].filter((part) => part !== '');
    return `${ words.length === 0 ? SLUG_FALLBACK : words.join('-') }-${ market.id }`;
}

/** The absolute in-app path for a market. The ONE place a market link is spelled. */
export function marketPath(market: { id: string; title: Localized; rules: Localized }): string
{
    return `/market/${ marketSlug(market) }`;
}

/**
 * The market id a path segment names, or '' when it names none.
 *
 * A bare `/market/12` returns '' on purpose: the slug is the address now, and a numeric path
 * is the old shape rather than a shorter spelling of the new one.
 */
export function marketIdFromSlug(slug: string): string
{
    const found = /^(.+)-(\d+)$/.exec(slug);
    return found === null ? '' : (found[2] ?? '');
}

/**
 * True when a market's category is a REGISTRY ID rather than a name from before the registry
 * existed. Both eras sit side by side in the index, and the two are told apart by shape and
 * nowhere else, so the rule is written once here and shared by both halves.
 */
export function isRegistryCategory(category: string): boolean
{
    const trimmed = category.trim();
    return /^[0-9]+$/.test(trimmed) && Number(trimmed) > 0 && Number(trimmed) <= 4_294_967_295;
}

/**
 * A tag as every reader meets it: the slug is the identity (the URL, the filter, the search
 * term), the name is what is printed on the chip.
 */
export interface MarketTag {
    slug: string;
    name: string;
}

/** A tag plus how many markets carry it - the autocomplete's ordering. */
export interface TagCount extends MarketTag {
    count: number;
}

export interface TagsQuery {
    /** A prefix to complete. Absent lists the most-used tags. */
    q?: string;
    limit?: number;
}

/**
 * Every language a market's own text can be written in - the same set the UI ships
 * dictionaries for. It lives HERE rather than in the client's `i18n/langs.ts` because the
 * envelope, the schema and the index all key off it; the client's registry must stay in step
 * with this list, and `text()` there is what indexes a Localized by the active code.
 */
export const CONTENT_LANGS = ['en', 'fa', 'ar', 'es', 'pt', 'hi', 'zh', 'ru', 'fr', 'tr'] as const;
export type ContentLang = (typeof CONTENT_LANGS)[number];

/**
 * A human-readable string in as many languages as its author wrote it in. `en` is the ONLY
 * required one and is the floor every other language falls back to - which is why the create
 * form refuses a market with no English title. The rest are absent rather than mirrored: a
 * market carried ten copies of its English title before, and the wire paid for all ten.
 */
export interface Localized {
    en: string;
    fa?: string;
    ar?: string;
    es?: string;
    pt?: string;
    hi?: string;
    zh?: string;
    ru?: string;
    fr?: string;
    tr?: string;
}

// ----------------------------------------------------------------------------------------
// Metadata envelope
//
// On-chain markets store one plain string per field. Translations and the emoji ride a small
// JSON envelope INSIDE those strings: `{"v":1,"en":...,"fa":...,"emoji":...}` for titles,
// `{"v":1,"en":...,"fa":...}` for descriptions. A plain (non-envelope) string stays valid
// everywhere and reads as the same text in every language.
//
// The envelope is OPEN over CONTENT_LANGS: adding a language adds a key, and `v` stays 1
// because nothing about how it is read changed. A market deployed when this carried only en
// and fa decodes exactly as it always did - the languages it never had are simply absent, and
// every reader already falls back to `en`. Empty values are never written, so a market with
// one translation does not pay for nine blank keys on chain.
// ----------------------------------------------------------------------------------------

/** A decoded market title: every language it was written in, the card emoji, and the tags. */
export type TitleMeta = Localized & { emoji: string; tags: string[] };

/**
 * A Localized reduced to the languages actually written in it. Two jobs: it drops empty
 * translations so neither the chain nor the index pays for them, and it strips a TitleMeta's
 * `emoji` back out - the emoji is a column and an envelope key of its own, never a language.
 */
export function localizedOf(meta: Localized): Localized
{
    const out: Localized = { en: meta.en };
    for (const code of CONTENT_LANGS)
    {
        const value = meta[code];
        if (code !== 'en' && typeof value === 'string' && value !== '')
        {
            out[code] = value;
        }
    }
    return out;
}

/**
 * Encodes a translated title + emoji + tags into the on-chain string.
 *
 * Tags ride the title envelope for the same reason outcome art rides the outcome one: the
 * contracts write these strings once in `initialize` and have no setter, so a market's
 * subjects are committed with the market itself and need no contract change to exist. An
 * empty list writes no key at all, so an untagged market pays nothing for the feature and
 * every market deployed before it decodes exactly as it always did.
 */
export function encodeTitleMeta(meta: Localized & { emoji: string; tags?: string[] }): string
{
    const tags = dedupeTags(meta.tags ?? []);
    return JSON.stringify({ v: 1, ...localizedOf(meta), emoji: meta.emoji, ...(tags.length === 0 ? {} : { tags }) });
}

/** Encodes translated body text (description/rules, an outcome name) into the on-chain string. */
export function encodeTextMeta(meta: Localized & { icon?: string }): string
{
    return JSON.stringify({
        v: 1,
        ...localizedOf(meta),
        ...(meta.icon === undefined || meta.icon === '' ? {} : { icon: meta.icon })
    });
}

/** Reads every language the envelope carries. `en` falls back to the raw (plain) string. */
function readText(envelope: Record<string, unknown> | null, raw: string): Localized
{
    const out: Localized = { en: typeof envelope?.en === 'string' && envelope.en !== '' ? envelope.en : raw };
    for (const code of CONTENT_LANGS)
    {
        const value = envelope?.[code];
        if (code !== 'en' && typeof value === 'string' && value !== '')
        {
            out[code] = value;
        }
    }
    return out;
}

function parseEnvelope(raw: string): Record<string, unknown> | null
{
    if (!raw.startsWith('{'))
    {
        return null;
    }
    try
    {
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null && (parsed as { v?: unknown }).v === 1
            ? (parsed as Record<string, unknown>)
            : null;
    }
    catch
    {
        return null;
    }
}

/** Decodes an on-chain title string; a plain string falls back to itself + `fallbackEmoji`. */
export function decodeTitleMeta(raw: string, fallbackEmoji: string): TitleMeta
{
    const envelope = parseEnvelope(raw);
    const emoji = typeof envelope?.emoji === 'string' && envelope.emoji !== '' ? envelope.emoji : fallbackEmoji;
    return { ...readText(envelope, raw), emoji, tags: readTags(envelope?.tags) };
}

/** The envelope's tag list, defended: anything that is not an array of strings reads as no
 *  tags rather than throwing a market off the index. */
function readTags(value: unknown): string[]
{
    return Array.isArray(value) ? dedupeTags(value.filter((entry): entry is string => typeof entry === 'string')) : [];
}

/**
 * An outcome's decoded name. `icon` rides the SAME envelope the labels do, so outcome art
 * needed no contract change: an older market simply carries no icon key.
 */
export function decodeOutcomeMeta(raw: string): Localized & { icon: string }
{
    const envelope = parseEnvelope(raw);
    const label = decodeTextMeta(raw);
    return { ...label, icon: typeof envelope?.icon === 'string' ? envelope.icon : '' };
}

/** Decodes an on-chain body string (description/rules); a plain string becomes its English. */
export function decodeTextMeta(raw: string): Localized
{
    return readText(parseEnvelope(raw), raw);
}

// ----------------------------------------------------------------------------------------
// Markets
// ----------------------------------------------------------------------------------------

/**
 * One tradable outcome. A binary market has a single outcome ('yes' at `price`); a
 * multi-outcome market lists one row per candidate. `price` IS the probability (0..1);
 * `change24h` is the day's move in probability points, signed. `index` is the outcome's
 * on-chain index - what `buy()` takes.
 */
export interface Outcome {
    id: string;
    index: number;
    label: Localized;

    /** Outcome art (a team badge, a candidate photo). Empty when the market carries none. */
    icon: string;
    price: number;
    change24h: number;
}

export interface Market {
    id: string;
    address: string;
    category: string;
    emoji: string;

    /** The market's own image URI, on-chain since deploy. Empty falls back to the emoji. */
    image: string;
    title: Localized;
    rules: Localized;
    status: MarketStatusName;
    winningOutcomeId: string | null;

    /** Engine: `amm` (CPMM shares, `buy`/`sell`) vs `pool` (parimutuel, `bet`/`claim`). */
    kind: MarketKindName;

    /** The NO leg's on-chain outcome index for binary markets; null for multi-outcome. */
    noIndex: number | null;

    /** What the market is ABOUT, as a reader can click on it. Free-form and many per market,
     *  unlike `category`, which is one id the factory has to have been told about. */
    tags: MarketTag[];
    outcomes: Outcome[];
    volume: number;
    liquidity: number;
    endsAt: string;

    /**
     * When trading opens, for a market deployed ahead of time. Null for the ordinary case of a
     * market that was open the moment it existed. A market whose `startsAt` is still ahead is
     * `paused` on chain, which is what actually stops a bet - this is the reason for it.
     */
    startsAt: string | null;
    createdAt: string;
    featured: boolean;
    trending: boolean;
}

export interface MarketsQuery {
    search?: string;
    category?: string;
    status?: MarketStatusName;
    sort?: MarketSort;
    featured?: boolean;
    trending?: boolean;

    /** A market id to leave out (the related-markets rail excludes the page's own market). */
    exclude?: string;

    /** Comma-separated market ids to restrict to (the client-side watchlist's server query). */
    ids?: string;

    /** Comma-separated tag slugs. Combined per {@link tagMode}; normalised server-side, so a
     *  hand-written `?tags=Iran Football` still finds `iran-football`. */
    tags?: string;
    tagMode?: TagMode;
    page?: number;
    limit?: number;
}

export interface MarketPage {
    rows: Market[];
    total: number;
    page: number;
    pages: number;
}

/**
 * A category as the UI sees it. `id` is the immutable string markets carry on-chain; the label
 * is indexer-side PRESENTATION and is the only part an admin can ever change. `count` is 0 for
 * a category registered before its first market exists.
 *
 * Deleting a row here removes the PRESENTATION only. Markets keep the id they carry on-chain
 * and fall back to showing it raw, which is also why deleting one is recoverable: registering
 * the id again restores every label it had.
 */
export interface CategoryCount {
    id: string;
    count: number;

    /** What to CALL it, in every language an admin has written it in. */
    label: Localized;
    retired: boolean;
}

/** Category presentation edits, authenticated the same way the featured toggle is. */
export interface CategoryInput {
    id: string;
    label: Localized;
    sortOrder: number;
    retired: boolean;
    address: string;
    issuedAt: string;
    signature: string;
}

/** Removing a category's presentation row. Signed like every other admin write. */
export interface CategoryDeleteInput {
    id: string;
    address: string;
    issuedAt: string;
    signature: string;
}

export function categoryMessage(id: string, issuedAt: string): string
{
    return `Goman admin: update category ${ id } at ${ issuedAt }`;
}

/** A DIFFERENT message from the update one on purpose: a signature captured for an edit must
 *  not be replayable as a delete. */
export function categoryDeleteMessage(id: string, issuedAt: string): string
{
    return `Goman admin: delete category ${ id } at ${ issuedAt }`;
}

/** An image upload's text fields; the bytes ride beside them as file parts. */
export interface UploadFields {
    address: string;
    issuedAt: string;
    signature: string;
}

export interface UploadResult {
    uri: string;
    type: string;
    bytes: number;
}

export function uploadMessage(issuedAt: string): string
{
    return `Goman admin: upload image at ${ issuedAt }`;
}

export interface SeriesQuery {
    outcome: string;
    range: Range;
}

export interface SeriesPoint {
    t: number;
    p: number;
}

export interface Series {
    points: SeriesPoint[];
}

export interface ActivityItem {
    id: string;
    marketId: string;

    /** The market's path segment, as {@link marketSlug} spells it. Carried on the row because
     *  a feed of trades has to link to each market without holding a market list to join
     *  against - the same reason {@link Position} embeds its whole market. */
    marketSlug: string;

    /** The trader's address; the client shortens and avatars it. */
    user: string;
    action: TradeAction;
    outcomeId: string;
    side: Side;
    shares: number;

    /**
     * The REALIZED fill price: collateral per share (`amount / shares`), not a probability.
     * It is deliberately unbounded above - the taker pays the trading fee on top, so a buy
     * settles slightly over 1 whenever the outcome was already near-certain. Bounding this at
     * 1 (as an outcome's probability correctly is) made the whole endpoint fail its own
     * contract the moment such a trade landed in the window.
     */
    price: number;
    at: string;
}

/** The page window every paged list route accepts (activity, holders, the admin feed). */
export interface ActivityQuery {
    page?: number;
    limit?: number;
}

export interface ActivityPage {
    rows: ActivityItem[];
    total: number;
    page: number;
    pages: number;
}

export interface Holder {
    user: string;
    outcomeId: string;
    side: Side;
    shares: number;
}

export interface HolderPage {
    rows: Holder[];
    total: number;
    page: number;
    pages: number;
}

// ----------------------------------------------------------------------------------------
// Portfolio (all address-scoped: the wallet IS the account)
// ----------------------------------------------------------------------------------------

export interface AddressQuery {
    address: string;
}

export interface Position {
    id: string;
    marketId: string;
    outcomeId: string;
    side: Side;
    shares: number;

    /** Fee-inclusive VWAP cost per share - a fill price, so unbounded above like one. */
    avgPrice: number;
    openedAt: string;

    /** True when the market resolved this way (or voided) and redeem() pays out. */
    claimable: boolean;

    /** The market embedded, so the client never joins against a global list. */
    market: Market;
}

export interface PortfolioSummary {
    /** The wallet's native balance. */
    balance: number;
    invested: number;
    current: number;
    profit: number;
    profitToday: number;
}

/** A P/L curve point: `p` is native-token value (signed), unlike the probability series. */
export interface ProfitPoint {
    t: number;
    p: number;
}

export interface ProfitSeries {
    points: ProfitPoint[];
}

export interface ProfitSeriesQuery {
    period: Period;
    address: string;
}

// ----------------------------------------------------------------------------------------
// Leaderboard
// ----------------------------------------------------------------------------------------

export interface LeaderboardQuery {
    period: Period;
}

export interface LeaderboardRow {
    rank: number;
    address: string;
    profit: number;
    volume: number;
}

// ----------------------------------------------------------------------------------------
// Chain config + admin
// ----------------------------------------------------------------------------------------

/** What the frontend needs to talk to the chain; replaces every hardcoded address map. */
export interface ChainConfig {
    chainId: number;
    factory: string;
    treasury: string;
    deployBlock: number;

    /** The last block the indexer has ingested; clients wait on it after a write. */
    lastBlock: number;
}

export interface AdminStats {
    markets: number;
    open: number;
    paused: number;
    closed: number;
    resolved: number;
    voided: number;
    volume: number;
    volume24h: number;
    traders: number;
    feesCollected: number;
    tvl: number;
}

export interface AdminMarketRow {
    id: string;
    address: string;
    title: Localized;
    emoji: string;
    category: string;
    status: MarketStatusName;

    /** Which engine the market runs on. The console needs it before it reads the clone: the
     *  two engines share no view surface, so an AMM read against a pool reverts. */
    kind: MarketKindName;
    winningOutcomeId: string | null;
    outcomeCount: number;
    createdAt: string;
    startsAt: string | null;
    locksAt: string;
    resolvesAt: string;
    liquidity: number;
    volume: number;
    collected: number;
    featured: boolean;

    /** True when an admin has corrected this market's text since it was deployed. The chain
     *  still holds the original; see {@link MarketEditState.origin}. */
    edited: boolean;
}

export interface AdminMarketPage {
    rows: AdminMarketRow[];
    total: number;
    page: number;
    pages: number;
}

// ----------------------------------------------------------------------------------------
// The Telegram bot: its settings, and who may prepare a market in the console.
//
// The bot no longer takes market suggestions. It posts the trade feed and backs the database
// up; a market is prepared in the create form by a wallet the console invited, which is what
// `MarketCreator` below is. That allowlist is an APP permission and grants nothing on chain.

/**
 * A wallet the console has invited to prepare markets.
 *
 * It is an APP permission and nothing more. The factory gates `createMarket` on ADMIN_ROLE and
 * has no create-only role to give, so an invited wallet cannot deploy anything: it opens the
 * create form, fills it in, and submits it as a {@link Proposal} for the owner to sign off.
 * Nothing here touches the chain.
 */
export interface MarketCreator {
    /** Lowercased hex - the allowlist key. */
    address: string;

    /** A name for whoever holds the wallet, so the list is readable. Display only. */
    label: string;

    /** The console admin who invited them, and when. */
    addedBy: string;
    addedAt: string;
}

/** `address` is the ADMIN signing, as in every other admin input; `wallet` is the subject. */
export interface MarketCreatorInput {
    wallet: string;
    label: string;
    address: string;

    /** ISO timestamp inside the signed message; the server rejects stale ones. */
    issuedAt: string;
    signature: string;
}

export interface MarketCreatorRemoveInput {
    wallet: string;
    address: string;
    issuedAt: string;
    signature: string;
}

/**
 * Whether one wallet may open the create form. The only creator read that is NOT behind the
 * admin session, and it has to be: the wallet asking is by definition not an admin. A yes/no
 * about the address you already named is all that leaves, so the list itself stays private.
 */
export interface CreatorAccess {
    allowed: boolean;
}

/** The bot's runtime settings, the ones the console owns rather than the environment. */
export interface TelegramSettings {
    /** Minutes between database backups. */
    backupMinutes: number;

    /** Off silences the per-event feed and keeps the backups. */
    events: boolean;
}

/** Settings, and whether a bot is configured at all - one read for the tab. */
export interface TelegramState {
    settings: TelegramSettings;

    /** False when no token or chat id is set, so the console can say the bot is inert rather
     *  than showing settings that change nothing. */
    configured: boolean;

    /** The bot's @name, when it could be read, so the console can link to it. */
    botName: string;
}

export interface TelegramSettingsInput {
    backupMinutes: number;
    events: boolean;
    address: string;

    /** ISO timestamp inside the signed message; the server rejects stale ones. */
    issuedAt: string;
    signature: string;
}

/** The message a console signs to change the bot's settings. */
export function telegramSettingsMessage(backupMinutes: number, events: boolean, issuedAt: string): string
{
    return `Goman admin: set telegram backup=${ backupMinutes }m events=${ events ? 'on' : 'off' } at ${ issuedAt }`;
}

/** Inviting a wallet to prepare markets. The address is IN the message, so a signature
 *  collected to invite one wallet cannot be replayed to invite another. */
export function creatorMessage(wallet: string, issuedAt: string): string
{
    return `Goman admin: let ${ wallet.toLowerCase() } prepare markets at ${ issuedAt }`;
}

/** A DIFFERENT message from the invitation, so neither signature is the other's. */
export function creatorRemoveMessage(wallet: string, issuedAt: string): string
{
    return `Goman admin: stop ${ wallet.toLowerCase() } preparing markets at ${ issuedAt }`;
}

// ----------------------------------------------------------------------------------------
// Proposals: a market written by someone who cannot deploy one.
//
// A draft used to be handed over as a LINK, which meant the handover only worked if whoever
// filled the form in also had a way to reach the owner and the owner remembered to open it.
// A proposal is the same draft parked on this server instead, so the queue is the console's
// rather than somebody's chat history.
//
// Nothing here touches the chain. Accepting a proposal records a verdict and seeds the create
// form; the market is still deployed by the owner's own wallet, signing the same transaction
// they would have signed anyway. This server holds no key that could mint a market, and a
// queue that could would be a far more interesting thing to compromise.

export const PROPOSAL_STATES = ['pending', 'accepted', 'declined'] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];

export interface Proposal {
    id: number;

    /**
     * The draft as the create form's own QUERYSTRING - the very string a draft link used to
     * carry, stored opaquely. The console encodes it and the console decodes it, so this
     * server never has to know what a market's fields are, and a field added to the form
     * needs no migration here.
     */
    draft: string;

    /** Lowercased hex: the wallet that proposed it. */
    proposer: string;
    state: ProposalState;

    /** Why it was declined, as the owner wrote it. Empty otherwise. */
    note: string;
    createdAt: string;

    /** Empty while it is still pending. */
    decidedAt: string;
    decidedBy: string;
}

export interface ProposalInput {
    draft: string;

    /** The PROPOSER's wallet, which is not an admin - the server checks the allowlist. */
    address: string;

    /** ISO timestamp inside the signed message; the server rejects stale ones. */
    issuedAt: string;
    signature: string;
}

export interface ProposalDecideInput {
    id: number;

    /** True accepts it, false declines it. Accepting deploys nothing by itself. */
    accept: boolean;
    note: string;
    address: string;
    issuedAt: string;
    signature: string;
}

export interface ProposalResult {
    ok: boolean;
    state: ProposalState;
}

/**
 * The headline a draft carries, which is the part a wallet prompt can usefully show. Both
 * halves derive it from the draft STRING rather than passing it alongside, so the signature
 * cannot be collected for one question and spent on another.
 */
export function proposalTitle(draft: string): string
{
    return (new URLSearchParams(draft).get('title') ?? '').trim().slice(0, 80);
}

/** What a proposer signs. Binds the question, so a replay inside the timestamp window cannot
 *  swap the draft out from under it. */
export function proposalMessage(title: string, issuedAt: string): string
{
    return `Goman: propose "${ title }" at ${ issuedAt }`;
}

/** What the owner signs to accept or decline. The verdict is IN the message, so a signature
 *  collected to decline one cannot be replayed to accept it. */
export function proposalDecideMessage(id: number, accept: boolean, issuedAt: string): string
{
    return `Goman admin: ${ accept ? 'accept' : 'decline' } proposal #${ id } at ${ issuedAt }`;
}

/** The message a console signs to open an admin session; the timestamp makes it single-use. */
export function sessionMessage(issuedAt: string): string
{
    return `Goman admin: sign in at ${ issuedAt }`;
}

/**
 * Opening an admin session: the wallet signs `sessionMessage(issuedAt)` and the server
 * checks both the signature and the on-chain role before issuing the cookie. Reading the
 * console is a session-level act; the mutations below still demand a fresh signature.
 */
export interface SessionInput {
    address: string;

    /** ISO timestamp inside the signed message; the server rejects stale ones. */
    issuedAt: string;
    signature: string;
}

/**
 * The featured-flag toggle, authenticated by wallet signature: the admin signs
 * `featureMessage(...)` and the server verifies both the signature and the on-chain role.
 */
export interface FeatureInput {
    marketId: string;
    featured: boolean;
    address: string;

    /** ISO timestamp inside the signed message; the server rejects stale ones. */
    issuedAt: string;
    signature: string;
}

export interface FeatureResult {
    ok: boolean;
    featured: boolean;
}

/**
 * A market's scheduled opening. The contracts have no start time, so this is the whole of it:
 * the admin deploys the market PAUSED and posts the instant it should come off pause. What
 * enforces the wait is the pause itself; this only remembers when to lift it.
 *
 * `startsAt` empty CLEARS the schedule - a market opened by hand should not be re-opened by a
 * job hours later.
 */
export interface ScheduleInput {
    marketId: string;

    /** ISO instant, or empty to drop the schedule. */
    startsAt: string;
    address: string;

    /** ISO timestamp inside the signed message; the server rejects stale ones. */
    issuedAt: string;
    signature: string;
}

/** One outcome's wording. `icon` is an emoji or '', exactly as the create form writes it. */
export interface MarketEditOutcome {
    label: Localized;
    icon: string;
}

/**
 * A deployed market's editable text, both as it reads NOW and as the chain still holds it.
 *
 * The two halves are the whole point of the screen. A contract writes its title, rules, image,
 * category and outcome names once in `initialize` and has no setter for any of them, so an
 * edit here changes what the SITE shows and nothing the chain knows. An admin correcting a
 * live market has to be able to see what they are departing from.
 */
export interface MarketEditState {
    marketId: string;
    title: Localized;
    emoji: string;
    rules: Localized;
    image: string;
    category: string;

    /** The market's tags, as written. Editable here because the alternative is a permanent
     *  typo: the list is committed in the on-chain envelope and has no setter either. */
    tags: string[];
    outcomes: MarketEditOutcome[];

    /** The scheduled opening, editable alongside the text and equally off-chain. */
    startsAt: string | null;

    /** Read-only context: an edit cannot move either, they are on chain. */
    locksAt: string;
    resolvesAt: string;
    status: MarketStatusName;

    /** What the chain still says. Equal to the fields above until someone edits them. */
    origin: {
        title: Localized;
        emoji: string;
        rules: Localized;
        image: string;
        category: string;
        tags: string[];
        outcomes: MarketEditOutcome[];
    };
    editedAt: string | null;
    editedBy: string | null;
}

/**
 * A correction to a deployed market, signed like every other admin write.
 *
 * The whole text is submitted, not a sparse patch: the dialog opens with every field filled
 * in, so the full set is what it actually has - and the server keeps only the fields that
 * genuinely differ from the chain, which is what stops "edited" from meaning "opened once".
 */
export interface MarketEditInput {
    marketId: string;
    title: Localized;
    emoji: string;
    rules: Localized;
    image: string;
    category: string;
    tags: string[];
    outcomes: MarketEditOutcome[];
    address: string;

    /** ISO timestamp inside the signed message; the server rejects stale ones. */
    issuedAt: string;
    signature: string;
}

/** Dropping a correction and going back to the chain's own text. Signed separately. */
export interface MarketRevertInput {
    marketId: string;
    address: string;
    issuedAt: string;
    signature: string;
}

export interface MarketEditResult {
    ok: boolean;

    /** False when the submitted text matched the chain and the correction was dropped. */
    edited: boolean;
}

export function marketEditMessage(marketId: string, issuedAt: string): string
{
    return `Goman admin: edit market ${ marketId } at ${ issuedAt }`;
}

/** A DIFFERENT message from the edit one, for the same reason the category pair differ: a
 *  signature captured for an edit must not be replayable as a wipe of that edit. */
export function marketRevertMessage(marketId: string, issuedAt: string): string
{
    return `Goman admin: revert market ${ marketId } to its on-chain text at ${ issuedAt }`;
}

export function scheduleMessage(marketId: string, startsAt: string, issuedAt: string): string
{
    return `Goman admin: open market ${ marketId } at ${ startsAt === '' ? 'now' : startsAt } (signed ${ issuedAt })`;
}

/** The canonical message an admin signs to toggle a market's featured flag. */
export function featureMessage(marketId: string, featured: boolean, issuedAt: string): string
{
    return `Goman admin: set featured=${ featured ? 'true' : 'false' } for market ${ marketId } at ${ issuedAt }`;
}

// ----------------------------------------------------------------------------------------
// Referrals
//
// A referrer earns a share of the protocol fee that the trades of the people they brought in
// pay. Two tiers, no cap, no expiry: 75% of what a DIRECT referral's trades pay the treasury,
// 25% of what the people THEY referred pay.
//
// Those two add up to the WHOLE protocol fee, which is deliberate and is the program's real
// cost: a trade by someone who was referred, by someone who was themselves referred, leaves
// the treasury nothing. Only the unreferred half of the book funds it.
//
// "Protocol fee" is exact rather than rhetorical. A trade's whole fee is forwarded on-chain
// to the treasury (`FeeCollected`), and that receipt is what the index records against the
// trade and what these rates apply to - the rates are applied to money the platform actually
// received, never to a figure computed from the trade size.
// ----------------------------------------------------------------------------------------

/** A direct referral's share: 75% of the protocol fee their trades pay. */
export const REFERRAL_DIRECT_RATE = 0.75;

/** An indirect referral's share - the people your referrals referred. */
export const REFERRAL_INDIRECT_RATE = 0.25;

export const REFERRAL_TIERS = ['direct', 'indirect'] as const;
export type ReferralTier = (typeof REFERRAL_TIERS)[number];

/** One of a referrer's named links. Codes are unique across the whole program. */
export interface ReferralCampaign {
    code: string;
    name: string;

    /** ISO timestamp. Absolute - unlike the numbers below, which honour the window. */
    createdAt: string;

    /** Sign-ups through this code inside the selected period. */
    signups: number;

    /** Protocol fees those sign-ups paid inside the period, and the share of them earned. */
    fees: number;
    earnings: number;
}

/** One person a referrer brought in, directly or through one of their referrals. */
export interface ReferredUser {
    address: string;
    tier: ReferralTier;

    /** ISO timestamp of the join. Absolute; the trading numbers honour the window. */
    joinedAt: string;

    /** The campaign code they arrived through - empty for an indirect referral. */
    campaign: string;
    trades: number;
    volume: number;
    fees: number;
    earned: number;

    /** ISO timestamp of their most recent trade in the window, or null if they did not trade. */
    lastTradeAt: string | null;
}

/** The headline numbers, computed twice: once for all time and once inside the period. */
export interface ReferralStats {
    earnings: number;
    directEarnings: number;
    indirectEarnings: number;

    /** People who joined through one of this address's own codes. */
    signups: number;

    /** People THEY brought in - the second tier. */
    indirectSignups: number;

    /** Referred people who traded at least once in the window. */
    activeTraders: number;

    /** What the referred traded in the window, and the protocol fees it produced. */
    volume: number;
    fees: number;
}

/** Who referred the caller, if anybody. First touch wins and it is never reassigned. */
export interface ReferralOrigin {
    address: string;
    code: string;
    joinedAt: string;
}

export interface ReferralDashboard {
    address: string;
    period: Period;

    /** All time. `window` is the same shape inside the selected period. */
    total: ReferralStats;
    window: ReferralStats;
    campaigns: ReferralCampaign[];
    referred: ReferredUser[];
    referrer: ReferralOrigin | null;
}

export interface ReferralQuery {
    address: string;
    period?: Period;
}

/** A code looked up before joining, so an invitation names who sent it. */
export interface ReferralInvite {
    code: string;
    name: string;
    owner: string;
}

/**
 * Creating a campaign. Signed by its owner: a campaign is an earning account, so the server
 * has to know the address asking for one controls it.
 */
export interface CampaignInput {
    name: string;
    address: string;

    /** ISO timestamp inside the signed message; the server rejects stale ones. */
    issuedAt: string;
    signature: string;
}

export function campaignMessage(name: string, issuedAt: string): string
{
    return `Goman referrals: create campaign ${ name } at ${ issuedAt }`;
}

/**
 * Accepting an invitation. Also signed, and by the person being referred - without that,
 * anyone could post someone else's address against their own code and collect a share of a
 * stranger's fees. It is a deliberate act, so it asks for a deliberate signature.
 */
export interface JoinInput {
    code: string;
    address: string;

    /** ISO timestamp inside the signed message; the server rejects stale ones. */
    issuedAt: string;
    signature: string;
}

export function joinMessage(code: string, issuedAt: string): string
{
    return `Goman referrals: join with code ${ code } at ${ issuedAt }`;
}

// ----------------------------------------------------------------------------------------
// Schema
//
// One declaration per wire shape, in dependency order. `Infer<typeof x>` is the type each
// interface above is asserted against, so a schema that drifts from its interface fails the
// type gate rather than a request.
// ----------------------------------------------------------------------------------------

/** True only when A and B are the SAME type - optionality and nullability included. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Fails to compile unless its argument is `true`. Used once per schema, below. */
type Assert<T extends true> = T;

// ----------------------------------------------------------------------------------------
// Markets
// ----------------------------------------------------------------------------------------

// Written out rather than generated from CONTENT_LANGS: TypeBox infers `Static` from the
// literal, and a computed spread collapses it to an index signature, which defeats the
// `Assert<Equals<...>>` below - the one thing keeping this schema and `Localized` in step.
// `en` is the required floor; the rest are optional because a market carries only the
// translations someone actually wrote.
export const localized = object({
    en: string(),
    fa: string().optional(),
    ar: string().optional(),
    es: string().optional(),
    pt: string().optional(),
    hi: string().optional(),
    zh: string().optional(),
    ru: string().optional(),
    fr: string().optional(),
    tr: string().optional()
});

export const outcome = object({
    id: string(),
    index: number({int: true,  min: 0 }),
    label: localized,
    icon: string(),
    price: number({ min: 0, max: 1 }),
    change24h: number()
});

export const marketTag = object({
    slug: string(),
    name: string()
});

export const tagCount = object({
    slug: string(),
    name: string(),
    count: number({int: true,  min: 0 })
});

export const tagsQuery = object({
    q: string({ max: TAG_MAX_LENGTH }).optional(),
    limit: number({ coerce: true, int: true,  min: 1, max: 50 }).optional()
});

/** A written tag list on the way IN. The ceiling is the wire's, so a hand-rolled request
 *  cannot file one market under fifty subjects and drown every autocomplete. */
const tagList = array(string({ max: TAG_MAX_LENGTH }), { max: TAGS_PER_MARKET });

export const market = object({
    id: string(),
    address: string(),
    category: string(),
    emoji: string(),
    image: string(),
    title: localized,
    rules: localized,
    status: enumOf(MARKET_STATUSES),
    winningOutcomeId: string().nullable(),
    kind: enumOf(MARKET_KINDS),
    noIndex: number({int: true,  min: 0 }).nullable(),
    tags: array(marketTag),
    outcomes: array(outcome),
    volume: number({ min: 0 }),
    liquidity: number({ min: 0 }),
    endsAt: string(),
    startsAt: string().nullable(),
    createdAt: string(),
    featured: boolean(),
    trending: boolean()
});

export const marketsQuery = object({
    search: string().optional(),
    category: string().optional(),
    status: enumOf(MARKET_STATUSES).optional(),
    sort: enumOf(MARKET_SORTS).optional(),
    featured: boolean({ coerce: true }).optional(),
    trending: boolean({ coerce: true }).optional(),
    exclude: string().optional(),
    ids: string().optional(),
    tags: string().optional(),
    tagMode: enumOf(TAG_MODES).optional(),
    page: number({ coerce: true, int: true,  min: 1 }).optional(),
    limit: number({ coerce: true, int: true,  min: 1, max: 50 }).optional()
});

export const marketPage = object({
    rows: array(market),
    total: number({int: true,  min: 0 }),
    page: number({int: true,  min: 1 }),
    pages: number({int: true,  min: 1 })
});

export const marketParams = object({ id: string() });

// ----------------------------------------------------------------------------------------
// Categories and uploads
// ----------------------------------------------------------------------------------------

export const categoryCount = object({
    id: string(),
    count: number({int: true,  min: 0 }),
    label: localized,
    retired: boolean()
});

export const categoryInput = object({
    id: string(),
    label: localized,
    sortOrder: number({ int: true }),
    retired: boolean(),
    address: string(),
    issuedAt: string(),
    signature: string()
});

export const categoryDeleteInput = object({
    id: string(),
    address: string(),
    issuedAt: string(),
    signature: string()
});

export const uploadFields = object({
    address: string(),
    issuedAt: string(),
    signature: string()
});

export const uploadResult = object({
    uri: string(),
    type: string(),
    bytes: number({int: true,  min: 1 })
});

// ----------------------------------------------------------------------------------------
// Series, activity, holders
// ----------------------------------------------------------------------------------------

export const seriesQuery = object({ outcome: string(), range: enumOf(RANGES) });
export const seriesPoint = object({ t: number(), p: number({ min: 0, max: 1 }) });
export const series = object({ points: array(seriesPoint) });

export const activityItem = object({
    id: string(),
    marketId: string(),
    marketSlug: string(),
    user: string(),
    action: enumOf(TRADE_ACTIONS),
    outcomeId: string(),
    side: enumOf(SIDES),
    shares: number({ min: 0 }),
    price: number({ min: 0 }),
    at: string()
});

export const activityQuery = object({
    page: number({ coerce: true, int: true,  min: 1 }).optional(),
    limit: number({ coerce: true, int: true,  min: 1, max: 50 }).optional()
});

export const activityPage = object({
    rows: array(activityItem),
    total: number({int: true,  min: 0 }),
    page: number({int: true,  min: 1 }),
    pages: number({int: true,  min: 1 })
});

export const holder = object({
    user: string(),
    outcomeId: string(),
    side: enumOf(SIDES),
    shares: number({ min: 0 })
});

export const holderPage = object({
    rows: array(holder),
    total: number({int: true,  min: 0 }),
    page: number({int: true,  min: 1 }),
    pages: number({int: true,  min: 1 })
});

// ----------------------------------------------------------------------------------------
// Portfolio and leaderboard
// ----------------------------------------------------------------------------------------

export const addressQuery = object({ address: string() });

export const position = object({
    id: string(),
    marketId: string(),
    outcomeId: string(),
    side: enumOf(SIDES),
    shares: number({ min: 0 }),
    avgPrice: number({ min: 0 }),
    openedAt: string(),
    claimable: boolean(),
    market
});

export const portfolioSummary = object({
    balance: number({ min: 0 }),
    invested: number({ min: 0 }),
    current: number({ min: 0 }),
    profit: number(),
    profitToday: number()
});

export const profitSeries = object({ points: array(object({ t: number(), p: number() })) });
export const profitSeriesQuery = object({ period: enumOf(PERIODS), address: string() });

export const leaderboardQuery = object({ period: enumOf(PERIODS) });
export const leaderboardRow = object({
    rank: number({int: true,  min: 1 }),
    address: string(),
    profit: number(),
    volume: number({ min: 0 })
});

// ----------------------------------------------------------------------------------------
// Chain config and admin
// ----------------------------------------------------------------------------------------

export const chainConfig = object({
    chainId: number({ int: true }),
    factory: string(),
    treasury: string(),
    deployBlock: number({int: true,  min: 0 }),
    lastBlock: number({int: true,  min: 0 })
});

export const adminStats = object({
    markets: number({int: true,  min: 0 }),
    open: number({int: true,  min: 0 }),
    paused: number({int: true,  min: 0 }),
    closed: number({int: true,  min: 0 }),
    resolved: number({int: true,  min: 0 }),
    voided: number({int: true,  min: 0 }),
    volume: number({ min: 0 }),
    volume24h: number({ min: 0 }),
    traders: number({int: true,  min: 0 }),
    feesCollected: number({ min: 0 }),
    tvl: number({ min: 0 })
});

export const adminMarketRow = object({
    id: string(),
    address: string(),
    title: localized,
    emoji: string(),
    category: string(),
    status: enumOf(MARKET_STATUSES),
    kind: enumOf(MARKET_KINDS),
    winningOutcomeId: string().nullable(),
    outcomeCount: number({int: true,  min: 2 }),
    createdAt: string(),
    startsAt: string().nullable(),
    locksAt: string(),
    resolvesAt: string(),
    liquidity: number({ min: 0 }),
    volume: number({ min: 0 }),
    collected: number({ min: 0 }),
    featured: boolean(),
    edited: boolean()
});

export const adminMarketPage = object({
    rows: array(adminMarketRow),
    total: number({int: true,  min: 0 }),
    page: number({int: true,  min: 1 }),
    pages: number({int: true,  min: 1 })
});

export const telegramSettings = object({
    backupMinutes: number({int: true,  min: 1, max: 10080 }),
    events: boolean()
});

/** Hex, 40 nibbles. Enforced at the edge because the allowlist compares strings: anything
 *  else shaped like an address would be stored and then never match a real wallet. */
const WALLET = string({ pattern: /^0x[0-9a-fA-F]{40}$/ });

export const marketCreator = object({
    address: string(),
    label: string(),
    addedBy: string(),
    addedAt: string()
});

export const marketCreatorInput = object({
    wallet: WALLET,
    label: string({ max: 64 }),
    address: string(),
    issuedAt: string(),
    signature: string()
});

export const marketCreatorRemoveInput = object({
    wallet: WALLET,
    address: string(),
    issuedAt: string(),
    signature: string()
});

export const creatorParams = object({ address: WALLET });

export const creatorAccess = object({ allowed: boolean() });

export const proposal = object({
    id: number({ int: true }),
    draft: string(),
    proposer: string(),
    state: enumOf(PROPOSAL_STATES),
    note: string(),
    createdAt: string(),
    decidedAt: string(),
    decidedBy: string()
});

/** A draft is a querystring, not a document. The form caps one field at 600 characters and a
 *  full market in ten languages lands an order of magnitude under this - so the ceiling only
 *  ever catches something that is not a draft at all. */
export const proposalInput = object({
    draft: string({ min: 1, max: 8000 }),
    address: WALLET,
    issuedAt: string(),
    signature: string()
});

export const proposalDecideInput = object({
    id: number({int: true,  min: 1 }),
    accept: boolean(),
    note: string({ max: 300 }),
    address: string(),
    issuedAt: string(),
    signature: string()
});

export const proposalResult = object({ ok: boolean(), state: enumOf(PROPOSAL_STATES) });

export const proposalsQuery = object({ address: WALLET });

export const telegramState = object({
    settings: telegramSettings,
    configured: boolean(),
    botName: string()
});

export const telegramSettingsInput = object({
    backupMinutes: number({int: true,  min: 1, max: 10080 }),
    events: boolean(),
    address: string(),
    issuedAt: string(),
    signature: string()
});

export const sessionInput = object({
    address: string(),
    issuedAt: string(),
    signature: string()
});

export const featureInput = object({
    marketId: string(),
    featured: boolean(),
    address: string(),
    issuedAt: string(),
    signature: string()
});

export const featureResult = object({ ok: boolean(), featured: boolean() });

export const marketEditOutcome = object({ label: localized, icon: string() });

export const marketEditState = object({
    marketId: string(),
    title: localized,
    emoji: string(),
    rules: localized,
    image: string(),
    category: string(),
    tags: array(string()),
    outcomes: array(marketEditOutcome),
    startsAt: string().nullable(),
    locksAt: string(),
    resolvesAt: string(),
    status: enumOf(MARKET_STATUSES),
    origin: object({
        title: localized,
        emoji: string(),
        rules: localized,
        image: string(),
        category: string(),
        tags: array(string()),
        outcomes: array(marketEditOutcome)
    }),
    editedAt: string().nullable(),
    editedBy: string().nullable()
});

// The bounds are the create form's, deliberately: a market that could not have been deployed
// with this text must not be editable into it either.
export const marketEditInput = object({
    marketId: string(),
    title: localized,
    emoji: string({ max: 8 }),
    rules: localized,
    image: string({ max: 500 }),
    category: string({ min: 1, max: 40 }),
    tags: tagList,
    outcomes: array(marketEditOutcome, { min: 2, max: 16 }),
    address: string(),
    issuedAt: string(),
    signature: string()
});

export const marketRevertInput = object({
    marketId: string(),
    address: string(),
    issuedAt: string(),
    signature: string()
});

export const marketEditResult = object({ ok: boolean(), edited: boolean() });

// ----------------------------------------------------------------------------------------
// Referrals
// ----------------------------------------------------------------------------------------

export const referralQuery = object({
    address: string(),
    period: enumOf(PERIODS).optional()
});

export const referralStats = object({
    earnings: number(),
    directEarnings: number(),
    indirectEarnings: number(),
    signups: number({int: true,  min: 0 }),
    indirectSignups: number({int: true,  min: 0 }),
    activeTraders: number({int: true,  min: 0 }),
    volume: number({ min: 0 }),
    fees: number({ min: 0 })
});

export const referralCampaign = object({
    code: string(),
    name: string(),
    createdAt: string(),
    signups: number({int: true,  min: 0 }),
    fees: number({ min: 0 }),
    earnings: number({ min: 0 })
});

export const referredUser = object({
    address: string(),
    tier: enumOf(REFERRAL_TIERS),
    joinedAt: string(),
    campaign: string(),
    trades: number({int: true,  min: 0 }),
    volume: number({ min: 0 }),
    fees: number({ min: 0 }),
    earned: number({ min: 0 }),
    lastTradeAt: string().nullable()
});

export const referralOrigin = object({
    address: string(),
    code: string(),
    joinedAt: string()
});

export const referralDashboard = object({
    address: string(),
    period: enumOf(PERIODS),
    total: referralStats,
    window: referralStats,
    campaigns: array(referralCampaign),
    referred: array(referredUser),
    referrer: referralOrigin.nullable()
});

export const referralInvite = object({
    code: string(),
    name: string(),
    owner: string()
});

export const campaignInput = object({
    name: string({ min: 1, max: 40 }),
    address: string(),
    issuedAt: string(),
    signature: string()
});

export const joinInput = object({
    code: string({ min: 1, max: 32 }),
    address: string(),
    issuedAt: string(),
    signature: string()
});

export const scheduleInput = object({
    marketId: string(),
    startsAt: string(),
    address: string(),
    issuedAt: string(),
    signature: string()
});

// Re-exported so the rest of the server imports one module, as it did before the split.

type _MarketTag = Assert<Equals<Infer<typeof marketTag>, MarketTag>>;
type _TagCount = Assert<Equals<Infer<typeof tagCount>, TagCount>>;
type _TagsQuery = Assert<Equals<Infer<typeof tagsQuery>, TagsQuery>>;
type _Localized = Assert<Equals<Infer<typeof localized>, Localized>>;
type _Outcome = Assert<Equals<Infer<typeof outcome>, Outcome>>;
type _Market = Assert<Equals<Infer<typeof market>, Market>>;
type _MarketsQuery = Assert<Equals<Infer<typeof marketsQuery>, MarketsQuery>>;
type _MarketPage = Assert<Equals<Infer<typeof marketPage>, MarketPage>>;
type _CategoryCount = Assert<Equals<Infer<typeof categoryCount>, CategoryCount>>;
type _CategoryInput = Assert<Equals<Infer<typeof categoryInput>, CategoryInput>>;
type _CategoryDeleteInput = Assert<Equals<Infer<typeof categoryDeleteInput>, CategoryDeleteInput>>;
type _UploadFields = Assert<Equals<Infer<typeof uploadFields>, UploadFields>>;
type _UploadResult = Assert<Equals<Infer<typeof uploadResult>, UploadResult>>;
type _SeriesQuery = Assert<Equals<Infer<typeof seriesQuery>, SeriesQuery>>;
type _SeriesPoint = Assert<Equals<Infer<typeof seriesPoint>, SeriesPoint>>;
type _Series = Assert<Equals<Infer<typeof series>, Series>>;
type _ActivityItem = Assert<Equals<Infer<typeof activityItem>, ActivityItem>>;
type _ActivityQuery = Assert<Equals<Infer<typeof activityQuery>, ActivityQuery>>;
type _ActivityPage = Assert<Equals<Infer<typeof activityPage>, ActivityPage>>;
type _Holder = Assert<Equals<Infer<typeof holder>, Holder>>;
type _HolderPage = Assert<Equals<Infer<typeof holderPage>, HolderPage>>;
type _AddressQuery = Assert<Equals<Infer<typeof addressQuery>, AddressQuery>>;
type _Position = Assert<Equals<Infer<typeof position>, Position>>;
type _PortfolioSummary = Assert<Equals<Infer<typeof portfolioSummary>, PortfolioSummary>>;
type _ProfitSeries = Assert<Equals<Infer<typeof profitSeries>, ProfitSeries>>;
type _ProfitSeriesQuery = Assert<Equals<Infer<typeof profitSeriesQuery>, ProfitSeriesQuery>>;
type _LeaderboardQuery = Assert<Equals<Infer<typeof leaderboardQuery>, LeaderboardQuery>>;
type _LeaderboardRow = Assert<Equals<Infer<typeof leaderboardRow>, LeaderboardRow>>;
type _ChainConfig = Assert<Equals<Infer<typeof chainConfig>, ChainConfig>>;
type _AdminStats = Assert<Equals<Infer<typeof adminStats>, AdminStats>>;
type _AdminMarketRow = Assert<Equals<Infer<typeof adminMarketRow>, AdminMarketRow>>;
type _AdminMarketPage = Assert<Equals<Infer<typeof adminMarketPage>, AdminMarketPage>>;
type _TelegramSettings = Assert<Equals<Infer<typeof telegramSettings>, TelegramSettings>>;
type _MarketCreator = Assert<Equals<Infer<typeof marketCreator>, MarketCreator>>;
type _MarketCreatorInput = Assert<Equals<Infer<typeof marketCreatorInput>, MarketCreatorInput>>;
type _MarketCreatorRemoveInput = Assert<Equals<Infer<typeof marketCreatorRemoveInput>, MarketCreatorRemoveInput>>;
type _CreatorAccess = Assert<Equals<Infer<typeof creatorAccess>, CreatorAccess>>;
type _Proposal = Assert<Equals<Infer<typeof proposal>, Proposal>>;
type _ProposalInput = Assert<Equals<Infer<typeof proposalInput>, ProposalInput>>;
type _ProposalDecideInput = Assert<Equals<Infer<typeof proposalDecideInput>, ProposalDecideInput>>;
type _ProposalResult = Assert<Equals<Infer<typeof proposalResult>, ProposalResult>>;
type _TelegramState = Assert<Equals<Infer<typeof telegramState>, TelegramState>>;
type _TelegramSettingsInput = Assert<Equals<Infer<typeof telegramSettingsInput>, TelegramSettingsInput>>;
type _SessionInput = Assert<Equals<Infer<typeof sessionInput>, SessionInput>>;
type _FeatureInput = Assert<Equals<Infer<typeof featureInput>, FeatureInput>>;
type _FeatureResult = Assert<Equals<Infer<typeof featureResult>, FeatureResult>>;
type _MarketEditOutcome = Assert<Equals<Infer<typeof marketEditOutcome>, MarketEditOutcome>>;
type _MarketEditState = Assert<Equals<Infer<typeof marketEditState>, MarketEditState>>;
type _MarketEditInput = Assert<Equals<Infer<typeof marketEditInput>, MarketEditInput>>;
type _MarketRevertInput = Assert<Equals<Infer<typeof marketRevertInput>, MarketRevertInput>>;
type _MarketEditResult = Assert<Equals<Infer<typeof marketEditResult>, MarketEditResult>>;
type _ScheduleInput = Assert<Equals<Infer<typeof scheduleInput>, ScheduleInput>>;
type _ReferralQuery = Assert<Equals<Infer<typeof referralQuery>, ReferralQuery>>;
type _ReferralStats = Assert<Equals<Infer<typeof referralStats>, ReferralStats>>;
type _ReferralCampaign = Assert<Equals<Infer<typeof referralCampaign>, ReferralCampaign>>;
type _ReferredUser = Assert<Equals<Infer<typeof referredUser>, ReferredUser>>;
type _ReferralOrigin = Assert<Equals<Infer<typeof referralOrigin>, ReferralOrigin>>;
type _ReferralDashboard = Assert<Equals<Infer<typeof referralDashboard>, ReferralDashboard>>;
type _ReferralInvite = Assert<Equals<Infer<typeof referralInvite>, ReferralInvite>>;
type _CampaignInput = Assert<Equals<Infer<typeof campaignInput>, CampaignInput>>;
type _JoinInput = Assert<Equals<Infer<typeof joinInput>, JoinInput>>;
