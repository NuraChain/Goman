// The tag system end to end, against a real in-memory index.
//
// Three things are worth testing here and most of the rest follows: that two spellings of
// one subject can never become two subjects, that a tag match outranks a text match by
// enough to matter, and that the queries a tag page and an autocomplete run actually seek
// their indexes rather than reading every row.
import { describe, it, expect, beforeEach } from 'vitest';

import { IndexStore, type MarketFilter, type MarketRow } from '../src/chain/store.ts';
import { marketTags, searchText, seedTags } from '../src/derive.ts';
import {
    decodeTitleMeta,
    dedupeTags,
    encodeTitleMeta,
    normalizeTag,
    tagSlugs,
    TAG_MAX_LENGTH,
    TAGS_PER_MARKET
} from '../src/wire.ts';

const FACTORY = '0xfac70aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const RULES = { en: 'Resolves on the official result.' };

function marketRow(id: number, title: string, tags: string[], overrides: Partial<MarketRow> = {}): MarketRow
{
    const localized = { en: title };
    return {
        id,
        address: `0x${ String(id + 1).padStart(40, '0') }`,
        status: 0,
        category: '7',
        title_json: JSON.stringify(localized),
        emoji: 'X',
        rules_json: JSON.stringify(RULES),
        image: '',
        creator: '0xcafe',
        created_at: 1000 + id,
        lock_time: 5000 + id,
        resolve_time: 9000 + id,
        outcome_count: 2,
        volume: 0,
        liquidity: 100,
        collected: 0,
        winning_outcome: null,
        featured: 0,
        search_text: searchText(localized, RULES, '7', [], marketTags(tags)),
        kind: 0,
        ...overrides
    };
}

/** A market in the index, filed under `tags` - the two writes the indexer itself makes. */
function seed(store: IndexStore, id: number, title: string, tags: string[], overrides: Partial<MarketRow> = {}): void
{
    store.insertMarket(marketRow(id, title, tags, overrides), []);
    store.setMarketTags(id, marketTags(tags));
}

const list = (store: IndexStore, filter: MarketFilter): number[] => store.listMarkets(filter).rows.map((row) => row.id);

