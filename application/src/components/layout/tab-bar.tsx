import { NavLink } from 'react-router';

import { useLocale } from '../../stores/locale.store.ts';
import { useChrome } from '../../stores/chrome.store.ts';

import Icon from '../../icons/icon.tsx';
import type { IconName } from '../../icons/registry.ts';

// The mobile app frame: a real bottom tab bar, not shrunk desktop nav. Hidden at lg+ where
// the header carries navigation. STATIC in the app column (not an overlay): the scroll
// region ends above it, so the page scrollbar never runs beside or under the bar and the
// bar owns the full screen width. Safe-area padded for gesture-nav phones.
export default function TabBar() {
    const { t } = useLocale();
    const chrome = useChrome();

    const base =
        'flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold no-underline transition-colors duration-200';

    const tabs: Array<{ to: string; icon: IconName; label: string; end?: boolean }> = [
        { to: '/', icon: 'home', label: t('nav.home'), end: true },
        { to: '/browse', icon: 'compass', label: t('nav.browse') },
        { to: '/portfolio', icon: 'wallet', label: t('nav.portfolio') }
    ];

    return (
        <nav
            className="shrink-0 border-t border-line bg-raised pb-[env(safe-area-inset-bottom)] lg:hidden"
            aria-label={t('nav.menu')}
        >
            <div className="grid h-[var(--tabbar-h)] grid-cols-4">
                {tabs.map((tab) => (
                    <NavLink
                        key={tab.to}
                        to={tab.to}
                        end={tab.end}
                        className={({ isActive }) => `${base} ${isActive ? 'text-brand' : 'text-muted'}`}
                    >
                        <Icon name={tab.icon} size={22} />
                        <span>{tab.label}</span>
                    </NavLink>
                ))}
                <button
                    className={`${base} cursor-pointer text-muted hover:text-text`}
                    type="button"
                    onClick={() => chrome.openMenu()}
                >
                    <Icon name="menu" size={22} />
                    <span>{t('nav.menu')}</span>
                </button>
            </div>
        </nav>
    );
}
