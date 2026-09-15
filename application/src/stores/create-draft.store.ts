import { createStore, createSignal, type Getter } from '../lib/reactive.ts';

import { CONTENT_LANGS, localizedOf, type ContentLang, type Localized, type MarketKindName } from '../api.ts';

// The half-written market. It lives in a store rather than in the form component because the
// form is now one section of the admin console: switching to Categories to register a name
// and coming back used to wipe every field, including a question already typed out.

/**
 * A draft's text in EVERY content language, empty where nothing has been written. The wire's
 * `Localized` omits the languages it does not have; a form field cannot - a controlled input
 * needs a string, and an absent key would make it uncontrolled halfway through typing.
 * `trimText` drops the empties again on the way to the chain.
 */
export type TextDraft = Record<ContentLang, string>;

export function emptyText(): TextDraft {
    return Object.fromEntries(CONTENT_LANGS.map((code) => [code, ''])) as TextDraft;
}

/** A draft field with some languages filled in - what a seed and the default answers build on. */
export function textOf(values: Partial<Record<ContentLang, string>>): TextDraft {
    return { ...emptyText(), ...values };
}

/** Trimmed, with every unwritten language dropped: the shape the envelope encoders take. */
export function trimText(text: TextDraft): Localized {
    const trimmed = emptyText();
    for (const code of CONTENT_LANGS) {
        trimmed[code] = text[code].trim();
    }
    return localizedOf(trimmed);
}

/** True once ANY language of this field has been written in. */
export function hasText(text: TextDraft): boolean {
    return CONTENT_LANGS.some((code) => text[code].trim() !== '');
}

export interface OutcomeDraft {
    id: number;

    /** The answer's name per language. English is the one a deploy refuses to go without. */
    labels: TextDraft;

    /** Outcome art. Rides the on-chain name envelope, so it needs no contract change. */
    icon: string;
}

/** Where a draft's wording came from, so the form can say so and link back to it. */
export interface DraftSource {
    venue: string;
    url: string;
}

/** The usual gap between trading stopping and resolution opening. Per-market, not a law. */
export const RESOLVE_HOURS_DEFAULT = '24';

/** The two answers a proposer spells the same way in every language; anything else is the
 *  admin's to translate, so it is seeded in English alone. */
const FA_ANSWERS: Record<string, string> = { yes: 'بله', no: 'خیر' };

/** What a market suggested over the bot becomes as a draft here. Every translation is still
 *  the admin's to write - the proposer typed one language, and seeding the rest with it would
 *  look like a translation nobody made. */
export interface DraftSeed {
    title: TextDraft;
    description: TextDraft;
    category: string;
    outcomes: Array<{ labels: TextDraft; icon: string }>;
    startAt: string;
    lockAt: string;
    source: DraftSource;
}

