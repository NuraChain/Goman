import { useState } from 'react';

import { parseEther, formatEther } from 'viem';

import { shortEther } from '../../lib/admin.ts';
import { chain } from '../../lib/chain.ts';
import { shortAddress } from '../../lib/wallet.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { useSession } from '../../stores/session.store.ts';
import { useAdmin } from '../../stores/admin.store.ts';
import { useOnchain } from '../../stores/onchain.store.ts';
import { useConfig } from '../../stores/config.store.ts';

import Button from '../ui/button.tsx';
import Card from '../ui/card.tsx';
import Input from '../ui/input.tsx';
import Skeleton from '../ui/skeleton.tsx';

// The treasury's money view: lifetime take, the recipient, and the owner-only controls.
// Ownership is read on-chain (Ownable2Step), so the buttons only render for the wallet
// that can actually use them.
export default function TreasuryCard() {
    const { t } = useLocale();
    const session = useSession();
    const admin = useAdmin();
    const onchain = useOnchain();
    const config = useConfig();

    const [amount, setAmount] = useState('');
    const [recipient, setRecipient] = useState('');

    const data = admin.treasury.data();

    const isOwner = data !== undefined && data.owner.toLowerCase() === session.address().toLowerCase();

    // Bounded by what the treasury actually holds - the number is on screen two rows above,
    // and withdrawing more than it just reverted with an unexplained "reverted on-chain".
    const collected = Number(formatEther(data?.totalCollected ?? 0n));
    const withdrawAmount = Number(amount);
    const withdrawable = Number.isFinite(withdrawAmount) && withdrawAmount > 0 && withdrawAmount <= collected;

    const withdraw = async (): Promise<void> => {
        if (!withdrawable) {
            return;
        }
        // parseEther THROWS on a non-numeric string. It used to run here, outside
        // onchain.execute, so the rejection was unhandled and the user saw nothing at all.
        if (await admin.withdraw(parseEther(amount))) {
            setAmount('');
        }
    };

    const changeRecipient = async (): Promise<void> => {
        if (/^0x[0-9a-fA-F]{40}$/.test(recipient) && (await admin.changeRecipient(recipient as `0x${string}`))) {
            setRecipient('');
        }
    };

    return (
        <Card>
            <h2 className="mb-3 text-lg font-bold tracking-tight">{t('admin.treasuryTitle')}</h2>
            {data === undefined ? (
                <Skeleton className="h-24 rounded-control" />
            ) : (
                <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2 text-[13px]">
                        <span className="text-muted">{t('admin.totalCollected')}</span>
                        <span className="nums latin-nums font-bold" dir="ltr">
                            {shortEther(data.totalCollected)} {chain.nativeCurrency.symbol}
                        </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[13px]">
                        <span className="text-muted">{t('admin.feeRecipient')}</span>
                        <span className="nums latin-nums text-faint" dir="ltr">
                            {shortAddress(data.feeRecipient)}
                        </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[13px]">
                        <span className="text-muted">{t('admin.address')}</span>
                        <span className="nums latin-nums text-faint" dir="ltr">
                            {shortAddress(config.data()?.treasury ?? '')}
                        </span>
                    </div>

                    {isOwner ? (
                        <div className="flex flex-col gap-2 border-t border-line pt-3">
                            <div className="flex items-center gap-2">
                                <div className="flex-1">
                                    <Input
                                        type="number"
                                        label={t('admin.withdrawAmount')}
                                        placeholder={t('admin.withdrawAmount')}
                                        value={amount}
                                        onInput={setAmount}
                                    />
                                </div>
                                <Button
                                    variant="gold"
                                    size="sm"
                                    icon="deposit"
                                    disabled={!withdrawable || onchain.pending()}
                                    loading={onchain.busy('withdraw')}
                                    onClick={() => void withdraw()}
                                >
                                    {t('admin.withdraw')}
                                </Button>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="flex-1">
                                    <Input
                                        label={t('admin.feeRecipient')}
                                        placeholder="0x"
                                        value={recipient}
                                        onInput={setRecipient}
                                    />
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={!/^0x[0-9a-fA-F]{40}$/.test(recipient) || onchain.pending()}
                                    loading={onchain.busy('recipient')}
                                    onClick={() => void changeRecipient()}
                                >
                                    {t('admin.changeRecipient')}
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <p className="text-[12px] text-faint">{t('admin.ownerOnly')}</p>
                    )}
                </div>
            )}
        </Card>
    );
}
