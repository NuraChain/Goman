import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './app.tsx';

// The client entry. `index.html` already stamped the saved theme and language onto <html>
// before the first paint, so the stores adopt that state rather than causing a flash.
const host = document.getElementById('root');
if (host === null) {
    throw new Error('No #root element - index.html and this entry disagree');
}

createRoot(host).render(
    <StrictMode>
        <App />
    </StrictMode>
);
