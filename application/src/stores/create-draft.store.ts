import { createStore, createSignal, type Getter } from '../lib/reactive.ts';

import { CONTENT_LANGS, localizedOf, type ContentLang, type DiscoveredMarket, type Localized } from '../api.ts';

import { isImageURI } from '../lib/market.ts';

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

/** What a venue's market becomes as a draft here. Every translation is the admin's to write. */
export interface DraftSeed {
    title: TextDraft;
    description: TextDraft;
    category: string;
    imageURI: string;
    outcomes: Array<{ labels: TextDraft; icon: string }>;
    lockAt: string;
    resolveAt: string;
    source: DraftSource;
}

const VENUE_NAMES: Record<string, string> = { polymarket: 'Polymarket' };

/** The two answers every venue spells the same way; any other label is the admin's to translate. */
const FA_ANSWERS: Record<string, string> = { yes: 'بله', no: 'خیر' };

/** Resolution opens a day after trading locks, so the venue's own answer exists first. */
const RESOLVE_AFTER_MS = 24 * 60 * 60 * 1000;

/** An instant as `<input type="datetime-local">` spells it: local wall clock, to the minute, no zone. */
export function toLocalInput(ms: number): string {
    const at = new Date(ms);
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/**
 * A venue's market as a draft here. The resolution source is appended to the rules only when
 * the text does not already cite it. An end date that has passed seeds NO timing at all: the
 * timing step then says so, instead of a deploy failing on a lock time in the past.
 */
export function draftFromDiscovered(row: DiscoveredMarket, now: number): DraftSeed {
    const description = row.description.trim();
    const cite = row.resolutionSource.trim();
    const cited = cite === '' || description.includes(cite);

    const endsAt = row.endsAt === '' ? Number.NaN : new Date(row.endsAt).getTime();
    const ahead = Number.isFinite(endsAt) && endsAt > now;

    return {
        title: textOf({ en: row.question.trim() }),
        description: textOf({ en: cited ? description : `${description}\n\nResolution source: ${cite}`.trim() }),
        category: row.category,
        imageURI: isImageURI(row.image) ? row.image : '',
        outcomes: row.outcomes.map((outcome) => ({
            labels: textOf({
                en: outcome.label.trim(),
                fa: FA_ANSWERS[outcome.label.trim().toLowerCase()] ?? ''
            }),
            icon: ''
        })),
        lockAt: ahead ? toLocalInput(endsAt) : '',
        resolveAt: ahead ? toLocalInput(endsAt + RESOLVE_AFTER_MS) : '',
        source: { venue: VENUE_NAMES[row.source] ?? row.source, url: row.url }
    };
}

export interface CreateDraftApi {
    title: Getter<TextDraft>;
    description: Getter<TextDraft>;
    emoji: Getter<string>;
    category: Getter<string>;
    imageURI: Getter<string>;
    outcomes: Getter<OutcomeDraft[]>;
    lockAt: Getter<string>;
    resolveAt: Getter<string>;
    liquidity: Getter<string>;
    feeBps: Getter<string>;
    protocolShareBps: Getter<string>;

    /** Where the wording came from, or null when it was written here. Cleared by `reset`. */
    source: Getter<DraftSource | null>;

    setTitle(lang: ContentLang, next: string): void;
    setDescription(lang: ContentLang, next: string): void;
    setEmoji(next: string): void;
    setCategory(next: string): void;
    setImageURI(next: string): void;
    setLockAt(next: string): void;
    setResolveAt(next: string): void;
    setLiquidity(next: string): void;
    setFeeBps(next: string): void;
    setProtocolShareBps(next: string): void;

    setOutcomeLabel(id: number, lang: ContentLang, next: string): void;
    setOutcomeIcon(id: number, next: string): void;
    addOutcome(): void;
    removeOutcome(id: number): void;

    /**
     * Replaces the wording, answers, image and timing with a venue's market. Liquidity and
     * fees are untouched: they are this platform's numbers, not the venue's.
     */
    importDiscovered(row: DiscoveredMarket): void;

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
    const [imageURI, setImageURI] = createSignal('');
    const [outcomes, setOutcomes] = createSignal<OutcomeDraft[]>(START());
    const [lockAt, setLockAt] = createSignal('');
    const [resolveAt, setResolveAt] = createSignal('');
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
        imageURI,
        outcomes,
        lockAt,
        resolveAt,
        liquidity,
        feeBps,
        protocolShareBps,
        source,

        setTitle: (lang, next) => setTitleAll({ ...title(), [lang]: next }),
        setDescription: (lang, next) => setDescriptionAll({ ...description(), [lang]: next }),
        setEmoji,
        setCategory,
        setImageURI,
        setLockAt,
        setResolveAt,
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
        importDiscovered: (row) => {
            const seed = draftFromDiscovered(row, Date.now());
            const seeded = seed.outcomes.map((outcome, index) => ({ id: index + 1, ...outcome }));
            setTitleAll(seed.title);
            setDescriptionAll(seed.description);
            setEmoji('');
            setCategory(seed.category);
            setImageURI(seed.imageURI);
            setOutcomes(seeded.length >= 2 ? seeded : START());
            nextId = Math.max(seeded.length, 2) + 1;
            setLockAt(seed.lockAt);
            setResolveAt(seed.resolveAt);
            setSource(seed.source);
        },
        reset: () => {
            setTitleAll(emptyText());
            setDescriptionAll(emptyText());
            setEmoji('');
            setCategory('');
            setImageURI('');
            setOutcomes(START());
            setLockAt('');
            setResolveAt('');
            setLiquidity('');
            setFeeBps('0');
            setProtocolShareBps('0');
            setSource(null);
            nextId = 3;
        }
    };
});