/** An instant as `<input type="datetime-local">` spells it: local wall clock, to the minute, no zone. */
export function toLocalInput(ms: number): string {
    const at = new Date(ms);
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/**
 * One suggestion as a draft. A closing time already in the past seeds NO timing at all: the
 * timing step then says so, rather than a deploy failing on a lock time that has been and gone
 * while the suggestion sat in the queue.
 */
export function draftFromProposal(
    row: { id: number; question: string; description: string; outcomes: string[]; closesAt: string; category: string },
    now: number,
    siteUrl = ''
): DraftSeed {
    const closes = row.closesAt === '' ? Number.NaN : new Date(row.closesAt).getTime();
    const ahead = Number.isFinite(closes) && closes > now;
    const answers = row.outcomes.length >= 2 ? row.outcomes : ['Yes', 'No'];

    return {
        title: textOf({ en: row.question.trim() }),
        description: textOf({ en: row.description.trim() }),
        category: row.category,
        outcomes: answers.map((label) => ({
            labels: textOf({ en: label.trim(), fa: FA_ANSWERS[label.trim().toLowerCase()] ?? '' }),
            icon: ''
        })),
        // A suggestion says nothing about when trading OPENS, so a seeded draft opens at once.
        startAt: '',
        lockAt: ahead ? toLocalInput(closes) : '',
        source: { venue: `Telegram #${row.id}`, url: siteUrl }
    };
}

export interface CreateDraftApi {
    title: Getter<TextDraft>;
    description: Getter<TextDraft>;
    emoji: Getter<string>;
    category: Getter<string>;

    /** What to CALL a category this market is about to mint, per language. Unused when the
     *  category already exists: its names are the registry's, not this market's. */
    categoryLabel: Getter<TextDraft>;
    imageURI: Getter<string>;
    outcomes: Getter<OutcomeDraft[]>;
    startAt: Getter<string>;
    lockAt: Getter<string>;

    /** Hours between the stop time and resolution opening. A duration, not a date. */
    resolveHours: Getter<string>;

    /** Which engine to deploy: a CPMM market, or a parimutuel pool. */
    kind: Getter<MarketKindName>;
    liquidity: Getter<string>;
    feeBps: Getter<string>;
    protocolShareBps: Getter<string>;

    /** Where the wording came from, or null when it was written here. Cleared by `reset`. */
    source: Getter<DraftSource | null>;

    setTitle(lang: ContentLang, next: string): void;
    setDescription(lang: ContentLang, next: string): void;
    setEmoji(next: string): void;
    setCategory(next: string): void;
    setCategoryLabel(lang: ContentLang, next: string): void;
    setImageURI(next: string): void;
    setStartAt(next: string): void;
    setLockAt(next: string): void;
    setResolveHours(next: string): void;
    setKind(next: MarketKindName): void;
    setLiquidity(next: string): void;
    setFeeBps(next: string): void;
    setProtocolShareBps(next: string): void;

    setOutcomeLabel(id: number, lang: ContentLang, next: string): void;
    setOutcomeIcon(id: number, next: string): void;
    addOutcome(): void;
    removeOutcome(id: number): void;

    /**
     * Replaces the wording, answers and timing with a suggestion from the bot. Liquidity and
     * fees are untouched: they are this platform's numbers, not the proposer's.
     */
    importProposal(row: {
        id: number;
        question: string;
        description: string;
        outcomes: string[];
        closesAt: string;
        category: string;
    }): void;

    /** Clears every field. Called once a deploy has LANDED, never on a failure. */
    reset(): void;
}

const START = (): OutcomeDraft[] => [
    { id: 1, labels: textOf({ en: 'Yes', fa: 'بله' }), icon: '' },
    { id: 2, labels: textOf({ en: 'No', fa: 'خیر' }), icon: '' }
];

export const useCreateDraft = createStore((): CreateDraftApi => {
    const [title, setTitleAll] = createSignal<TextDraft>(emptyText());
    const [description, setDescriptionAll] = createSignal<TextDraft>(emptyText());
    const [emoji, setEmoji] = createSignal('');
    const [category, setCategory] = createSignal('');
    const [categoryLabel, setCategoryLabelAll] = createSignal<TextDraft>(emptyText());
    const [imageURI, setImageURI] = createSignal('');
    const [outcomes, setOutcomes] = createSignal<OutcomeDraft[]>(START());
    const [lockAt, setLockAt] = createSignal('');
    const [startAt, setStartAt] = createSignal('');
    const [resolveHours, setResolveHours] = createSignal(RESOLVE_HOURS_DEFAULT);
    const [kind, setKind] = createSignal<MarketKindName>('amm');
    const [liquidity, setLiquidity] = createSignal('');
    const [feeBps, setFeeBps] = createSignal('0');
    const [protocolShareBps, setProtocolShareBps] = createSignal('0');
    const [source, setSource] = createSignal<DraftSource | null>(null);

    let nextId = 3;

    return {
        title,
        description,
        emoji,
        category,
        categoryLabel,
        imageURI,
        outcomes,
        startAt,
        lockAt,
        resolveHours,
        kind,
        liquidity,
        feeBps,
        protocolShareBps,
        source,

        setTitle: (lang, next) => setTitleAll({ ...title(), [lang]: next }),
        setDescription: (lang, next) => setDescriptionAll({ ...description(), [lang]: next }),
        setEmoji,
        setCategory,
        setCategoryLabel: (lang, next) => setCategoryLabelAll({ ...categoryLabel(), [lang]: next }),
        setImageURI,
        setStartAt,
        setLockAt,
        setResolveHours,
        setKind,
        setLiquidity,
        setFeeBps,
        setProtocolShareBps,

        setOutcomeLabel: (id, lang, next) => {
            setOutcomes(
                outcomes().map((outcome) =>
                    outcome.id === id ? { ...outcome, labels: { ...outcome.labels, [lang]: next } } : outcome
                )
            );
        },
        setOutcomeIcon: (id, next) => {
            setOutcomes(outcomes().map((outcome) => (outcome.id === id ? { ...outcome, icon: next } : outcome)));
        },
        addOutcome: () => {
            setOutcomes([...outcomes(), { id: nextId, labels: emptyText(), icon: '' }]);
            nextId += 1;
        },
        removeOutcome: (id) => {
            setOutcomes(outcomes().filter((outcome) => outcome.id !== id));
        },
        importProposal: (row) => {
            const seed = draftFromProposal(row, Date.now());
            const seeded = seed.outcomes.map((outcome, index) => ({ id: index + 1, ...outcome }));
            setTitleAll(seed.title);
            setDescriptionAll(seed.description);
            setEmoji('');
            setCategory(seed.category);
            setCategoryLabelAll(emptyText());
            setImageURI('');
            setOutcomes(seeded.length >= 2 ? seeded : START());
            nextId = Math.max(seeded.length, 2) + 1;
            setStartAt(seed.startAt);
            setLockAt(seed.lockAt);
            setSource(seed.source);
        },

        reset: () => {
            setTitleAll(emptyText());
            setDescriptionAll(emptyText());
            setEmoji('');
            setCategory('');
            setCategoryLabelAll(emptyText());
            setImageURI('');
            setOutcomes(START());
            setStartAt('');
            setLockAt('');
            setResolveHours(RESOLVE_HOURS_DEFAULT);
            setKind('amm');
            setLiquidity('');
            setFeeBps('0');
            setProtocolShareBps('0');
            setSource(null);
            nextId = 3;
        }
    };
});
