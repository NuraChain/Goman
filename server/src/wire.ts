// THE wire vocabulary: every shape that crosses between the server and the browser, plus the
// on-chain metadata codec both halves share. CLIENT-SAFE BY CONSTRUCTION - this module imports
// nothing at all, so the application can import it without dragging a validator, a server
// dependency, or a byte of Node into the browser bundle.
//
// Runtime validation lives next door in schemas.ts (TypeBox, server-only). That file asserts at
// compile time that each schema's inferred type equals the interface declared here, so the two
// cannot drift - the property the framework's inferred client used to give for free.
//
// Every value is REAL: the server derives it from chain state, never from seeded fiction.

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

/** A decoded market title: every language it was written in, plus the card emoji. */
export type TitleMeta = Localized & { emoji: string };

/**
 * A Localized reduced to the languages actually written in it. Two jobs: it drops empty
 * translations so neither the chain nor the index pays for them, and it strips a TitleMeta's
 * `emoji` back out - the emoji is a column and an envelope key of its own, never a language.
 */
export function localizedOf(meta: Localized): Localized {
    const out: Localized = { en: meta.en };
    for (const code of CONTENT_LANGS) {
        const value = meta[code];
        if (code !== 'en' && typeof value === 'string' && value !== '') {
            out[code] = value;
        }
    }
    return out;
}

/** Encodes a translated title + emoji into the on-chain string. */
export function encodeTitleMeta(meta: TitleMeta): string {
    return JSON.stringify({ v: 1, ...localizedOf(meta), emoji: meta.emoji });
}

/** Encodes translated body text (description/rules, an outcome name) into the on-chain string. */
export function encodeTextMeta(meta: Localized & { icon?: string }): string {
    return JSON.stringify({
        v: 1,
        ...localizedOf(meta),
        ...(meta.icon === undefined || meta.icon === '' ? {} : { icon: meta.icon })
    });
}

/** Reads every language the envelope carries. `en` falls back to the raw (plain) string. */
function readText(envelope: Record<string, unknown> | null, raw: string): Localized {
    const out: Localized = { en: typeof envelope?.en === 'string' && envelope.en !== '' ? envelope.en : raw };
    for (const code of CONTENT_LANGS) {
        const value = envelope?.[code];
        if (code !== 'en' && typeof value === 'string' && value !== '') {
            out[code] = value;
        }
    }
    return out;
}

