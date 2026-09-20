// The SSR half of the client, built by `vite build --ssr` into `dist-server/`.
//
// It exports the same route table the browser router mounts - one table, both halves - plus
// the per-url renderer `mountPages` calls on the server. Nothing else belongs here: anything
// this module reaches is in the server bundle, and the point of the split is that the server
// bundle is the app without the browser.
import { createPageRenderer } from '@azerothjs/kit/ssr';

import App from './App.azeroth';
import { routes } from './routes.ts';

export { routes };

export const renderPage = createPageRenderer(App, routes);
