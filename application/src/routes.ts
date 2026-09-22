import type { PageRoute } from '@azerothjs/kit';

import { loadMarket } from './loaders.ts';

import Home from './pages/home.page.azeroth';
import Browse from './pages/browse.page.azeroth';
import MarketPage from './pages/market.page.azeroth';
import Portfolio from './pages/portfolio.page.azeroth';
import Leaderboard from './pages/leaderboard.page.azeroth';
import Referrals from './pages/referrals.page.azeroth';
import Settings from './pages/settings.page.azeroth';
import Docs from './pages/docs.page.azeroth';
import Admin from './pages/admin.page.azeroth';

// The one route table. `App.azeroth` hands it to `createRouter`, `entry.server.ts` hands the
// same rows to the page renderer, and nothing else enumerates routes - so adding a page is one
// row here plus the page itself.
//
// `render` is the only thing the server needs that the browser does not. A page is `'server'`
// when it is PUBLIC and worth finding: the markup a crawler reads is the markup a reader gets,
// and the title and description are the market's own rather than one static `<title>Goman</title>`
// for the whole site. A page is `'client'` when it needs a wallet - it reads the connected
// account, which the server cannot know, so rendering it there buys a skeleton and a `Vary`.
//
export const routes: PageRoute[] = [
    { path: '/', component: Home, render: 'server' },
    { path: '/browse', component: Browse, render: 'server' },
    // The same screen as /browse, with the tag already applied. A tag is a place a reader
    // can be sent to and share, which a query string on another page does less well.
    { path: '/tag/:slug', component: Browse, render: 'server' },
    // The question IS the address; the id rides at the end of the slug where the router
    // finds it. See `marketPath` in wire.ts.
    { path: '/market/:slug', component: MarketPage, render: 'server', loader: loadMarket },
    { path: '/leaderboard', component: Leaderboard, render: 'server' },
    { path: '/docs', component: Docs, render: 'server' },
    { path: '/portfolio', component: Portfolio, render: 'client' },
    { path: '/referrals', component: Referrals, render: 'client' },
    { path: '/settings', component: Settings, render: 'client' },
    { path: '/admin', component: Admin, render: 'client' }
];
