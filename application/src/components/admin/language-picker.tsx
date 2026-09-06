import { LANGS } from '../../i18n/langs.ts';

import { useLocale } from '../../stores/locale.store.ts';

import type { ContentLang } from '../../api.ts';

import Flag from '../ui/flag.tsx';

// Which language an admin is WRITING in - shared by the create-market form and the category
// table, both of which collect the same text in the same ten languages.
//
// One picker rather than a field per language: ten stacked pairs is not a form anyone fills
// in. English carries a marker instead of a dot because it is the required floor every other
// language falls back to, so "filled" is never a question about it.
export default function LanguagePicker(props: {
    value: ContentLang;
    onChange: (next: ContentLang) => void;

    /** True when this language has any text yet - the dot that says what is left to write. */
    filled: (lang: ContentLang) => boolean;
}) {
    const { t } = useLocale();

    return (
        <div>
            <p className="mb-1.5 text-[12px] font-semibold text-muted">{t('admin.formLanguage')}</p>
            <div className="rail rail-bleed gap-1.5" role="group" aria-label={t('admin.formLanguage')}>
                {LANGS.map((row) => (
                    <button
                        key={row.code}
                        className={
                            props.value === row.code
                                ? 'flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full bg-brand-soft px-3 text-[13px] font-bold text-brand ring-1 ring-brand'
                                : 'flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-line px-3 text-[13px] font-semibold text-muted transition-colors duration-200 hover:text-text'
                        }
                        type="button"
                        aria-pressed={props.value === row.code}
                        onClick={() => props.onChange(row.code)}
                    >
                        <Flag code={row.flag} />
                        <span>{row.endonym}</span>
                        {row.code === 'en' ? (
                            <span className="text-gold" aria-hidden="true">
                                *
                            </span>
                        ) : (
                            props.filled(row.code) && (
                                <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true"></span>
                            )
                        )}
                    </button>
                ))}
            </div>
            <p className="mt-2 text-[12px] text-faint">
                {props.value === 'en' ? t('admin.langRequired') : t('admin.langOptional')}
            </p>
        </div>
    );
}
