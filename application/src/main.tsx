import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './app.tsx';

import { captureRefCode } from './stores/referrals.store.ts';

// The client entry. `index.html` already stamped the saved theme and language onto <html>
// before the first paint, so the stores adopt that state rather than causing a flash.
const host = document.getElementById('root');
if (host === null) {
    throw new Error('No #root element - index.html and this entry disagree');
}

// Before the first render: a `?ref=` code is a fact about how this visit STARTED, and the
// router rewrites the URL as soon as it mounts.
captureRefCode();

// The service worker is what makes the app installable and what keeps a dropped connection
// from swapping the page for a browser error. Registered after load so it never competes with
// the first paint, and only in a production build - in dev it would serve a cached module over
// the one Vite just rebuilt and turn every edit into a mystery.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        void navigator.serviceWorker.register('/sw.js').catch(() => {
            // A refused registration (private mode, an http origin) costs offline support and
            // nothing else. It must never take the page down with it.
        });
    });
}

createRoot(host).render(
    <StrictMode>
        <App />
    </StrictMode>
);
