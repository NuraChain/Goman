import { Link } from 'react-router';

import { useLocale } from '../stores/locale.store.ts';

import Icon from '../icons/icon.tsx';

import Button from '../components/ui/button.tsx';

// The last line of defence: a render that threw. Without this the tree unmounts and the reader
// gets a blank page, which on a money surface reads as "my funds are gone".
//
// The copy says the opposite explicitly, because that is the first thing anyone will think. The
// error text itself stays in the console - it is for whoever is debugging, not for a trader.
export default function ErrorPage(props: { reset: () => void }) {
    const { t } = useLocale();

    return (
        <div className="mx-auto max-w-lg px-4 py-20 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-overlay text-no">
                <Icon name="alert" size={24} />
            </span>

            <h1 className="mt-5 text-[22px] font-bold tracking-tight text-text">{t('common.errorTitle')}</h1>
            <p className="mt-2.5 text-[15px] leading-relaxed text-muted">{t('common.errorBody')}</p>

            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                <Button variant="primary" onClick={() => props.reset()}>
                    {t('common.retry')}
                </Button>
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
