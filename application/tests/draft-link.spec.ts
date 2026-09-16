// A half-written market as a URL. The create form is one page of fields, and the market behind
// it is usually agreed somewhere else - a chat, a spreadsheet, another operator's browser - so
// the whole draft has to survive a trip through a querystring and back into the inputs.
//
// The draft store is a singleton, so this file resets what it fills.
import { describe, it, expect, afterEach } from 'vitest';

import {
    useCreateDraft,
    draftToQuery,
    draftFromQuery,
    draftLink,
    isDraftParam,
    emptyText,
    textOf,
    RESOLVE_HOURS_DEFAULT,
    type DraftFields
} from '../src/stores/create-draft.store.ts';

/** A draft with something written in every field, translations included. */
function filled(): DraftFields {
    return {
        title: textOf({ en: 'Will Esteghlal win the derby?', fa: 'استقلال دربی را می‌برد؟' }),
        description: textOf({ en: 'Resolves on the final whistle.' }),
        emoji: '⚽',
        category: '3',
        categoryLabel: textOf({ en: 'Esports', fa: 'ورزش الکترونیک' }),
        imageURI: 'https://example.test/derby.png',
        outcomes: [
            { labels: textOf({ en: 'Yes', fa: 'بله' }), icon: 'https://example.test/yes.png' },
            { labels: textOf({ en: 'No', fa: 'خیر' }), icon: '' }
        ],
        startAt: '2026-10-01T12:00',
        lockAt: '2026-10-08T12:00',
        resolveHours: '72',
        kind: 'pool',
        liquidity: '100',
        feeBps: '50',
        protocolShareBps: '0'
    };
}

afterEach(() => {
    useCreateDraft.peek().reset();
});

describe('draft links', () => {
    it('carries every written field through the query and back into the form', () => {
        const fields = filled();
        const seed = draftFromQuery(new URLSearchParams(draftToQuery(fields)));
        expect(seed).not.toBeNull();

        const draft = useCreateDraft.peek();
        draft.load(seed ?? {});
        expect(draft.fields()).toEqual(fields);
    });

    it('leaves a field at its default out of the link', () => {
        const params = new URLSearchParams(
            draftToQuery({ ...filled(), resolveHours: RESOLVE_HOURS_DEFAULT, kind: 'amm', feeBps: '0' })
        );
        expect(params.get('resolve')).toBeNull();
        expect(params.get('kind')).toBeNull();
        expect(params.get('fee')).toBeNull();
        // What WAS written still travels.
        expect(params.get('title')).toBe('Will Esteghlal win the derby?');
        expect(params.get('title.fa')).toBe('استقلال دربی را می‌برد؟');
        expect(params.get('o1.icon')).toBe('https://example.test/yes.png');
    });

    it('fills in only the fields the link names', () => {
        const draft = useCreateDraft.peek();
        draft.setLiquidity('250');

        const seed = draftFromQuery(new URLSearchParams('title=Rain+tomorrow%3F&cat=9'));
        draft.load(seed ?? {});

        expect(draft.title().en).toBe('Rain tomorrow?');
        expect(draft.category()).toBe('9');
        // Untouched: a link carrying a question must not wipe the numbers off a form in progress.
        expect(draft.liquidity()).toBe('250');
        expect(draft.resolveHours()).toBe(RESOLVE_HOURS_DEFAULT);
    });

    it('says nothing about a query that is not a draft', () => {
        expect(draftFromQuery(new URLSearchParams('section=create&ref=abc'))).toBeNull();
    });

    it('ignores an engine it does not have', () => {
        // Deploying the wrong engine cannot be undone, so a typo must not pick one.
        const seed = draftFromQuery(new URLSearchParams('title=X&kind=orderbook'));
        expect(seed?.kind).toBeUndefined();
    });

    it('keeps an answer a link gives no English name', () => {
        const seed = draftFromQuery(new URLSearchParams('o1.fa=%D8%A8%D9%84%D9%87&o2=No'));
        expect(seed?.outcomes).toEqual([
            { labels: textOf({ fa: 'بله' }), icon: '' },
            { labels: textOf({ en: 'No' }), icon: '' }
        ]);
    });

    it('falls back to the default pair when a link carries fewer than two answers', () => {
        const draft = useCreateDraft.peek();
        draft.load({ outcomes: [{ labels: textOf({ en: 'Maybe' }), icon: '' }] });
        expect(draft.outcomes().map((outcome) => outcome.labels.en)).toEqual(['Yes', 'No']);
    });

    it('claims only the parameters it wrote', () => {
        for (const key of ['title', 'title.fa', 'desc', 'catName.ar', 'o1', 'o12.fa', 'o3.icon', 'kind', 'liq']) {
            expect(isDraftParam(key)).toBe(true);
        }
        // Not ours: another page's parameters have to survive the strip.
        for (const key of ['section', 'ref', 'outcome', 'side', 'title.xx', 'o0', 'o17', 'kind.icon']) {
            expect(isDraftParam(key)).toBe(false);
        }
    });

    it('points at the console section that holds the form', () => {
        const link = draftLink({ ...filled(), title: emptyText() });
        expect(link.startsWith(`${window.location.origin}/admin?section=create&`)).toBe(true);
    });
});
