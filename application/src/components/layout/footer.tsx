import { Link } from 'react-router';

import { useLocale } from '../../stores/locale.store.ts';

import Icon from '../../icons/icon.tsx';
import type { IconName } from '../../icons/registry.ts';

import Tooltip from '../ui/tooltip.tsx';

// The project's channels, the same set nurachain.net links out with. Platform names are
// proper nouns: they are not translated and so do not go through the dictionary.
const SOCIALS: Array<{ label: string; href: string; icon: IconName }> = [
    { label: 'Telegram', href: 'https://t.me/nurachain', icon: 'brand-telegram' },
    { label: 'X', href: 'https://x.com/nurachainnet', icon: 'brand-x' },
    { label: 'Discord', href: 'https://discord.gg/8BMAXTdXQg', icon: 'brand-discord' },
    { label: 'Instagram', href: 'https://www.instagram.com/nura.chain/', icon: 'brand-instagram' },
    { label: 'GitHub', href: 'https://github.com/NuraChain', icon: 'brand-github' }
];

// The site footer: brand + tagline, one link column, a social row, and the honest legal line.
// Every link is a real destination - a footer full of dead anchors is its own defect.
export default function Footer() {
    const { t } = useLocale();

    const quiet = 'text-muted no-underline transition-colors duration-200 hover:text-text';
    const social =
        'flex h-10 w-10 items-center justify-center rounded-control text-muted transition-colors duration-200 hover:bg-overlay hover:text-text';

    return (
        <footer className="mt-10 border-t border-line bg-raised/40">
            <div className="shell py-10">
                <div className="grid grid-cols-1 gap-8 md:grid-cols-[1fr_auto]">
                    <div>
                        <div className="mb-2 flex items-center gap-2.5">
                            <span className="flex h-8 w-8 items-center justify-center rounded-control bg-gold-soft text-gold">
                                <Icon name="gavel" size={18} />
                            </span>
                            <span className="text-[17px] font-bold tracking-tight">{t('app.name')}</span>
                        </div>
                        <p className="mb-4 text-[14px] text-muted">{t('app.tagline')}</p>
                        <div className="flex gap-1">
                            {SOCIALS.map((entry) => (
                                <Tooltip key={entry.label} label={entry.label}>
                                    <a
                                        className={social}
                                        href={entry.href}
                                        target="_blank"
                                        rel="noreferrer"
                                        aria-label={entry.label}
                                    >
                                        <Icon name={entry.icon} size={18} />
                                    </a>
                                </Tooltip>
                            ))}
                        </div>
                    </div>

                    <nav aria-label={t('footer.product')}>
                        <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-faint">
                            {t('footer.product')}
                        </h2>
                        <ul className="grid grid-cols-1 gap-2 text-[14px]">
                            <li>
                                <Link className={quiet} to="/browse">
                                    {t('nav.browse')}
                                </Link>
                            </li>
                            <li>
                                <Link className={quiet} to="/portfolio">
                                    {t('nav.portfolio')}
                                </Link>
                            </li>
                            <li>
                                <Link className={quiet} to="/leaderboard">
                                    {t('nav.leaderboard')}
                                </Link>
                            </li>
                            <li>
                                <Link className={quiet} to="/settings">
                                    {t('nav.settings')}
                                </Link>
                            </li>
                        </ul>
                    </nav>
                </div>

                <div className="mt-8 border-t border-line pt-5">
                    <p className="mb-2 text-[13px] text-muted">{t('footer.rights')}</p>
                    <p className="text-[12px] leading-relaxed text-faint">{t('footer.disclaimer')}</p>
                </div>
            </div>
        </footer>
    );
}