describe('tag normalisation', () =>
{
    it('resolves every spelling of one subject to one slug', () =>
    {
        expect(normalizeTag('Football')).toBe('football');
        expect(normalizeTag('football')).toBe('football');
        expect(normalizeTag('FOOTBALL')).toBe('football');
        expect(normalizeTag('  football  ')).toBe('football');
        expect(normalizeTag('Iran Football')).toBe('iran-football');
        expect(normalizeTag(' Iran   Football ')).toBe('iran-football');
        expect(normalizeTag('Iran, Football!')).toBe('iran-football');
        expect(normalizeTag('--iran--football--')).toBe('iran-football');
    });

    it('never produces an empty or punctuation-only tag', () =>
    {
        for (const junk of ['', '   ', '!!!', '---', '###', '  ,.;  '])
        {
            expect(normalizeTag(junk)).toBe('');
        }
        expect(dedupeTags(['', '!!!', 'football'])).toEqual(['football']);
    });

    it('keeps words written in scripts that are not Latin', () =>
    {
        // The combining marks matter: strip them and Persian, Arabic and Devanagari lose the
        // vowels attached to their letters, which turns one word into a different one.
        expect(normalizeTag('فوتبال ایران')).toBe('فوتبال-ایران');
        expect(normalizeTag('क्रिकेट')).toBe('क्रिकेट');
        expect(normalizeTag('足球')).toBe('足球');
        expect(normalizeTag('Fútbol')).toBe('fútbol');
    });

    it('caps a tag and a tag list rather than trusting whoever wrote them', () =>
    {
        expect(normalizeTag('a'.repeat(200))).toHaveLength(TAG_MAX_LENGTH);
        expect(dedupeTags(Array.from({ length: 40 }, (_, at) => `tag-${ at }`))).toHaveLength(TAGS_PER_MARKET);
    });

    it('deduplicates by slug and keeps the first spelling as the label', () =>
    {
        expect(dedupeTags(['Football', 'football', 'FOOTBALL'])).toEqual(['Football']);
        expect(tagSlugs(['Football', 'football', 'FOOTBALL'])).toEqual(['football']);
        expect(marketTags(['Iran Football', 'IRAN FOOTBALL'])).toEqual([
            { slug: 'iran-football', name: 'Iran Football' }
        ]);
    });

    // The one seam the other tests each cover half of: what an author types in the create
    // form is encoded into the on-chain title, and what the indexer reads back out of that
    // string is what the market ends up filed under.
    it('carries the tags an author wrote from the envelope through to the index', () =>
    {
        const onChain = encodeTitleMeta({
            en: 'Iran Football League 2026',
            emoji: '⚽',
            tags: [' Iran Football ', 'IRAN FOOTBALL', 'League', '!!!']
        });

        const decoded = decodeTitleMeta(onChain, '🧭');
        const filed = marketTags(seedTags(decoded.tags, 'sports'));

        expect(filed).toEqual([
            { slug: 'iran-football', name: 'Iran Football' },
            { slug: 'league', name: 'League' },
            { slug: 'sports', name: 'sports' }
        ]);
    });

    it('files a pre-registry market under its category word and a registry one under nothing extra', () =>
    {
        // The migration of the categorisation this app already had: `crypto` was a word a
        // market carried and nothing ever made it a subject in its own right. `#7` is an id,
        // not a word anyone would type into a search box.
        expect(seedTags(['bitcoin'], 'crypto')).toEqual(['bitcoin', 'crypto']);
        expect(seedTags(['bitcoin'], '7')).toEqual(['bitcoin']);
    });
});

describe('tags in the index', () =>
{
    let store: IndexStore;

    beforeEach(() =>
    {
        store = new IndexStore(':memory:');
        store.ensureChain('0xgenesis', FACTORY);
    });

    it('carries many tags on one market and gives every one of them back', () =>
    {
        seed(store, 1, 'Iran Football League 2026', [
            'football',
            'iran',
            'league',
            'iran-football',
            'football-league',
            'iranian-football',
            'sport'
        ]);
        expect(store.tagsOf(1).map((tag) => tag.slug)).toEqual([
            'football',
            'football-league',
            'iran',
            'iran-football',
            'iranian-football',
            'league',
            'sport'
        ]);
    });

    it('mints one tag however many markets and spellings reach it', () =>
    {
        seed(store, 1, 'Iran Football League', ['Football']);
        seed(store, 2, 'Spain Football Cup', ['football']);
        seed(store, 3, 'Brazil Football Cup', ['FOOTBALL']);

        const found = store.searchTags('foot', 10);
        expect(found).toHaveLength(1);
        // The first spelling NAMES it; the later ones join that row rather than minting a
        // second subject meaning exactly the same thing.
        expect(found[0]).toEqual({ slug: 'football', name: 'Football', count: 3 });
    });

    it('replaces a tag list rather than accumulating it, and forgets an emptied subject', () =>
    {
        seed(store, 1, 'Iran Football League', ['football', 'iran']);
        store.setMarketTags(1, marketTags(['football', 'tehran']));

        expect(store.tagsOf(1).map((tag) => tag.slug)).toEqual(['football', 'tehran']);
        // Nothing is filed under `iran` now. Left behind it would keep completing in the
        // autocomplete and then hand back an empty page when picked.
        expect(store.searchTags('iran', 10)).toEqual([]);
    });

    it('reads a whole page of tags in one query', () =>
    {
        seed(store, 1, 'Iran Football League', ['football', 'iran']);
        seed(store, 2, 'Spain Football Cup', ['football', 'spain']);
        seed(store, 3, 'Tehran Weather', []);

        const byMarket = store.tagsOfMarkets([1, 2, 3]);
        expect(byMarket.get(1)?.map((tag) => tag.slug)).toEqual(['football', 'iran']);
        expect(byMarket.get(2)?.map((tag) => tag.slug)).toEqual(['football', 'spain']);
        expect(byMarket.get(3)).toBeUndefined();
        expect(store.tagsOfMarkets([])).toEqual(new Map());
    });
});

