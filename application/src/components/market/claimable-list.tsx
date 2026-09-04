import { client } from '../../api.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { useSession } from '../../stores/session.store.ts';
import { useOnchain } from '../../stores/onchain.store.ts';
import { useResource } from '../../hooks/use-resource.ts';

import { formatShares } from '../../i18n/format.ts';

import Icon from '../../icons/icon.tsx';

import Button from '../ui/button.tsx';
import Card from '../ui/card.tsx';
import EmptyState from '../ui/empty-state.tsx';
import SkeletonList from '../ui/skeleton-list.tsx';

// Winnings the connected wallet can redeem: the indexer flags positions whose market
// resolved their way (or voided); Claim calls redeem() on the market itself.
export default function ClaimableList(props: { onClaimed?: () => void }) {
    const { t, lang, text } = useLocale();
    const session = useSession();
    const onchain = useOnchain();

    const positions = useResource(
        () => (session.connected() ? session.address() : false),
        (address: string) => client.portfolio.positions({ query: { address } })
    );

    const claims = (positions.data() ?? []).filter((position) => position.claimable);

    const claim = async (address: string): Promise<void> => {
        if (await onchain.claim(address as `0x${string}`)) {
            positions.refetch();
            props.onClaimed?.();
        }
    };

    return (
        <div className="flex flex-col gap-3">
            <div>
                <h2 className="text-lg font-bold tracking-tight">{t('chain.claimTitle')}</h2>
                <p className="text-[13px] text-muted">{t('chain.claimHint')}</p>
            </div>

            {positions.loading() && positions.data() === undefined && (
                <SkeletonList count={2} height="h-16" radius="card" gap="md" />
            )}

            {positions.data() !== undefined && claims.length === 0 && (
                <EmptyState icon="wallet" title={t('chain.noClaims')} hint={t('chain.noClaimsHint')} />
            )}

            {claims.length > 0 && (
                <ul className="grid grid-cols-1 gap-3">
                    {claims.map((entry) => (
                        <li key={entry.id}>
                            <Card className="flex items-center gap-3">
                                <span
                                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-yes-soft text-yes"
                                    aria-hidden="true"
                                >
                                    <Icon name="trophy" size={18} />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[14px] font-bold">
                                        {text(entry.market.title)}
                                    </span>
                                    <span className="nums block text-[12px] text-muted">
                                        {formatShares(entry.shares, lang())}
                                    </span>
                                </span>
                                <Button
                                    variant="primary"
                                    size="sm"
                                    disabled={onchain.pending()}
                                    loading={onchain.busy(`claim:${entry.market.address}`)}
                                    onClick={() => void claim(entry.market.address)}
                                >
                                    {t('chain.claim')}
                                </Button>
                            </Card>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
