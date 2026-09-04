import { useCallback, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';

import { client } from '../../api.ts';

import { shortAddress, addressGradient } from '../../lib/wallet.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { useTheme } from '../../stores/theme.store.ts';
import { useChrome } from '../../stores/chrome.store.ts';
import { useSession } from '../../stores/session.store.ts';
import { useToasts } from '../../stores/toasts.store.ts';
import { useAdmin } from '../../stores/admin.store.ts';

import { useDismiss } from '../../hooks/use-dismiss.ts';
import { useRovingFocus } from '../../hooks/use-roving-focus.ts';
import { useResource } from '../../hooks/use-resource.ts';

import { formatMoney } from '../../i18n/format.ts';
import { LANGS, langRow } from '../../i18n/langs.ts';

import Icon from '../../icons/icon.tsx';

import Button from '../ui/button.tsx';
import Tooltip from '../ui/tooltip.tsx';
import Skeleton from '../ui/skeleton.tsx';
import MenuPanel from '../ui/menu-panel.tsx';
import MenuItem from '../ui/menu-item.tsx';

export default function Header() {
    const { t, lang, setLang } = useLocale();
    const appearance = useTheme();
    const chrome = useChrome();
    const session = useSession();
    const toasts = useToasts();
    const admin = useAdmin();
    const navigate = useNavigate();

    const [accountOpen, setAccountOpen] = useState(false);
    const [langOpen, setLangOpen] = useState(false);

    const menuRoot = useRef<HTMLDivElement>(null);
    const avatarButton = useRef<HTMLButtonElement>(null);
    const langRoot = useRef<HTMLDivElement>(null);
    const langButton = useRef<HTMLButtonElement>(null);

    const summary = useResource(
        () => (session.connected() ? session.address() : false),
        (address: string) => client.portfolio.summary({ query: { address } })
    );

    const closeAccount = useCallback(() => setAccountOpen(false), []);
    const closeLang = useCallback(() => setLangOpen(false), []);

    useDismiss({ open: accountOpen, onClose: closeAccount, root: menuRoot, trigger: avatarButton });
    useDismiss({ open: langOpen, onClose: closeLang, root: langRoot, trigger: langButton });

    const goTo = (path: string): void => {
        setAccountOpen(false);
        void navigate(path);
    };

    const onMenuKeys = useRovingFocus({ open: accountOpen, root: menuRoot });
    const onLangKeys = useRovingFocus({ open: langOpen, root: langRoot });

    const navClass =
        'rounded-control px-3 py-2 text-[14px] font-semibold no-underline transition-colors duration-200 hover:bg-overlay hover:text-text';

    return (
        <header className="sticky top-0 z-[var(--z-header)] border-b border-line bg-chrome backdrop-blur-md">
            <div className="shell flex h-14 items-center gap-1">
                <Link to="/" className="me-2 flex items-center gap-2.5 text-text no-underline">
                    <span className="flex h-8 w-8 items-center justify-center rounded-control bg-gold-soft text-gold">
                        <Icon name="gavel" size={18} />
                    </span>
                    <span className="text-[17px] font-bold tracking-tight max-[380px]:hidden">{t('app.name')}</span>
                </Link>

                <nav className="hidden items-center gap-1 lg:flex" aria-label={t('nav.menu')}>
                    <NavLink
                        className={({ isActive }) => `${navClass} ${isActive ? 'text-text' : 'text-muted'}`}
                        to="/browse"
                    >
                        {t('nav.browse')}
                    </NavLink>
                    <NavLink
                        className={({ isActive }) => `${navClass} ${isActive ? 'text-text' : 'text-muted'}`}
                        to="/portfolio"
                    >
                        {t('nav.portfolio')}
                    </NavLink>
                    <NavLink
                        className={({ isActive }) => `${navClass} ${isActive ? 'text-text' : 'text-muted'}`}
                        to="/leaderboard"
                    >
                        {t('nav.leaderboard')}
                    </NavLink>
                    {admin.isAdmin() && (
                        <NavLink
                            className={({ isActive }) => `${navClass} ${isActive ? 'text-text' : 'text-muted'}`}
                            to="/admin"
                        >
                            {t('admin.title')}
                        </NavLink>
                    )}
                </nav>

                <div className="ms-auto flex items-center gap-1">
                    <div className="hidden items-center gap-1 lg:flex">
                        <Tooltip label={t('nav.theme')}>
                            <button
                                className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-control text-muted transition-colors duration-200 hover:bg-overlay hover:text-text active:scale-95"
                                type="button"
                                aria-label={t('nav.theme')}
                                onClick={() => appearance.toggle()}
                            >
                                <Icon name={appearance.theme() === 'dark' ? 'sun' : 'moon'} size={20} />
                            </button>
                        </Tooltip>
                        <div className="relative" ref={langRoot} onKeyDown={onLangKeys}>
                            <Tooltip label={t('nav.language')}>
                                <button
                                    ref={langButton}
                                    className="flex h-11 min-w-11 cursor-pointer items-center justify-center gap-1.5 rounded-control px-2 text-muted transition-colors duration-200 hover:bg-overlay hover:text-text active:scale-95"
                                    type="button"
                                    aria-label={t('nav.language')}
                                    aria-haspopup="menu"
                                    aria-expanded={langOpen}
                                    onClick={() => setLangOpen((current) => !current)}
                                >
                                    <Icon name="language" size={20} />
                                    <span className="text-[13px] font-semibold">{langRow(lang()).badge}</span>
                                </button>
                            </Tooltip>
                            {langOpen && (
                                <MenuPanel label={t('nav.language')} width="w-48">
                                    {/* Ten rows overflow a short viewport; the panel scrolls rather than
                                         pushing the last languages under the fold. */}
                                    <div className="max-h-[min(70vh,22rem)] overflow-y-auto">
                                        {LANGS.map((row) => (
                                            <button
                                                key={row.code}
                                                className={
                                                    lang() === row.code
                                                        ? 'flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-control bg-raised px-3 text-[14px] font-semibold text-text'
                                                        : 'flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-control px-3 text-[14px] font-semibold text-text transition-colors duration-200 hover:bg-raised'
                                                }
                                                type="button"
                                                role="menuitemradio"
                                                aria-checked={lang() === row.code}
                                                lang={row.code}
                                                onClick={() => {
                                                    setLangOpen(false);
                                                    setLang(row.code);
                                                }}
                                            >
                                                {/* The check keeps its column whether or not it is drawn, so the
                                                     endonyms stay on one edge instead of jittering row to row. */}
                                                <span className="flex w-4 shrink-0 justify-center text-brand">
                                                    {lang() === row.code && <Icon name="check" size={16} />}
                                                </span>
                                                <span className="min-w-0 flex-1 truncate text-start">
                                                    {row.endonym}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </MenuPanel>
                            )}
                        </div>
                    </div>

                    {session.connected() ? (
                        <>
                            <Link
                                to="/portfolio"
                                className="nums me-1 hidden flex-col items-end text-end no-underline sm:flex"
                            >
                                <span className="text-[11px] leading-tight text-muted">{t('portfolio.title')}</span>
                                {summary.loading() ? (
                                    <Skeleton className="mt-0.5 h-3.5 w-14 rounded" />
                                ) : (
                                    <span className="text-[13px] font-bold leading-tight text-brand">
                                        {formatMoney(summary.data()?.current ?? 0, lang(), { compact: true })}
                                    </span>
                                )}
                            </Link>
                            <div className="relative" ref={menuRoot} onKeyDown={onMenuKeys}>
                                <Tooltip label={t('settings.account')}>
                                    <button
                                        ref={avatarButton}
                                        className="flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-full ring-2 ring-line transition duration-200 hover:ring-brand active:scale-95"
                                        type="button"
                                        aria-label={shortAddress(session.address())}
                                        aria-haspopup="menu"
                                        aria-expanded={accountOpen}
                                        onClick={() => setAccountOpen((current) => !current)}
                                    >
                                        <span
                                            className="h-full w-full"
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
                        <span className="ms-1">
                            <Button size="sm" onClick={() => chrome.openAuth()}>
                                {t('nav.connect')}
                            </Button>
                        </span>
                    )}
                </div>
            </div>
        </header>
    );
}