describe('searching and filtering by tag', () =>
{
    let store: IndexStore;

    // Market 1 is `Iran Football League 2026` - the example the whole feature is built
    // around. The others carry MORE volume, which is the sort order, so anything that ranks
    // market 1 above them is the tag boost rather than the tie-break.
    beforeEach(() =>
    {
        store = new IndexStore(':memory:');
        store.ensureChain('0xgenesis', FACTORY);
        seed(store, 1, 'Iran Football League 2026', [
            'football',
            'iran',
            'league',
            'iran-football',
            'football-league',
            'iranian-football',
            'sport'
        ]);
        seed(store, 2, 'Spain Football Cup', ['football', 'spain', 'sport'], { volume: 9_000 });
        seed(store, 3, 'Iran Presidential Election', ['iran', 'politics'], { volume: 8_000 });
        seed(store, 4, 'Will the league of nations expand?', [], { volume: 7_000 });
    });

    it('finds the market by any one of its tags', () =>
    {
        expect(list(store, { search: 'football', sort: 'volume', page: 1, limit: 10 })).toContain(1);
        expect(list(store, { search: 'iran', sort: 'volume', page: 1, limit: 10 })).toContain(1);
        expect(list(store, { search: 'sport', sort: 'volume', page: 1, limit: 10 })).toContain(1);
    });

    it('returns only what matches EVERY word, and ranks the one matching both tags first', () =>
    {
        expect(list(store, { search: 'football iran', sort: 'volume', page: 1, limit: 10 })).toEqual([1]);
    });

    it('ranks a tag match above a market that merely mentions the word', () =>
    {
        // Market 4 has `league` in its title and more volume; market 1 has it as a tag. A
        // subject someone chose beats a word that happens to appear.
        const ranked = list(store, { search: 'league', sort: 'volume', page: 1, limit: 10 });
        expect(ranked[0]).toBe(1);
        expect(ranked).toContain(4);
    });

    it('ranks an exact tag above one the word is only a prefix of', () =>
    {
        seed(store, 5, 'Footballers in transfer news', ['footballers'], { volume: 50_000 });
        expect(list(store, { search: 'football', sort: 'volume', page: 1, limit: 10 })[0]).toBe(1);
    });

    it('still answers a one-word search exactly as it always did', () =>
    {
        expect(list(store, { search: 'presidential', sort: 'volume', page: 1, limit: 10 })).toEqual([3]);
        expect(list(store, { search: 'nothing-here', sort: 'volume', page: 1, limit: 10 })).toEqual([]);
    });

    it('leaves a listing nobody searched in its own order', () =>
    {
        expect(list(store, { sort: 'volume', page: 1, limit: 10 })).toEqual([2, 3, 4, 1]);
    });

    it('filters by one tag', () =>
    {
        expect([...list(store, { tags: ['football'], sort: 'volume', page: 1, limit: 10 })].sort()).toEqual([1, 2]);
    });

    it('takes either tag in the default OR mode', () =>
    {
        const found = list(store, { tags: ['football', 'politics'], sort: 'volume', page: 1, limit: 10 });
        expect([...found].sort()).toEqual([1, 2, 3]);
    });

    it('takes only the markets carrying every tag in AND mode', () =>
    {
        expect(list(store, { tags: ['football', 'iran'], tagMode: 'all', sort: 'volume', page: 1, limit: 10 })).toEqual(
            [1]
        );
        expect(
            list(store, { tags: ['football', 'politics'], tagMode: 'all', sort: 'volume', page: 1, limit: 10 })
        ).toEqual([]);
    });

    it('normalises the filter, so a written tag and its slug are one filter', () =>
    {
        expect(list(store, { tags: ['Iran Football'], sort: 'volume', page: 1, limit: 10 })).toEqual([1]);
        // The same tag twice is one tag, in AND mode as much as in OR.
        expect(list(store, { tags: ['IRAN', 'iran'], tagMode: 'all', sort: 'volume', page: 1, limit: 10 }).length).toBe(
            2
        );
    });

    it('floats the market matching several of the filtered tags to the top of the wider net', () =>
    {
        expect(list(store, { tags: ['football', 'iran'], sort: 'volume', page: 1, limit: 10 })[0]).toBe(1);
    });

    it('pages a tag-filtered list and counts the whole set', () =>
    {
        const first = store.listMarkets({ tags: ['sport'], sort: 'newest', page: 1, limit: 1 });
        const second = store.listMarkets({ tags: ['sport'], sort: 'newest', page: 2, limit: 1 });

        expect(first.total).toBe(2);
        expect(second.total).toBe(2);
        expect(first.rows).toHaveLength(1);
        expect(second.rows).toHaveLength(1);
        expect(first.rows[0].id).not.toBe(second.rows[0].id);
    });

    it('completes a prefix, most-used first', () =>
    {
        expect(store.searchTags('foot', 10).map((tag) => tag.slug)).toEqual(['football', 'football-league']);
        expect(store.searchTags('', 2).map((tag) => tag.slug)).toEqual(['football', 'iran']);
        expect(store.searchTags('zzz', 10)).toEqual([]);
    });
});

