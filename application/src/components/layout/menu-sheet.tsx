import { Link } from 'react-router';

import { useLocale } from '../../stores/locale.store.ts';
import { useTheme } from '../../stores/theme.store.ts';
import { useChrome } from '../../stores/chrome.store.ts';
import { useAdmin } from '../../stores/admin.store.ts';

import { LANGS } from '../../i18n/langs.ts';

import Icon from '../../icons/icon.tsx';

import Sheet from '../ui/sheet.tsx';
import Chip from '../ui/chip.tsx';
import Flag from '../ui/flag.tsx';

// The mobile Menu tab's sheet: the destinations the tab bar has no room for, plus the two
// global switches. Navigating closes the sheet - it never lingers over a new page.
export default function MenuSheet() {
    const { t, lang, setLang } = useLocale();
    const appearance = useTheme();
    const chrome = useChrome();
    const admin = useAdmin();

    const row =
        'flex h-12 items-center gap-3 rounded-control px-3 text-[15px] font-semibold text-text no-underline transition-colors duration-200 hover:bg-overlay';

    return (
        <Sheet open={chrome.menuOpen()} title={t('nav.menu')} onClose={() => chrome.close()}>
            <div className="flex flex-col gap-1">
                <Link className={row} to="/leaderboard" onClick={() => chrome.close()}>
                    <Icon name="trophy" size={20} className="text-gold" />
                    <span>{t('nav.leaderboard')}</span>
                    <Icon name="chevron-right" size={17} className="ms-auto text-faint" />
                </Link>
                <Link className={row} to="/settings" onClick={() => chrome.close()}>
                    <Icon name="settings" size={20} className="text-muted" />
                    <span>{t('nav.settings')}</span>
                    <Icon name="chevron-right" size={17} className="ms-auto text-faint" />
                </Link>
                {admin.isAdmin() && (
                    <Link className={row} to="/admin" onClick={() => chrome.close()}>
                        <Icon name="gavel" size={20} className="text-brand" />
                        <span>{t('admin.title')}</span>
                        <Icon name="chevron-right" size={17} className="ms-auto text-faint" />
                    </Link>
                )}

                <div className="my-3 h-px bg-line" aria-hidden="true"></div>

                <div className="flex items-center justify-between px-3 py-2">
                    <span className="text-[14px] font-semibold text-muted">{t('nav.theme')}</span>
                    <div className="flex gap-2">
                        <Chip
                            icon="moon"
                            selected={appearance.theme() === 'dark'}
                            onSelect={() => appearance.setTheme('dark')}
                        >
                            {t('nav.themeDark')}
                        </Chip>
                        <Chip
                            icon="sun"
                            selected={appearance.theme() === 'light'}
                            onSelect={() => appearance.setTheme('light')}
                        >
                            {t('nav.themeLight')}
                        </Chip>
                    </div>
                </div>
                {/* Ten languages do not fit the label-and-controls row the theme switch uses, so
                     this one stacks: label above, a wrapping grid of endonyms below. */}
                <div className="flex flex-col gap-2 px-3 py-2">
                    <span className="text-[14px] font-semibold text-muted">{t('nav.language')}</span>
                    <div className="flex flex-wrap gap-2">
                        {LANGS.map((row_) => (
                            <span key={row_.code} lang={row_.code}>
                                <Chip selected={lang() === row_.code} onSelect={() => setLang(row_.code)}>
                                    <Flag code={row_.flag} />
                                    {row_.endonym}
                                </Chip>
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        </Sheet>
    );
}
