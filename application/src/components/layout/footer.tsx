import { Link } from 'react-router';

import { useLocale } from '../../stores/locale.store.ts';

import Icon from '../../icons/icon.tsx';

import Tooltip from '../ui/tooltip.tsx';

// The site footer: brand + tagline, link columns, a social row, and the honest legal line.
// Every link is a real destination - a footer full of dead anchors is its own defect.
export default function Footer() {
    const { t } = useLocale();

    const quiet = 'text-muted no-underline transition-colors duration-200 hover:text-text';
    const social =
        'flex h-10 w-10 items-center justify-center rounded-control text-muted transition-colors duration-200 hover:bg-overlay hover:text-text';

    return (
        <footer className="mt-10 border-t border-line bg-raised/40">
            <div className="shell py-10">
                <div className="grid grid-cols-1 gap-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
                    <div>
                        <div className="mb-2 flex items-center gap-2.5">
                            <span className="flex h-8 w-8 items-center justify-center rounded-control bg-gold-soft text-gold">
                                <Icon name="gavel" size={18} />
                            </span>
                            <span className="text-[17px] font-bold tracking-tight">{t('app.name')}</span>
                        </div>
                        <p className="mb-4 text-[14px] text-muted">{t('app.tagline')}</p>
                        <div className="flex gap-1">
                            <Tooltip label={t('footer.contact')}>
                                <a
                                    className={social}
                                    href="mailto:intelligentquantum@example.org"
                                    aria-label={t('footer.contact')}
                                >
                                    <Icon name="mail" size={18} />
                                </a>
                            </Tooltip>
                            <Tooltip label={t('footer.community')}>
                                <a
                                    className={social}
                                    href="mailto:intelligentquantum@example.org"
                                    aria-label={t('footer.community')}
                                >
                                    <Icon name="send" size={18} />
                                </a>
                            </Tooltip>
                            <Tooltip label={t('footer.community')}>
                                <a
                                    className={social}
                                    href="mailto:intelligentquantum@example.org"
                                    aria-label={t('footer.community')}
                                >
                                    <Icon name="messages" size={18} />
                                </a>
                            </Tooltip>
                        </div>
                    </div>

                    <nav aria-label={t('footer.markets')}>
                        <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-faint">
                            {t('footer.markets')}
                        </h2>
                        <ul className="grid grid-cols-1 gap-2 text-[14px]">
                            <li>
                                <Link className={quiet} to="/browse">
                                    {t('categories.politics')}
                                </Link>
                            </li>
                            <li>
                                <Link className={quiet} to="/browse">
                                    {t('categories.crypto')}
                                </Link>
                            </li>
                            <li>
                                <Link className={quiet} to="/browse">
                                    {t('categories.sports')}
                                </Link>
                            </li>
                            <li>
                                <Link className={quiet} to="/browse">
                                    {t('categories.economy')}
                                </Link>
                            </li>
                            <li>
                                <Link className={quiet} to="/browse">
                                    {t('categories.tech')}
                                </Link>
                            </li>
                        </ul>
                    </nav>

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

                    <nav aria-label={t('footer.community')}>
                        <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-faint">
                            {t('footer.community')}
                        </h2>
                        <ul className="grid grid-cols-1 gap-2 text-[14px]">
                            <li>
                                <a className={quiet} href="https://github.com" target="_blank" rel="noreferrer">
                                    GitHub
                                </a>
                            </li>
                            <li>
                                <a className={quiet} href="mailto:intelligentquantum@example.org">
                                    {t('footer.contact')}
                                </a>
                            </li>
                        </ul>
                    </nav>
                </div>

                <div className="mt-8 border-t border-line pt-5">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
                        <p className="text-[13px] text-muted">{t('footer.rights')}</p>
                        {/* The credit carries a LINK rather than living inside the translated
                            `rights` string: a name embedded in prose cannot be clicked, and it
                            would have to be re-embedded correctly in every language added later. */}
                        <p className="shrink-0 text-[13px] text-muted">
                            {t('footer.builtWith')}{' '}
                            <a className={quiet} href="https://react.dev" target="_blank" rel="noreferrer">
                                <span dir="ltr">React</span>
                            </a>
                        </p>
                    </div>
                    <p className="text-[12px] leading-relaxed text-faint">{t('footer.disclaimer')}</p>
                </div>
            </div>
        </footer>
    );
}
