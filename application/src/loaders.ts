// What the server fetches BEFORE it renders a public page.
//
// The point is the head, not the body: a crawler reads what the first response contains, and
// until now every route shipped the same static `<title>Goman</title>`. A loader runs on the
// server through the in-process api bridge - no socket, the visitor's own identity, the page's
// own origin - and the result rides to the browser in the handoff, so hydration adopts it
// rather than fetching the same thing a second time.
//
// Loaders live here rather than in routes.ts because the route table ships to the browser and
// wants to stay a table.
import { client, marketIdFromSlug, type Market } from './api.ts';
import { notFound, type RouteLoaderArgs } from 'azerothjs';

/** What a market page needs before it can name itself. */
export interface MarketLoaded {
    market: Market;
}

export async function loadMarket(args: RouteLoaderArgs): Promise<MarketLoaded>
{
    const id = marketIdFromSlug(args.params['slug'] ?? '');
    if (id === '')
    {
        // A path that names no market: the old `/market/12` shape, or a typo. `notFound()` is
        // what makes the response a real 404 rather than a 200 carrying a not-found page -
        // which matters here precisely because these URLs are the ones crawlers hold.
        throw notFound();
    }
    try
    {
        return { market: await client.markets.one({ params: { id } }) };
    }
    catch
    {
        // An id the indexer has never heard of reads the same to a visitor as a typo, and
        // should read the same to a crawler.
        throw notFound();
    }
}
