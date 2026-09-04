import { BrowserRouter, Route, Routes } from 'react-router';

import { routes } from './routes.tsx';

import { ErrorBoundary } from './components/error-boundary.tsx';

import ErrorPage from './pages/error.page.tsx';
import NotFoundPage from './pages/not-found.page.tsx';

import Header from './components/layout/header.tsx';
import Footer from './components/layout/footer.tsx';
import TabBar from './components/layout/tab-bar.tsx';
import AuthSheet from './components/layout/auth-sheet.tsx';
import MenuSheet from './components/layout/menu-sheet.tsx';
import Toasts from './components/ui/toasts.tsx';

// The app frame: one viewport-high column where the SCROLL REGION is the inner div, not
// the window - so the scrollbar ends exactly where the tab bar begins, and the tab bar owns
// the full screen width below it. Inside the scroll region a min-h-full column pins the
// footer to the bottom of short pages. overflow-x-hidden is the belt-and-braces guard: no
// stray wide child may ever hand the page a horizontal scrollbar.
/**
 * The frame WITHOUT a router around it, so a test can mount it under `MemoryRouter` and drive
 * a route without touching browser history. Production always goes through `App` below.
 */
export function AppFrame() {
    return (
        <div className="flex h-dvh flex-col bg-surface text-text">
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                <div className="flex min-h-full flex-col">
                    <Header />
                    <main className="flex-1 pb-6">
                        {/* Inside the boundary: a page that throws swaps in the error page
                                instead of unmounting the tree to a blank screen. */}
                        <ErrorBoundary fallback={(_error, reset) => <ErrorPage reset={reset} />}>
                            <Routes>
                                {routes.map((route) => (
                                    <Route key={route.path} path={route.path} element={route.element} />
                                ))}
                                <Route path="*" element={<NotFoundPage />} />
                            </Routes>
                        </ErrorBoundary>
                    </main>
                    <Footer />
                </div>
            </div>
            <TabBar />
            <AuthSheet />
            <MenuSheet />
            <Toasts />
        </div>
    );
}

export default function App() {
    return (
        <BrowserRouter>
            <AppFrame />
        </BrowserRouter>
    );
}