describe('the tag queries that have to stay fast', () =>
{
    let store: IndexStore;

    beforeEach(() =>
    {
        store = new IndexStore(':memory:');
        store.ensureChain('0xgenesis', FACTORY);
        for (let id = 1; id <= 50; id += 1)
        {
            seed(store, id, `Market ${ id }`, [`tag-${ id % 7 }`, 'football']);
        }
    });

    // A scan of fifty rows passes any timing test, so what is asserted is SQLite's own plan.

    // The reason `searchTags` bounds a RANGE instead of writing `LIKE prefix || '%'`: SQLite
    // only optimises a LIKE into a range when the collation happens to line up, and the
    // silent fallback is a read of every subject in the vocabulary on every keystroke.
    it('answers a tag prefix by seeking the slug index', () =>
    {
        const plan = store.queryPlan('SELECT slug FROM tags WHERE slug >= ? AND slug < ?', ['foo', 'fop']);
        expect(plan).toMatch(/SEARCH tags USING (COVERING )?INDEX .*\(slug>\? AND slug<\?\)/);
        expect(plan).not.toMatch(/SCAN tags/);
    });

    it('never reads the whole tag table to complete one', () =>
    {
        const plan = store.queryPlan(
            `SELECT t.slug, COUNT(mt.market_id) FROM tags t JOIN market_tags mt ON mt.tag_id = t.id
             WHERE t.slug >= ? AND t.slug < ? GROUP BY t.id`,
            ['foo', 'fop']
        );
        expect(plan).not.toMatch(/SCAN t\b/);
    });

    it('seeks the join index when listing one tag', () =>
    {
        const plan = store.queryPlan(
            'SELECT mt.market_id FROM market_tags mt JOIN tags t ON t.id = mt.tag_id WHERE t.slug = ?',
            ['football']
        );
        expect(plan).toMatch(/SEARCH mt USING (COVERING )?INDEX idx_market_tags_tag/);
        expect(plan).not.toMatch(/SCAN market_tags/);
    });

    it('seeks rather than scans when reading one market', () =>
    {
        const plan = store.queryPlan(
            'SELECT t.slug FROM market_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.market_id = ?',
            [7]
        );
        expect(plan).toMatch(/SEARCH mt USING (COVERING )?INDEX/);
        expect(plan).not.toMatch(/SCAN market_tags/);
    });
});
