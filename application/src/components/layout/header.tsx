import { useCallback, useRef, useState } from 'react';
import { Link, NavLink, useNavigate, useSearchParams } from 'react-router';

import { client } from '../../api.ts';

import { shortAddress, addressGradient } from '../../lib/wallet.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { useTheme } from '../../stores/theme.store.ts';
import { useChrome } from '../../stores/chrome.store.ts';
import { useSession } from '../../stores/session.store.ts';
import { useToasts } from '../../stores/toasts.store.ts';
import { useAdmin } from '../../stores/admin.store.ts';
import { useOnchain } from '../../stores/onchain.store.ts';

import { useDismiss } from '../../hooks/use-dismiss.ts';
import { useRovingFocus } from '../../hooks/use-roving-focus.ts';
import { useResource } from '../../hooks/use-resource.ts';

import { formatMoney } from '../../i18n/format.ts';
import { langRow } from '../../i18n/langs.ts';

import Icon from '../../icons/icon.tsx';

import Button from '../ui/button.tsx';
import Input from '../ui/input.tsx';
import Tooltip from '../ui/tooltip.tsx';
import Skeleton from '../ui/skeleton.tsx';
import Flag from '../ui/flag.tsx';
import MenuPanel from '../ui/menu-panel.tsx';
import MenuItem from '../ui/menu-item.tsx';

import { iconButtonClass } from '../ui/variants.ts';

// The active route is marked by the header's OWN bottom hairline thickening to 2px under the
// item, not by a colour swap - colour alone was the whole signal before, and it is the one
// thing this design system says never to lean on. Inactive items preview the mark in
// --line-strong on hover, so the affordance and the state are the same object.
const NAV_BASE =
    'relative flex h-14 items-center px-3 text-[14px] font-semibold no-underline transition-colors duration-200 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5';

function navClass(active: boolean): string {
    return active
        ? `${NAV_BASE} text-text after:bg-brand`
        : `${NAV_BASE} text-muted after:bg-transparent hover:text-text hover:after:bg-line-strong`;
}

// Outlined rather than filled: the bar is translucent chrome, and an opaque pill sitting on it
// fights the blur. It also keeps ONE filled element in the header - the primary action.
const CLUSTER_BUTTON =
    'flex h-9 cursor-pointer items-center justify-center rounded-sm text-muted transition-colors duration-200 hover:bg-overlay hover:text-text active:scale-95';

