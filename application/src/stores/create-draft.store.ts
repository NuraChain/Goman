import { createStore, createSignal, type Getter } from '../lib/reactive.ts';

import {
    CONTENT_LANGS,
    dedupeTags,
    localizedOf,
    TAGS_PER_MARKET,
    type ContentLang,
    type Localized,
    type MarketKindName
} from '../api.ts';

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

/** The usual gap between trading stopping and resolution opening. Per-market, not a law. */
export const RESOLVE_HOURS_DEFAULT = '24';

/** Enough depth that the first trades move the price by a sensible amount rather than
 *  emptying the book. A starting point an author overwrites, not a rule. */
export const LIQUIDITY_DEFAULT = '100';

/** The trade fee a fresh form STARTS on. The factory's own number replaces it as soon as it
 *  has been read - see `seedFee` - so this is what shows before that, and for a creator
 *  wallet that never opens the console at all. */
export const FEE_BPS_DEFAULT = '200';

/** An instant as `<input type="datetime-local">` spells it: local wall clock, to the minute, no zone. */
export function toLocalInput(ms: number): string {
    const at = new Date(ms);
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/**
 * Every field of a draft as plain data. The store holds signals, which cannot be handed round
 * or serialised; this is the shape the link encoder reads, and the shape a seeded form is
 * loaded from.
 */
export interface DraftFields {
    title: TextDraft;
    description: TextDraft;
    emoji: string;
    category: string;
    categoryLabel: TextDraft;
    imageURI: string;

    /** The subjects this market is about, as written. Deduplicated by slug on the way out,
     *  so the draft can hold whatever the author typed. */
    tags: string[];
    outcomes: Array<{ labels: TextDraft; icon: string }>;
    startAt: string;
    lockAt: string;
    resolveHours: string;
    kind: MarketKindName;
    liquidity: string;
    feeBps: string;
}

// A draft as a LINK. A market is usually worked out somewhere that is not this form - a chat,
// a spreadsheet, another operator's browser - and re-keying fourteen fields plus ten
// translations is where the typos come from. So the whole draft round-trips through a
// querystring: `?title=...&o1=...` fills the form in on arrival.
//
// Only what was written is encoded. A field still at its default stays out, because a link
// nobody can read at a glance is a link nobody checks before opening.

/** Per-language parameters: `title` is the English one, `title.fa` the Persian. */
const TEXT_KEYS = ['title', 'desc', 'catName'];

/** Single-value parameters. `tags` carries the whole list, comma separated - one parameter
 *  rather than `tag1=`, `tag2=`, because a link is read by a person before it is opened. */
const SCALAR_KEYS = ['emoji', 'cat', 'image', 'start', 'lock', 'resolve', 'kind', 'liq', 'fee', 'tags'];

/** What one parameter may carry. A link is a draft, not a document. */
const VALUE_MAX = 600;

/** The form's own ceiling on answers, repeated here so a hand-written link cannot exceed it. */
const OUTCOME_MAX = 16;

const LANG_SET = new Set<string>(CONTENT_LANGS);

/** The answer `o3` names, or 0 when the base is not an answer at all. */
function outcomeIndex(base: string): number {
    const found = /^o(\d{1,2})$/.exec(base);
    const index = found === null ? 0 : Number(found[1]);
    return index >= 1 && index <= OUTCOME_MAX ? index : 0;
}

/** True when this parameter belongs to a draft link, and so is ours to read and then strip. */
export function isDraftParam(key: string): boolean {
    const dot = key.indexOf('.');
    const base = dot === -1 ? key : key.slice(0, dot);
    const suffix = dot === -1 ? '' : key.slice(dot + 1);
    const outcome = outcomeIndex(base) !== 0;
    if (!outcome && !TEXT_KEYS.includes(base) && !SCALAR_KEYS.includes(base)) {
        return false;
    }
    if (suffix === '') {
        return true;
    }
    if (suffix === 'icon') {
        return outcome;
    }
    return (outcome || TEXT_KEYS.includes(base)) && LANG_SET.has(suffix);
}

function putText(params: URLSearchParams, key: string, text: TextDraft): void {
    for (const code of CONTENT_LANGS) {
        const value = text[code].trim();
        if (value !== '') {
            params.set(code === 'en' ? key : `${key}.${code}`, value);
        }
    }
}

function readText(params: URLSearchParams, key: string): TextDraft | undefined {
    const text = emptyText();
    let written = false;
    for (const code of CONTENT_LANGS) {
        const value = params.get(code === 'en' ? key : `${key}.${code}`);
        if (value !== null) {
            text[code] = value.slice(0, VALUE_MAX);
            written = true;
        }
    }
    return written ? text : undefined;
}

/** The draft as a querystring, without the leading `?`. */
export function draftToQuery(fields: DraftFields): string {
    const params = new URLSearchParams();
    putText(params, 'title', fields.title);
    putText(params, 'desc', fields.description);
    putText(params, 'catName', fields.categoryLabel);

    const plain: Array<[string, string]> = [
        ['emoji', fields.emoji],
        ['cat', fields.category],
        ['image', fields.imageURI],
        ['start', fields.startAt],
        ['lock', fields.lockAt],
        ['liq', fields.liquidity],
        ['tags', fields.tags.join(',')]
    ];
    for (const [key, value] of plain) {
        if (value.trim() !== '') {
            params.set(key, value.trim());
        }
    }

    // The four a fresh form already reads. Spelling them out would lengthen every link for no
    // information at all.
    if (fields.resolveHours.trim() !== '' && fields.resolveHours.trim() !== RESOLVE_HOURS_DEFAULT) {
        params.set('resolve', fields.resolveHours.trim());
    }
    if (fields.kind !== 'amm') {
        params.set('kind', fields.kind);
    }
    if (Number(fields.feeBps) > 0) {
        params.set('fee', fields.feeBps.trim());
    }

    fields.outcomes.slice(0, OUTCOME_MAX).forEach((outcome, index) => {
        putText(params, `o${index + 1}`, outcome.labels);
        if (outcome.icon.trim() !== '') {
            params.set(`o${index + 1}.icon`, outcome.icon.trim());
        }
    });

    return params.toString();
}

/**
 * What a query says about a draft, or `null` when it says nothing - which is every ordinary
 * visit to the console. A field the link omits is left ALONE rather than blanked: a link
 * carrying only a question must not wipe the fees off a form already being filled in.
 */
export function draftFromQuery(params: URLSearchParams): Partial<DraftFields> | null {
    const seed: Partial<DraftFields> = {};

    const title = readText(params, 'title');
    if (title !== undefined) {
        seed.title = title;
    }
    const description = readText(params, 'desc');
    if (description !== undefined) {
        seed.description = description;
    }
    const categoryLabel = readText(params, 'catName');
    if (categoryLabel !== undefined) {
        seed.categoryLabel = categoryLabel;
    }

    const put = (key: string, apply: (value: string) => void): void => {
        const value = params.get(key);
        if (value !== null) {
            apply(value.slice(0, VALUE_MAX));
        }
    };
    put('emoji', (value) => {
        seed.emoji = value;
    });
    put('cat', (value) => {
        seed.category = value;
    });
    put('image', (value) => {
        seed.imageURI = value;
    });
    put('start', (value) => {
        seed.startAt = value;
    });
    put('lock', (value) => {
        seed.lockAt = value;
    });
    put('resolve', (value) => {
        seed.resolveHours = value;
    });
    put('liq', (value) => {
        seed.liquidity = value;
    });
    put('fee', (value) => {
        seed.feeBps = value;
    });
    put('tags', (value) => {
        seed.tags = dedupeTags(value.split(','));
    });

    // An engine this app does not have is a typo, not a field, and the wrong one is unfixable
    // once deployed - so an unknown value leaves the form on its default.
    const kind = params.get('kind');
    if (kind === 'amm' || kind === 'pool') {
        seed.kind = kind;
    }

    const outcomes: Array<{ labels: TextDraft; icon: string }> = [];
    for (let at = 1; at <= OUTCOME_MAX; at += 1) {
        const labels = readText(params, `o${at}`);
        const icon = params.get(`o${at}.icon`);
        if (labels === undefined && icon === null) {
            continue;
        }
        outcomes.push({ labels: labels ?? emptyText(), icon: (icon ?? '').slice(0, VALUE_MAX) });
    }
    if (outcomes.length > 0) {
        seed.outcomes = outcomes;
    }

    return Object.keys(seed).length === 0 ? null : seed;
}

/** The console's create form with nothing in it - what a wallet just given access is sent. */
export function createFormLink(): string {
    return `${window.location.origin}/admin?section=create`;
}

/** The absolute link that reopens the console's create form with this draft already in it. */
export function draftLink(fields: DraftFields): string {
    const query = draftToQuery(fields);
    return `${createFormLink()}${query === '' ? '' : `&${query}`}`;
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
    tags: Getter<string[]>;
    outcomes: Getter<OutcomeDraft[]>;
    startAt: Getter<string>;
    lockAt: Getter<string>;

    /** Hours between the stop time and resolution opening. A duration, not a date. */
    resolveHours: Getter<string>;

    /** Which engine to deploy: a CPMM market, or a parimutuel pool. */
    kind: Getter<MarketKindName>;
    liquidity: Getter<string>;
    feeBps: Getter<string>;

    setTitle(lang: ContentLang, next: string): void;
    setDescription(lang: ContentLang, next: string): void;
    setEmoji(next: string): void;
    setCategory(next: string): void;
    setCategoryLabel(lang: ContentLang, next: string): void;
    setImageURI(next: string): void;

    /** Replaces the whole list. Deduplicated and capped here rather than in the field, so a
     *  draft link cannot smuggle in fifty subjects the form would never have accepted. */
    setTags(next: string[]): void;
    setStartAt(next: string): void;
    setLockAt(next: string): void;
    setResolveHours(next: string): void;
    setKind(next: MarketKindName): void;
    setLiquidity(next: string): void;
    setFeeBps(next: string): void;

    /**
     * Replaces the trade fee with the FACTORY's default - the number a market inherits anyway,
     * shown instead of a zero nobody can price. Ignored once the fee has been set on purpose,
     * by a draft link or by the author: a form already filled in must not change under a read
     * that happens to land late.
     */
    seedFee(fee: string): void;

    setOutcomeLabel(id: number, lang: ContentLang, next: string): void;
    setOutcomeIcon(id: number, next: string): void;
    addOutcome(): void;
    removeOutcome(id: number): void;

    /** Every field as plain data - what a draft link is built out of. */
    fields(): DraftFields;

    /** Fills in the fields a seed carries, leaving every field it omits untouched. */
    load(seed: Partial<DraftFields>): void;

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
    const [tags, setTags] = createSignal<string[]>([]);
    const [outcomes, setOutcomes] = createSignal<OutcomeDraft[]>(START());
    const [lockAt, setLockAt] = createSignal('');
    const [startAt, setStartAt] = createSignal('');
    const [resolveHours, setResolveHours] = createSignal(RESOLVE_HOURS_DEFAULT);
    const [kind, setKind] = createSignal<MarketKindName>('amm');
    const [liquidity, setLiquidity] = createSignal(LIQUIDITY_DEFAULT);
    const [feeBps, setFeeBps] = createSignal(FEE_BPS_DEFAULT);

    let nextId = 3;

    /** True once the trade fee is somebody's decision rather than this file's opening bid. */
    let feeChosen = false;

    return {
        title,
        description,
        emoji,
        category,
        categoryLabel,
        imageURI,
        tags,
        outcomes,
        startAt,
        lockAt,
        resolveHours,
        kind,
        liquidity,
        feeBps,

        setTitle: (lang, next) => setTitleAll({ ...title(), [lang]: next }),
        setDescription: (lang, next) => setDescriptionAll({ ...description(), [lang]: next }),
        setEmoji,
        setCategory,
        setCategoryLabel: (lang, next) => setCategoryLabelAll({ ...categoryLabel(), [lang]: next }),
        setImageURI,
        setTags: (next) => setTags(dedupeTags(next).slice(0, TAGS_PER_MARKET)),
        setStartAt,
        setLockAt,
        setResolveHours,
        setKind,
        setLiquidity,
        setFeeBps: (next) => {
            feeChosen = true;
            setFeeBps(next);
        },

        seedFee: (fee) => {
            if (feeChosen) {
                return;
            }
            setFeeBps(fee);
        },

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
        fields: () => ({
            title: title(),
            description: description(),
            emoji: emoji(),
            category: category(),
            categoryLabel: categoryLabel(),
            imageURI: imageURI(),
            tags: tags(),
            outcomes: outcomes().map((outcome) => ({ labels: outcome.labels, icon: outcome.icon })),
            startAt: startAt(),
            lockAt: lockAt(),
            resolveHours: resolveHours(),
            kind: kind(),
            liquidity: liquidity(),
            feeBps: feeBps()
        }),

        load: (seed) => {
            if (seed.title !== undefined) {
                setTitleAll(seed.title);
            }
            if (seed.description !== undefined) {
                setDescriptionAll(seed.description);
            }
            if (seed.emoji !== undefined) {
                setEmoji(seed.emoji);
            }
            if (seed.category !== undefined) {
                setCategory(seed.category);
            }
            if (seed.categoryLabel !== undefined) {
                setCategoryLabelAll(seed.categoryLabel);
            }
            if (seed.imageURI !== undefined) {
                setImageURI(seed.imageURI);
            }
            if (seed.tags !== undefined) {
                setTags(dedupeTags(seed.tags).slice(0, TAGS_PER_MARKET));
            }
            if (seed.startAt !== undefined) {
                setStartAt(seed.startAt);
            }
            if (seed.lockAt !== undefined) {
                setLockAt(seed.lockAt);
            }
            if (seed.resolveHours !== undefined) {
                setResolveHours(seed.resolveHours);
            }
            if (seed.kind !== undefined) {
                setKind(seed.kind);
            }
            if (seed.liquidity !== undefined) {
                setLiquidity(seed.liquidity);
            }
            if (seed.feeBps !== undefined) {
                feeChosen = true;
                setFeeBps(seed.feeBps);
            }
            // A market needs two answers to exist, so a seed carrying fewer is not a shorter
            // market - it is a broken link, and the default pair is the safer thing to show.
            if (seed.outcomes !== undefined) {
                const rows = seed.outcomes.map((outcome, index) => ({ id: index + 1, ...outcome }));
                setOutcomes(rows.length >= 2 ? rows : START());
                nextId = Math.max(rows.length, 2) + 1;
            }
        },

        reset: () => {
            setTitleAll(emptyText());
            setDescriptionAll(emptyText());
            setEmoji('');
            setCategory('');
            setCategoryLabelAll(emptyText());
            setImageURI('');
            setTags([]);
            setOutcomes(START());
            setStartAt('');
            setLockAt('');
            setResolveHours(RESOLVE_HOURS_DEFAULT);
            setKind('amm');
            setLiquidity(LIQUIDITY_DEFAULT);
            setFeeBps(FEE_BPS_DEFAULT);
            nextId = 3;
            feeChosen = false;
        }
    };
});
