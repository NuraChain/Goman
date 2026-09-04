import { Link } from 'react-router';

import { useLocale } from '../stores/locale.store.ts';

import Icon from '../icons/icon.tsx';

import Button from '../components/ui/button.tsx';

// A wrong URL here is almost always a market that closed or a shared link that aged out, so the
// page sends the reader to the open markets rather than apologising and stopping. Bilingual like
// every other surface: the copy lives in i18n, never inline.
export default function NotFoundPage() {
    const { t } = useLocale();

    return (
        <div className="mx-auto max-w-lg px-4 py-20 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-overlay text-faint">
                <Icon name="search" size={24} />
            </span>

            <h1 className="mt-5 text-[22px] font-bold tracking-tight text-text">{t('common.notFoundTitle')}</h1>
            <p className="mt-2.5 text-[15px] leading-relaxed text-muted">{t('common.notFoundBody')}</p>

            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                <Link to="/browse" className="no-underline">
                    <Button variant="primary">{t('common.notFoundCta')}</Button>
                </Link>
                <Link
                    to="/"
                    className="inline-flex min-h-11 items-center px-2 text-[14px] text-muted no-underline hover:text-text"
                >
                    {t('common.backHome')}
                </Link>
            </div>
        </div>
    );
}