function parseEnvelope(raw: string): Record<string, unknown> | null {
    if (!raw.startsWith('{')) {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null && (parsed as { v?: unknown }).v === 1
            ? (parsed as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

/** Decodes an on-chain title string; a plain string falls back to itself + `fallbackEmoji`. */
export function decodeTitleMeta(raw: string, fallbackEmoji: string): TitleMeta {
    const envelope = parseEnvelope(raw);
    const emoji = typeof envelope?.emoji === 'string' && envelope.emoji !== '' ? envelope.emoji : fallbackEmoji;
    return { ...readText(envelope, raw), emoji };
}

/**
 * An outcome's decoded name. `icon` rides the SAME envelope the labels do, so outcome art
 * needed no contract change: an older market simply carries no icon key.
 */
export function decodeOutcomeMeta(raw: string): Localized & { icon: string } {
    const envelope = parseEnvelope(raw);
    const label = decodeTextMeta(raw);
    return { ...label, icon: typeof envelope?.icon === 'string' ? envelope.icon : '' };
}

/** Decodes an on-chain body string (description/rules); a plain string becomes its English. */
export function decodeTextMeta(raw: string): Localized {
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

export function categoryMessage(id: string, issuedAt: string): string {
    return `Goman admin: update category ${id} at ${issuedAt}`;
}

/** A DIFFERENT message from the update one on purpose: a signature captured for an edit must
 *  not be replayable as a delete. */
export function categoryDeleteMessage(id: string, issuedAt: string): string {
    return `Goman admin: delete category ${id} at ${issuedAt}`;
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

export function uploadMessage(issuedAt: string): string {
    return `Goman admin: upload image at ${issuedAt}`;
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
// The Telegram bot: its settings, who may command it, and what they propose.
//
// The bot is reachable by anyone who finds it, so the shapes here draw one line twice. A
// PROPOSAL is text a stranger-ish account typed and carries no authority at all; approving one
// only seeds the create form, and the market is still deployed by an admin's own wallet. The
// ALLOWLIST is the authority, and it is keyed on the numeric Telegram id rather than the
// @username, because a username can be released and re-registered by somebody else.

/** Where a proposal stands. Nothing leaves 'pending' twice - the first decision wins. */
export const PROPOSAL_STATES = ['pending', 'approved', 'rejected'] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];

/** One seat on the bot's allowlist. */
export interface TelegramAdmin {
    /** The numeric Telegram user id, as a string - it exceeds what a float holds exactly. */
    id: string;

    /** The @name without its @, or '' for an account that has none. Display only. */
    username: string;

    /** The console admin who granted the seat, and when. */
    addedBy: string;
    addedAt: string;
}

/** The bot's runtime settings, the ones the console owns rather than the environment. */
export interface TelegramSettings {
    /** Minutes between database backups. */
    backupMinutes: number;

    /** Off silences the per-event feed and keeps the backups. */
    events: boolean;
}

/** Settings, the allowlist, and whether a bot is configured at all - one read for the tab. */
export interface TelegramState {
    settings: TelegramSettings;
    admins: TelegramAdmin[];

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

export interface TelegramAdminInput {
    id: string;
    username: string;
    address: string;
    issuedAt: string;
    signature: string;
}

export interface TelegramAdminRemoveInput {
    id: string;
    address: string;
    issuedAt: string;
    signature: string;
}

/** One market somebody proposed over the bot. Every string is as they typed it. */
export interface Proposal {
    id: number;

    /** Who sent it. The id is the identity; the username is what to show. */
    from: string;
    username: string;
    question: string;
    description: string;

    /** The answers they gave, or [] when they took the default Yes/No. */
    outcomes: string[];

    /** When they said trading should close, as an ISO instant, or '' when they skipped it. */
    closesAt: string;

    /** The registry category they named, or '' - a free string, checked by the admin. */
    category: string;
    state: ProposalState;

    /** Why it was rejected, when the admin said so. */
    note: string;
    createdAt: string;
    decidedAt: string;
    decidedBy: string;
}

export interface ProposalPage {
    rows: Proposal[];
    total: number;
    page: number;
    pages: number;

    /** How many are still pending, across every page - the number the tab badges. */
    pending: number;
}

export interface ProposalQuery {
    state?: ProposalState;
    page?: number;
    limit?: number;
}

export interface ProposalDecideInput {
    id: number;
    approve: boolean;

    /** Sent on to the proposer when it is a rejection; ignored otherwise. */
    note?: string;
    address: string;
    issuedAt: string;
    signature: string;
}

export interface ProposalResult {
    ok: boolean;
    state: ProposalState;
}

/** The message a console signs to change the bot's settings. */
export function telegramSettingsMessage(backupMinutes: number, events: boolean, issuedAt: string): string {
    return `Goman admin: set telegram backup=${backupMinutes}m events=${events ? 'on' : 'off'} at ${issuedAt}`;
}

/** Granting a seat on the allowlist. The id is in the message, so a signature captured for
 *  one account cannot be replayed to admit another. */
export function telegramAdminMessage(id: string, issuedAt: string): string {
    return `Goman admin: allow telegram ${id} to command the bot at ${issuedAt}`;
}

/** A DIFFERENT message from the grant, for the reason the category pair differ: a signature
 *  captured to add a seat must not be replayable as the removal of one. */
export function telegramAdminRemoveMessage(id: string, issuedAt: string): string {
    return `Goman admin: revoke telegram ${id} at ${issuedAt}`;
}

/** Deciding a proposal. The verdict is IN the message: a signature collected to approve one
 *  must not be replayable as a rejection of it. */
export function proposalDecideMessage(id: number, approve: boolean, issuedAt: string): string {
    return `Goman admin: ${approve ? 'approve' : 'reject'} proposal ${id} at ${issuedAt}`;
}

/** The message a console signs to open an admin session; the timestamp makes it single-use. */
export function sessionMessage(issuedAt: string): string {
    return `Goman admin: sign in at ${issuedAt}`;
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

export function marketEditMessage(marketId: string, issuedAt: string): string {
    return `Goman admin: edit market ${marketId} at ${issuedAt}`;
}

/** A DIFFERENT message from the edit one, for the same reason the category pair differ: a
 *  signature captured for an edit must not be replayable as a wipe of that edit. */
export function marketRevertMessage(marketId: string, issuedAt: string): string {
    return `Goman admin: revert market ${marketId} to its on-chain text at ${issuedAt}`;
}

export function scheduleMessage(marketId: string, startsAt: string, issuedAt: string): string {
    return `Goman admin: open market ${marketId} at ${startsAt === '' ? 'now' : startsAt} (signed ${issuedAt})`;
}

/** The canonical message an admin signs to toggle a market's featured flag. */
export function featureMessage(marketId: string, featured: boolean, issuedAt: string): string {
    return `Goman admin: set featured=${featured ? 'true' : 'false'} for market ${marketId} at ${issuedAt}`;
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
// "Protocol fee" is exact rather than rhetorical. A trade's fee splits on-chain between the
// market's liquidity providers and the protocol, and only the protocol's half reaches the
// treasury (`FeeCollected`). That receipt is what the index records against the trade and
// what these rates apply to - paying out a share of the gross fee would be paying out of
// money the platform never received.
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

export function campaignMessage(name: string, issuedAt: string): string {
    return `Goman referrals: create campaign ${name} at ${issuedAt}`;
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

export function joinMessage(code: string, issuedAt: string): string {
    return `Goman referrals: join with code ${code} at ${issuedAt}`;
}

// ----------------------------------------------------------------------------------------
// Price rounds
//
// A round is an ordinary parimutuel market the server deploys on a fixed cadence, so nothing
// below describes a second kind of market - it describes the SCHEDULE the engine runs and the
// two TWAP observations that decide the answer. The market itself is read through /api/markets
// like any other, which is why `Round` carries an id rather than a copy of the market.
// ----------------------------------------------------------------------------------------

/**
 * The category every engine-created round carries. It is an ordinary on-chain category string,
 * but the feed hides it: 144 rounds a day would bury the curated markets, and the /live page is
 * their whole surface. Nothing but the engine may write it.
 */
export const ROUNDS_CATEGORY = 'live-btc';

/** The two legs, in on-chain outcome order. Index 0 is UP; the engine never varies this. */
export const ROUND_SIDES = ['up', 'down'] as const;
export type RoundSide = (typeof ROUND_SIDES)[number];

/**
 * Where a round is in its life. `pending` exists because the schedule is authoritative BEFORE
 * the chain is: the row is written when the slot is claimed, and a deploy that fails leaves a
 * `failed` row rather than a hole nobody can explain.
 */
export const ROUND_STATES = ['pending', 'open', 'locked', 'settled', 'voided', 'failed'] as const;
export type RoundState = (typeof ROUND_STATES)[number];

/** One TWAP observation, and where it came from. */
export interface TwapPrice {
    /** Lowercase, slash-delimited, as both sources spell it: `btc/usd`. */
    symbol: string;
    value: number;

    /** The averaging window in seconds - 60 for the stream this engine reads. */
    windowSeconds: number;

    /** The SOURCE's own timestamp for the observation, not when this server saw it. */
    at: string;

    /** `chainlink-data-streams` (DON-signed) or `polymarket-rtds` (the relay). */
    source: string;
}

/**
 * One Up/Down round. Bets are taken from `opensAt` until `locksAt`; the answer is the move of
 * the TWAP between `locksAt` and `closesAt`. Nobody can bet on a move they have already seen,
 * which is the whole reason the two windows do not overlap.
 */
export interface Round {
    /** The slot's start in unix seconds, aligned to the interval. The round's identity. */
    epoch: number;
    state: RoundState;

    /** The deployed market, once there is one. Null while pending, and after a failed deploy. */
    marketId: string | null;
    address: string | null;
    opensAt: string;
    locksAt: string;
    closesAt: string;

    /** The TWAP at lock, and at close. Null until each observation is taken. */
    lockPrice: number | null;
    closePrice: number | null;

    /** Which source each observation came from, for the settlement receipt. */
    priceSource: string | null;

    /** Native collateral staked on each leg, in ether units. */
    upPool: number;
    downPool: number;

    /** Null until settled; a flat close voids the round instead of picking a side. */
    winner: RoundSide | null;

    /** The settling transaction, so a reader can check the answer on the explorer. */
    settleTx: string | null;
}

/** Everything the /live page needs in one read. */
export interface RoundsSnapshot {
    /** Null while the price source is still connecting - the page says so rather than lying. */
    price: TwapPrice | null;

    /** The cadence in seconds. The betting window and the measured window are each this long. */
    intervalSeconds: number;

    /** True when the engine has a signer and is actually running. */
    running: boolean;

    /** The round taking bets, and the one whose measured window is running. Either may be null. */
    live: Round | null;
    locked: Round | null;

    /** Most recently settled first. */
    history: Round[];
}

export interface RoundsQuery {
    /** How many settled rounds to return with the snapshot. */
    history?: number;
}