export default function Header() {
    const { t, lang } = useLocale();
    const appearance = useTheme();
    const chrome = useChrome();
    const session = useSession();
    const toasts = useToasts();
    const admin = useAdmin();
    const onchain = useOnchain();
    const navigate = useNavigate();

    const [accountOpen, setAccountOpen] = useState(false);

    const menuRoot = useRef<HTMLDivElement>(null);
    const avatarButton = useRef<HTMLButtonElement>(null);

    // `writes` is part of the key, not decoration: the pill reads the wallet's on-chain
    // balance, and a trade or a claim changes it. Keyed on the address alone it kept showing
    // what the wallet held BEFORE the transaction the visitor just watched confirm.
    const summary = useResource(
        () => (session.connected() ? { address: session.address(), writes: onchain.writes() } : false),
        (key: { address: string }) => client.portfolio.summary({ query: { address: key.address } })
    );

    const closeAccount = useCallback(() => setAccountOpen(false), []);

    useDismiss({ open: accountOpen, onClose: closeAccount, root: menuRoot, trigger: avatarButton });

    const goTo = (path: string): void => {
        setAccountOpen(false);
        void navigate(path);
    };

    const onMenuKeys = useRovingFocus({ open: accountOpen, root: menuRoot });

    // The header field does not search on its own - it hands the term to /browse, which owns
    // the debounce, the filters, the pagination and the one server-side query. Two search
    // implementations against the same index is how they drift.
    //
    // `?q=` is the shared state between the two fields, in both directions: submitting here
    // writes it, and editing the field ON /browse writes it back, so the bar never contradicts
    // the page under it. Leaving /browse drops the param, which empties this field.
    const [params] = useSearchParams();
    const q = params.get('q') ?? '';

    const [term, setTerm] = useState(q);
    const [lastQ, setLastQ] = useState(q);

    if (q !== lastQ) {
        setLastQ(q);
        setTerm(q);
    }

    const submitSearch = (): void => {
        const trimmed = term.trim();
        void navigate(trimmed === '' ? '/browse' : `/browse?q=${encodeURIComponent(trimmed)}`);
    };

    const links: Array<{ to: string; label: string }> = [
        { to: '/browse', label: t('nav.browse') },
        { to: '/portfolio', label: t('nav.portfolio') },
        { to: '/leaderboard', label: t('nav.leaderboard') }
    ];

    if (admin.isAdmin()) {
        links.push({ to: '/admin', label: t('admin.title') });
    }

    // The control names the theme it switches TO, not the setting it belongs to. "Theme" told
    // you which drawer you were in; "Light" tells you what the click does.
    const themeAction = appearance.theme() === 'dark' ? t('nav.themeLight') : t('nav.themeDark');

    // The WALLET's native balance, not `current` - that is the mark-to-market value of open
    // positions, which is what the portfolio's own "Positions value" tile is for. Behind a
    // wallet glyph, in the slot the Connect button vacated, it can only read as spendable.
    const balanceLoading = summary.loading();
    const balance = formatMoney(summary.data()?.balance ?? 0, lang(), { compact: true });

    return (
        <header className="sticky top-0 z-[var(--z-header)] border-b border-line bg-chrome backdrop-blur-md">
            <div className="shell flex h-14 items-center gap-1">
                <Link to="/" className="flex items-center gap-2.5 text-text no-underline">
                    <span className="flex h-8 w-8 items-center justify-center rounded-control bg-gold-soft text-gold">
                        <Icon name="gavel" size={18} />
                    </span>
                    <span className="text-[17px] font-bold tracking-tight max-[380px]:hidden">{t('app.name')}</span>
                </Link>

                {/* Identity ends, wayfinding begins. One hairline says that; 8px of margin did not. */}
                <span className="mx-3 hidden h-6 w-px bg-line lg:block" aria-hidden="true"></span>

                <nav className="hidden items-center lg:flex" aria-label={t('nav.menu')}>
                    {links.map((link) => (
                        <NavLink key={link.to} className={({ isActive }) => navClass(isActive)} to={link.to}>
                            {link.label}
                        </NavLink>
                    ))}
                </nav>

                <div className="ms-2 hidden min-w-0 max-w-xs flex-1 md:block" role="search">
                    <Input
                        size="sm"
                        icon="search"
                        label={t('nav.search')}
                        placeholder={t('nav.search')}
                        value={term}
                        onInput={setTerm}
                        onEnter={submitSearch}
                    />
                </div>

                <div className="ms-auto flex items-center gap-2">
                    {/* Too narrow for a field; the browse page's own search is one tap away. */}
                    <Link to="/browse" className={`${iconButtonClass('lg')} md:hidden`} aria-label={t('nav.search')}>
                        <Icon name="search" size={20} />
                    </Link>

                    {/* Theme and language are one control group, not two loose icons beside a button. */}
                    <div className="hidden items-center rounded-sm border border-line lg:flex">
                        <Tooltip label={themeAction}>
                            <button
                                className={`${CLUSTER_BUTTON} w-9`}
                                type="button"
                                aria-label={themeAction}
                                onClick={() => appearance.toggle()}
                            >
                                <Icon name={appearance.theme() === 'dark' ? 'sun' : 'moon'} size={18} />
                            </button>
                        </Tooltip>

                        <span className="h-5 w-px bg-line" aria-hidden="true"></span>

                        <Tooltip label={t('nav.language')}>
                            <button
                                className={`${CLUSTER_BUTTON} gap-2 px-3`}
                                type="button"
                                aria-label={t('nav.language')}
                                aria-haspopup="dialog"
                                onClick={() => chrome.openLang()}
                            >
                                <Flag code={langRow(lang()).flag} />
                                <span className="text-[13px] font-semibold">{langRow(lang()).badge}</span>
                            </button>
                        </Tooltip>
                    </div>

                    {session.connected() ? (
                        <>
                            {/* One line, and the only soft fill in the bar. Connect is gone in this
                                 state, so the balance inherits the anchor the button had; the stacked
                                 label/value pair it replaces read as something fallen out of a card.
                                 Shown on mobile too - the value is compact, it fits beside a 44px
                                 avatar at 390px, and the bar was otherwise a logo and empty space. */}
                            <Link
                                to="/portfolio"
                                className="nums flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-brand-soft px-3 text-[13px] font-bold text-brand no-underline transition duration-200 hover-tint"
                                aria-label={
                                    balanceLoading ? t('portfolio.balance') : `${t('portfolio.balance')}: ${balance}`
                                }
                                aria-busy={balanceLoading}
                            >
                                <Icon name="wallet" size={16} />
                                {balanceLoading ? <Skeleton className="h-3.5 w-12 rounded" /> : balance}
                            </Link>

                            <div className="relative" ref={menuRoot} onKeyDown={onMenuKeys}>
                                <Tooltip label={t('settings.account')}>
                                    {/* 36px of avatar inside a 44px target: the gradient is the
                                         identity, the touch area is the control. */}
                                    <button
                                        ref={avatarButton}
                                        className="group flex h-11 w-11 cursor-pointer items-center justify-center rounded-full transition-colors duration-200 hover:bg-overlay active:scale-95"
                                        type="button"
                                        aria-label={shortAddress(session.address())}
                                        aria-haspopup="menu"
                                        aria-expanded={accountOpen}
                                        onClick={() => setAccountOpen((current) => !current)}
                                    >
                                        <span
                                            className="h-9 w-9 overflow-hidden rounded-full ring-2 ring-line transition duration-200 group-hover:ring-brand"
                                            style={{ background: addressGradient(session.address()) }}
                                            aria-hidden="true"
                                        ></span>
                                    </button>
                                </Tooltip>
                                {accountOpen && (
                                    <MenuPanel label={t('nav.menu')}>
                                        <div className="border-b border-line px-3 pb-2.5 pt-2">
                                            <p className="nums latin-nums text-[14px] font-bold" dir="ltr">
                                                {shortAddress(session.address())}
                                            </p>
                                            <p className="text-[12px] text-faint">{session.wallet() ?? ''}</p>
                                        </div>
                                        <MenuItem icon="wallet" onSelect={() => goTo('/portfolio')}>
                                            {t('nav.portfolio')}
                                        </MenuItem>
                                        <MenuItem icon="share" onSelect={() => goTo('/referrals')}>
                                            {t('referral.title')}
                                        </MenuItem>
                                        <MenuItem icon="trophy" onSelect={() => goTo('/leaderboard')}>
                                            {t('nav.leaderboard')}
                                        </MenuItem>
                                        <MenuItem icon="settings" onSelect={() => goTo('/settings')}>
                                            {t('nav.settings')}
                                        </MenuItem>
                                        {admin.isAdmin() && (
                                            <MenuItem icon="gavel" onSelect={() => goTo('/admin')}>
                                                {t('admin.title')}
                                            </MenuItem>
                                        )}
                                        <div className="my-1 h-px bg-line" aria-hidden="true"></div>
                                        <MenuItem
                                            icon="log-out"
                                            danger
                                            onSelect={() => {
                                                setAccountOpen(false);
                                                session.disconnect();
                                                toasts.push('info', t('toast.disconnected'), 'log-out');
                                            }}
                                        >
                                            {t('profile.disconnect')}
                                        </MenuItem>
                                    </MenuPanel>
                                )}
                            </div>
                        </>
                    ) : (
                        <Button size="sm" onClick={() => chrome.openAuth()}>
                            {t('nav.connect')}
                        </Button>
                    )}
                </div>
            </div>
        </header>
    );
}
