import { useLocale } from '../../stores/locale.store.ts';
import { useFavorites } from '../../stores/favorites.store.ts';
import { useToasts } from '../../stores/toasts.store.ts';

import Icon from '../../icons/icon.tsx';

import Tooltip from '../ui/tooltip.tsx';

// The watchlist toggle every market surface shares: one handler, one toast, one
// filled-bookmark treatment. `sm` is the card mark; `md` the detail-header button.
export default function FavoriteButton(props: { marketId: string; size?: 'sm' | 'md' }) {
    const { t } = useLocale();
    const favorites = useFavorites();
    const toasts = useToasts();

    const toggle = (): void => {
        const added = favorites.toggle(props.marketId);
        // Removing is not a success - it is an acknowledgement. Same tone for both read as
        // "well done" for throwing something away.
        if (added) {
            toasts.push('success', t('toast.watchAdded'), 'bookmark');
        } else {
            toasts.push('info', t('toast.watchRemoved'), 'bookmark');
        }
    };

    const saved = favorites.has(props.marketId);

    return (
        <Tooltip label={t('market.save')}>
            <button
                className={`flex ${props.size === 'md' ? 'h-9 w-9' : 'h-7 w-7'} shrink-0 cursor-pointer items-center justify-center rounded-control transition duration-200 hover:bg-overlay active:scale-90 ${saved ? 'text-gold' : 'text-faint hover:text-muted'}`}
                type="button"
                aria-label={t('market.save')}
                aria-pressed={saved}
                onClick={() => toggle()}
            >
                <Icon name="bookmark" size={props.size === 'md' ? 17 : 15} fill={saved} />
            </button>
        </Tooltip>
    );
}
