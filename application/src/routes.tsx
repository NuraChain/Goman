import type { ReactElement } from 'react';

import Home from './pages/home.page.tsx';
import Browse from './pages/browse.page.tsx';
import MarketPage from './pages/market.page.tsx';
import Portfolio from './pages/portfolio.page.tsx';
import Leaderboard from './pages/leaderboard.page.tsx';
import Referrals from './pages/referrals.page.tsx';
import Settings from './pages/settings.page.tsx';
import Docs from './pages/docs.page.tsx';
import Admin from './pages/admin.page.tsx';

// The one route table. `app.tsx` renders it and nothing else enumerates routes, so adding a
// page is one row here plus the page itself.
//
// Every route renders on the client: this is a plain SPA build, and the server serves
// `dist/` with an index.html fallback so a deep link survives a hard reload.
export interface PageRoute {
    path: string;
    element: ReactElement;
}

export const routes: PageRoute[] = [
    { path: '/', element: <Home /> },
    { path: '/browse', element: <Browse /> },
    // The same screen as /browse, with the tag already applied. A tag is a place a reader
    // can be sent to and share, which a query string on another page does less well.
    { path: '/tag/:slug', element: <Browse /> },
    // The question IS the address; the id rides at the end of the slug where the router
    // finds it. See `marketPath` in wire.ts.
    { path: '/market/:slug', element: <MarketPage /> },
    { path: '/portfolio', element: <Portfolio /> },
    { path: '/leaderboard', element: <Leaderboard /> },
    { path: '/referrals', element: <Referrals /> },
    { path: '/settings', element: <Settings /> },
    { path: '/docs', element: <Docs /> },
    { path: '/admin', element: <Admin /> }
];
