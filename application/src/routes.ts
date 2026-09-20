import type { Route } from 'azerothjs';

import Home from './pages/home.page.azeroth';
import Browse from './pages/browse.page.azeroth';
import MarketPage from './pages/market.page.azeroth';
import Portfolio from './pages/portfolio.page.azeroth';
import Leaderboard from './pages/leaderboard.page.azeroth';
import Referrals from './pages/referrals.page.azeroth';
import Settings from './pages/settings.page.azeroth';
import Docs from './pages/docs.page.azeroth';
import Admin from './pages/admin.page.azeroth';

// The one route table. `App.azeroth` hands it to `createRouter` and nothing else enumerates
// routes, so adding a page is one row here plus the page itself.
export const routes: Route[] = [
    { path: '/', component: Home },
    { path: '/browse', component: Browse },
    // The same screen as /browse, with the tag already applied. A tag is a place a reader
    // can be sent to and share, which a query string on another page does less well.
    { path: '/tag/:slug', component: Browse },
    // The question IS the address; the id rides at the end of the slug where the router
    // finds it. See `marketPath` in wire.ts.
    { path: '/market/:slug', component: MarketPage },
    { path: '/portfolio', component: Portfolio },
    { path: '/leaderboard', component: Leaderboard },
    { path: '/referrals', component: Referrals },
    { path: '/settings', component: Settings },
    { path: '/docs', component: Docs },
    { path: '/admin', component: Admin }
];
