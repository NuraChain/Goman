import { createStore, createSignal, type Getter } from '../lib/reactive.ts';

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
            nextId = 3;
        }
    };
});
