import { useLocale } from '../../stores/locale.store.ts';
import { useChrome } from '../../stores/chrome.store.ts';

import { LANGS } from '../../i18n/langs.ts';

import Icon from '../../icons/icon.tsx';

import Sheet from '../ui/sheet.tsx';
import Flag from '../ui/flag.tsx';

// The language picker on the app's ONE overlay surface rather than in a dropdown anchored to
// a 36px button: ten rows scrolled inside that panel, and the same list now serves the header
// and the mobile menu identically instead of existing twice in two shapes.
const ROW =
    'flex h-12 w-full cursor-pointer items-center gap-3 rounded-control px-3 text-[14px] font-semibold text-text';

export default function LangSheet() {
    const { t, lang, setLang } = useLocale();
    const chrome = useChrome();

    return (
        <Sheet open={chrome.langOpen()} title={t('nav.language')} onClose={() => chrome.close()}>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2" role="radiogroup" aria-label={t('nav.language')}>
                {LANGS.map((row) => (
                    <button
                        key={row.code}
                        className={
                            lang() === row.code
                                ? `${ROW} border border-brand bg-brand-soft`
                                : `${ROW} border border-line transition-colors duration-200 hover:bg-overlay`
                        }
                        type="button"
                        role="radio"
                        aria-checked={lang() === row.code}
                        lang={row.code}
                        onClick={() => {
                            setLang(row.code);
                            chrome.close();
                        }}
                    >
                        <Flag code={row.flag} />
                        <span className="min-w-0 flex-1 truncate text-start">{row.endonym}</span>
                        {lang() === row.code && <Icon name="check" size={16} className="shrink-0 text-brand" />}
                    </button>
                ))}
            </div>
        </Sheet>
    );
}
