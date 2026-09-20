// A market's address on the web. The id is what resolves the page, so the two rules that
// matter are that it survives everything a title can contain, and that it comes back out.
import { describe, it, expect } from 'vitest';

import { marketIdFromSlug, marketPath, marketSlug } from '../src/wire.ts';

const market = (
    title: string,
    rules: string,
    id = '12'
): { id: string; title: { en: string }; rules: { en: string } } => ({
    id,
    title: { en: title },
    rules: { en: rules }
});

describe('marketSlug', () =>
{
    it('puts the question first, what settles it second, and the id last', () =>
    {
        expect(marketSlug(market('Will Esteghlal win the derby?', 'Resolves on the league result.'))).toBe(
            'will-esteghlal-win-the-derby-resolves-on-the-league-result-12'
        );
    });

    it('is a path, not a sentence', () =>
    {
        expect(marketPath(market('Will BTC hit 100k?', 'CoinGecko close.'))).toBe(
            '/market/will-btc-hit-100k-coingecko-close-12'
        );
    });

    it('cuts a long question at a word, never mid-word', () =>
    {
        const slug = marketSlug(
            market(
                'Will the Iranian national football team reach the quarter finals of the next World Cup',
                'The official FIFA bracket decides it, and a withdrawal counts as not reaching them'
            )
        );
        // Nothing is left half-spelled, and no run of separators survives the cut.
        expect(slug).not.toMatch(/--/);
        expect(slug.endsWith('-12')).toBe(true);
        for (const word of slug.slice(0, -'-12'.length).split('-'))
        {
            expect(
                'will the iranian national football team reach the quarter finals of the next world cup the official fifa bracket decides it and a withdrawal counts as not reaching them'.split(
                    ' '
                )
            ).toContain(word);
        }
    });

    it('survives a title made of punctuation and emoji', () =>
    {
        // Legal on chain, and a path of nothing but digits would not resolve.
        const slug = marketSlug(market('🔥🔥🔥', '???', '7'));
        expect(slug).toBe('market-7');
        expect(marketIdFromSlug(slug)).toBe('7');
    });

    it('keeps a non-Latin question rather than dropping it', () =>
    {
        // The English variant is what a path is built from, but the rule itself must not
        // silently delete a script - the same slugifier writes tags in ten languages.
        expect(marketSlug(market('آیا استقلال برنده می‌شود؟', 'طبق نتیجه رسمی', '3'))).toBe(
            'آیا-استقلال-برنده-می-شود-طبق-نتیجه-رسمی-3'
        );
    });
});

describe('marketIdFromSlug', () =>
{
    it('reads the id back out whatever the words in front of it', () =>
    {
        expect(marketIdFromSlug('will-esteghlal-win-the-derby-12')).toBe('12');
        expect(marketIdFromSlug('market-7')).toBe('7');
        // A title ending in a number of its own does not confuse it: the LAST run wins.
        expect(marketIdFromSlug('will-btc-hit-100k-by-2030-45')).toBe('45');
    });

    it('refuses a path that names no market', () =>
    {
        // The old `/market/12` shape is not a shorter spelling of the new one - it is gone,
        // and answering it would leave two URLs competing for one page.
        expect(marketIdFromSlug('12')).toBe('');
        expect(marketIdFromSlug('')).toBe('');
        expect(marketIdFromSlug('will-esteghlal-win-the-derby')).toBe('');
    });

    it('round-trips whatever marketSlug produced', () =>
    {
        for (const [title, rules, id] of [
            ['Will it rain?', 'Tehran, tomorrow', '1'],
            ['🔥', '🔥', '999'],
            ['A question with 2026 in it', 'and 40 in the rules', '40']
        ] as const)
        {
            expect(marketIdFromSlug(marketSlug(market(title, rules, id)))).toBe(id);
        }
    });
});
