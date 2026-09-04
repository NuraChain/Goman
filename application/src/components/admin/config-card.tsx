import { useEffect, useRef, useState } from 'react';

import { useLocale } from '../../stores/locale.store.ts';
import { useAdmin } from '../../stores/admin.store.ts';
import { useOnchain } from '../../stores/onchain.store.ts';
import { useConfig } from '../../stores/config.store.ts';

import Button from '../ui/button.tsx';
import Card from '../ui/card.tsx';
import Input from '../ui/input.tsx';
import Skeleton from '../ui/skeleton.tsx';

const FEE_MAX = 1000;
const SHARE_MAX = 10_000;

// The factory's defaults: the fee configuration new markets inherit, and the treasury
// address they are born pointing at. Applies to future markets only.
export default function ConfigCard() {
    const { t } = useLocale();
    const admin = useAdmin();
    const onchain = useOnchain();
    const config = useConfig();

    const [feeBps, setFeeBps] = useState('');
    const [protocolShareBps, setProtocolShareBps] = useState('');
    const [treasury, setTreasury] = useState('');
    const [armed, setArmed] = useState(false);

    // Re-seeds whenever the chain's own numbers change - after a saveFees the store's
    // defaults resource re-reads, and the fields must follow it rather than keep stale input.
    // A one-shot `seeded` latch used to block exactly that.
    const lastSeen = useRef('');

    const defaults = admin.defaults.data();
    const treasuryAddress = config.data()?.treasury ?? '';

    useEffect(() => {
        if (defaults === undefined) {
            return;
        }
        const stamp = `${defaults.defaultFeeBps}|${defaults.defaultProtocolFeeShareBps}|${treasuryAddress}`;
        if (stamp !== lastSeen.current) {
            lastSeen.current = stamp;
            setFeeBps(String(defaults.defaultFeeBps));
            setProtocolShareBps(String(defaults.defaultProtocolFeeShareBps));
            setTreasury(treasuryAddress);
        }
    }, [defaults, treasuryAddress]);

    const feesValid =
        feeBps.trim() !== '' &&
        protocolShareBps.trim() !== '' &&
        Number.isFinite(Number(feeBps)) &&
        Number(feeBps) >= 0 &&
        Number(feeBps) <= FEE_MAX &&
        Number.isFinite(Number(protocolShareBps)) &&
        Number(protocolShareBps) >= 0 &&
        Number(protocolShareBps) <= SHARE_MAX;

    const pointTreasury = async (): Promise<void> => {
        setArmed(false);
        await admin.pointTreasury(treasury as `0x${string}`);
    };

    return (
        <Card>
            <h2 className="mb-3 text-lg font-bold tracking-tight">{t('admin.configTitle')}</h2>
            {defaults === undefined ? (
                <Skeleton className="h-24 rounded-control" />
            ) : (
                <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <p className="mb-1 text-[12px] font-semibold text-muted">{t('admin.formFee')}</p>
                            <Input type="number" label={t('admin.formFee')} value={feeBps} onInput={setFeeBps} />
                        </div>
                        <div>
                            <p className="mb-1 text-[12px] font-semibold text-muted">{t('admin.formProtocolShare')}</p>
                            <Input
                                type="number"
                                label={t('admin.formProtocolShare')}
                                value={protocolShareBps}
                                onInput={setProtocolShareBps}
                            />
                        </div>
                    </div>
                    {!feesValid && feeBps.trim() !== '' && protocolShareBps.trim() !== '' && (
                        <p className="text-[12px] font-semibold text-no">{t('admin.validationFee')}</p>
                    )}
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={!feesValid || onchain.pending()}
                        loading={onchain.busy('saveFees')}
                        onClick={() => void admin.saveFees(Number(feeBps), Number(protocolShareBps))}
                    >
                        {t('admin.saveFees')}
                    </Button>

                    <div className="border-t border-line pt-3">
                        <p className="mb-1 text-[12px] font-semibold text-muted">{t('admin.treasuryAddress')}</p>
                        <p className="mb-2 text-[12px] text-faint">{t('admin.treasuryWarning')}</p>
                        <div className="flex items-center gap-2">
                            <div className="flex-1">
                                <Input
                                    label={t('admin.treasuryAddress')}
                                    placeholder="0x"
                                    value={treasury}
                                    onInput={(next) => {
                                        setTreasury(next);
                                        setArmed(false);
                                    }}
                                />
                            </div>
                            {armed ? (
                                <Button
                                    variant="danger"
                                    size="sm"
                                    loading={onchain.busy('pointTreasury')}
                                    onClick={() => void pointTreasury()}
                                >
                                    {t('admin.confirmTreasury')}
                                </Button>
                            ) : (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={
                                        !/^0x[0-9a-fA-F]{40}$/.test(treasury) ||
                                        treasury.toLowerCase() === treasuryAddress.toLowerCase() ||
                                        onchain.pending()
                                    }
                                    onClick={() => setArmed(true)}
                                >
                                    {t('admin.updateTreasury')}
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </Card>
    );
}
