import { createStore, createSignal, type Getter } from '../lib/reactive.ts';

import type { DiscoveredMarket } from '../api.ts';

// The half-written market. It lives in a store rather than in the form component because the
// form is now one section of the admin console: switching to Categories to register a name
// and coming back used to wipe every field, including a bilingual question already typed out.

export interface OutcomeDraft {
    id: number;
    en: string;
    fa: string;

    /** Outcome art. Rides the on-chain name envelope, so it needs no contract change. */
    icon: string;
}

/** Where a draft's wording came from, so the form can say so and link back to it. */
export interface DraftSource {
    venue: string;
    url: string;
}

/** What a venue's market becomes as a draft here. Everything Persian is the admin's to write. */
export interface DraftSeed {
    titleEn: string;
    descriptionEn: string;
    category: string;
    imageURI: string;
    outcomes: Array<{ en: string; fa: string; icon: string }>;
    lockAt: string;
    resolveAt: string;
    source: DraftSource;
}

const VENUE_NAMES: Record<string, string> = { polymarket: 'Polymarket' };

/** The two answers every venue spells the same way; any other label is the admin's to translate. */
const FA_ANSWERS: Record<string, string> = { yes: 'بله', no: 'خیر' };

/** Resolution opens a day after trading locks, so the venue's own answer exists first. */
const RESOLVE_AFTER_MS = 24 * 60 * 60 * 1000;

/** The form's image rule, repeated here so a seed never plants a value the form then rejects. */
const IMAGE_URI = /^https:\/\/\S+$/;

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
        titleEn: row.question.trim(),
        descriptionEn: cited ? description : `${description}\n\nResolution source: ${cite}`.trim(),
        category: row.category,
        imageURI: IMAGE_URI.test(row.image) ? row.image : '',
        outcomes: row.outcomes.map((outcome) => ({
            en: outcome.label.trim(),
            fa: FA_ANSWERS[outcome.label.trim().toLowerCase()] ?? '',
            icon: ''
        })),
        lockAt: ahead ? toLocalInput(endsAt) : '',
        resolveAt: ahead ? toLocalInput(endsAt + RESOLVE_AFTER_MS) : '',
        source: { venue: VENUE_NAMES[row.source] ?? row.source, url: row.url }
    };
}

export interface CreateDraftApi {
    titleEn: Getter<string>;
    titleFa: Getter<string>;
    emoji: Getter<string>;
    descriptionEn: Getter<string>;
    descriptionFa: Getter<string>;
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

    setTitleEn(next: string): void;
    setTitleFa(next: string): void;
    setEmoji(next: string): void;
    setDescriptionEn(next: string): void;
    setDescriptionFa(next: string): void;
    setCategory(next: string): void;
    setImageURI(next: string): void;
    setLockAt(next: string): void;
    setResolveAt(next: string): void;
    setLiquidity(next: string): void;
    setFeeBps(next: string): void;
    setProtocolShareBps(next: string): void;

    setOutcome(id: number, field: 'en' | 'fa' | 'icon', value: string): void;
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
    { id: 1, en: 'Yes', fa: 'بله', icon: '' },
    { id: 2, en: 'No', fa: 'خیر', icon: '' }
];

export const useCreateDraft = createStore((): CreateDraftApi => {
    const [titleEn, setTitleEn] = createSignal('');
    const [titleFa, setTitleFa] = createSignal('');
    const [emoji, setEmoji] = createSignal('');
    const [descriptionEn, setDescriptionEn] = createSignal('');
    const [descriptionFa, setDescriptionFa] = createSignal('');
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
        titleEn,
        titleFa,
        emoji,
        descriptionEn,
        descriptionFa,
        category,
        imageURI,
        outcomes,
        lockAt,
        resolveAt,
        liquidity,
        feeBps,
        protocolShareBps,
        source,

        setTitleEn,
        setTitleFa,
        setEmoji,
        setDescriptionEn,
        setDescriptionFa,
        setCategory,
        setImageURI,
        setLockAt,
        setResolveAt,
        setLiquidity,
        setFeeBps,
        setProtocolShareBps,

        setOutcome: (id, field, value) => {
            setOutcomes(outcomes().map((outcome) => (outcome.id === id ? { ...outcome, [field]: value } : outcome)));
        },
        addOutcome: () => {
            setOutcomes([...outcomes(), { id: nextId, en: '', fa: '', icon: '' }]);
            nextId += 1;
        },
        removeOutcome: (id) => {
            setOutcomes(outcomes().filter((outcome) => outcome.id !== id));
        },
        importDiscovered: (row) => {
            const seed = draftFromDiscovered(row, Date.now());
            const seeded = seed.outcomes.map((outcome, index) => ({ id: index + 1, ...outcome }));
            setTitleEn(seed.titleEn);
            setTitleFa('');
            setEmoji('');
            setDescriptionEn(seed.descriptionEn);
            setDescriptionFa('');
            setCategory(seed.category);
            setImageURI(seed.imageURI);
            setOutcomes(seeded.length >= 2 ? seeded : START());
            nextId = Math.max(seeded.length, 2) + 1;
            setLockAt(seed.lockAt);
            setResolveAt(seed.resolveAt);
            setSource(seed.source);
        },
        reset: () => {
            setTitleEn('');
            setTitleFa('');
            setEmoji('');
            setDescriptionEn('');
            setDescriptionFa('');
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
