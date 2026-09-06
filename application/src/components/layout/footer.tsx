import { Link } from 'react-router';

import { useLocale } from '../../stores/locale.store.ts';

import { chain, explorerUrl } from '../../lib/chain.ts';

import Icon from '../../icons/icon.tsx';
import type { IconName } from '../../icons/registry.ts';

// The project's channels, the same set nurachain.net links out with. Platform names are
// proper nouns: they are not translated and so do not go through the dictionary.
const SOCIALS: Array<{ label: string; href: string; icon: IconName }> = [
    { label: 'Telegram', href: 'https://t.me/nurachain', icon: 'brand-telegram' },
    { label: 'X', href: 'https://x.com/nurachainnet', icon: 'brand-x' },
    { label: 'Discord', href: 'https://discord.gg/8BMAXTdXQg', icon: 'brand-discord' },
    { label: 'Instagram', href: 'https://www.instagram.com/nura.chain/', icon: 'brand-instagram' },
    { label: 'GitHub', href: 'https://github.com/NuraChain', icon: 'brand-github' }
];

// The network chip. A hairline pill rather than a filled badge: the footer already has one
// coloured element and a second one would compete with it.
const CHIP =
    'inline-flex h-8 shrink-0 items-center gap-2.5 rounded-full border border-line px-3 text-[12px] font-semibold text-muted';

// The footer closes the page with the four things this product owes a reader, in that order
// of prominence: who it is, where to go next, the chain the money actually settles on, and
// the legal line. Nothing else - every link here is a real destination, which is why there is
// no docs column and no careers column.
//
// The brand lockup is the one loud element and everything around it stays in the quiet ramp,
// so the eye lands once and then reads.
//
// The two link columns carry no headings. With icons on one and plain words on the other they
// are told apart at a glance, and an all-caps eyebrow over four self-evident words is
// decoration; each nav names itself for assistive tech instead.
export default function Footer() {
    const { t } = useLocale();

    const quiet = 'text-muted no-underline transition-colors duration-200 hover:text-text';
    const social = `${quiet} flex items-center gap-2.5`;

    const links = [
        { to: '/browse', label: t('nav.browse') },
        { to: '/portfolio', label: t('nav.portfolio') },
        { to: '/leaderboard', label: t('nav.leaderboard') },
        { to: '/settings', label: t('nav.settings') }
    ];

    // Chain name from the build config, so it costs no request and cannot drift from what the
    // app is pointed at. It is a Latin run inside an RTL layout - hence dir on the value, and
    // a hairline instead of a middot, which would sit on the wrong side of it.
    const chipBody = (
        <>
            <span className="text-faint">{t('footer.network')}</span>
            <span className="h-3 w-px bg-line" aria-hidden="true"></span>
            <span dir="ltr">{chain.name}</span>
        </>
    );

    return (
        <footer className="mt-12 border-t border-line bg-raised/40">
            <div className="shell py-12">
                <div className="grid grid-cols-2 gap-x-8 gap-y-10 md:grid-cols-[auto_auto_auto] md:justify-between md:gap-16">
                    <div className="col-span-2 min-w-0 md:col-span-1">
                        <div className="mb-3 flex items-center gap-3">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-gold-soft text-gold">
                                <Icon name="gavel" size={22} />
                            </span>
                            <span className="text-2xl font-bold tracking-tight">{t('app.name')}</span>
                        </div>

                        <p className="max-w-sm text-[15px] text-muted">{t('app.tagline')}</p>
                    </div>

                    {/* Optically aligned with the wordmark rather than with the top of the 40px
                         brand tile, so the columns and the lockup read as one line. */}
                    <nav className="md:pt-3" aria-label={t('footer.product')}>
                        <ul className="flex flex-col gap-3 text-[14px] font-semibold">
                            {links.map((link) => (
                                <li key={link.to}>
                                    <Link className={quiet} to={link.to}>
                                        {link.label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </nav>

                    {/* Named, not just marked. Five glyphs in a row said "we are on social media";
                         a column of names says which ones, and reads at any width. */}
                    <nav className="md:pt-3" aria-label={t('footer.social')}>
                        <ul className="flex flex-col gap-3 text-[14px] font-semibold">
                            {SOCIALS.map((entry) => (
                                <li key={entry.label}>
                                    <a className={social} href={entry.href} target="_blank" rel="noreferrer">
                                        <Icon name={entry.icon} size={16} className="shrink-0" />
                                        {entry.label}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </nav>
                </div>

                <div className="mt-10 flex flex-col items-start gap-4 border-t border-line pt-6 md:flex-row md:justify-between">
                    <div className="min-w-0">
                        <p className="text-[13px] text-muted">{t('footer.rights')}</p>
                        <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-faint">
                            {t('footer.disclaimer')}
                        </p>
                    </div>

                    {explorerUrl === null ? (
                        <span className={CHIP}>{chipBody}</span>
                    ) : (
                        <a
                            className={`${CHIP} no-underline transition-colors duration-200 hover:border-line-strong hover:text-text`}
                            href={explorerUrl}
                            target="_blank"
                            rel="noreferrer"
                        >
                            {chipBody}
                            <Icon name="external" size={12} className="text-faint" />
                        </a>
                    )}
                </div>
            </div>
        </footer>
    );
}
