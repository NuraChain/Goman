import { useEffect, useRef, useState } from 'react';

import type { Address } from 'viem';

import { shortAddress } from '../../lib/wallet.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { useSession } from '../../stores/session.store.ts';
import { useAdmin } from '../../stores/admin.store.ts';
import { useOnchain } from '../../stores/onchain.store.ts';

import Icon from '../../icons/icon.tsx';

import { faDigits } from '../../i18n/format.ts';

import Badge from '../ui/badge.tsx';
import Button from '../ui/button.tsx';
import Card from '../ui/card.tsx';
import Input from '../ui/input.tsx';
import Skeleton from '../ui/skeleton.tsx';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ZERO = '0x0000000000000000000000000000000000000000';

// Who may settle a market, and how many of them have to agree. This is the console's only
// view of the resolution multisig: ADMIN_ROLE cannot change it and cannot even vote with it,
// so an operator looking at a market stuck in Closed has no other way to find out whether the
// quorum is two, five, or a set their wallet is not in.
//
// The signer set and the quorum move together because the factory rejects a quorum larger than
// the set - split into two writes, one order of them always reverts.
export default function SignersCard() {
    const { t, lang } = useLocale();
    const session = useSession();
    const admin = useAdmin();
    const onchain = useOnchain();

    const [rows, setRows] = useState<string[]>([]);
    const [required, setRequired] = useState('');

    // Re-seeds whenever the chain's own set changes, exactly like the fee fields: a saved
    // write re-reads the policy, and stale input over a changed set is how an operator
    // re-submits the signers they just replaced.
    const lastSeen = useRef('');

    const policy = admin.policy.data();

    /** The quorum in the reader's own digits; addresses stay Latin because they are Latin. */
    const count = (value: number): string => (lang() === 'fa' ? faDigits(String(value)) : String(value));

    useEffect(() => {
        if (policy === undefined) {
            return;
        }
        const stamp = `${policy.signers.join(',')}|${policy.required}`;
        if (stamp !== lastSeen.current) {
            lastSeen.current = stamp;
            setRows([...policy.signers]);
            setRequired(String(policy.required));
        }
    }, [policy]);

    const isOwner = policy !== undefined && policy.owner.toLowerCase() === session.address().toLowerCase();
    const maxSigners = policy?.maxSigners ?? 10;

    const cleaned = rows.map((row) => row.trim());
    const unique = new Set(cleaned.map((row) => row.toLowerCase()));
    const quorum = Number(required);

    const valid =
        cleaned.length > 0 &&
        cleaned.length <= maxSigners &&
        cleaned.every((row) => ADDRESS_RE.test(row) && row.toLowerCase() !== ZERO) &&
        unique.size === cleaned.length &&
        Number.isInteger(quorum) &&
        quorum >= 1 &&
        quorum <= cleaned.length;

    const changed =
        policy !== undefined && `${cleaned.join(',')}|${quorum}` !== `${policy.signers.join(',')}|${policy.required}`;

    const save = async (): Promise<void> => {
        if (!valid) {
            return;
        }
        await admin.saveSigners(cleaned as Address[], quorum);
    };

    return (
        <Card>
            <h2 className="mb-1 text-lg font-bold tracking-tight">{t('admin.signersTitle')}</h2>
            <p className="mb-3 text-[13px] text-muted">{t('admin.signersHint')}</p>

            {policy === undefined ? (
                <Skeleton className="h-24 rounded-control" />
            ) : (
                <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2 text-[13px]">
                        <span className="text-muted">{t('admin.quorum')}</span>
                        <span className="nums font-bold" dir="ltr">
                            {count(policy.required)} / {count(policy.signers.length)}
                        </span>
                    </div>

                    <ul className="flex flex-col gap-1.5">
                        {policy.signers.map((signer) => (
                            <li key={signer} className="flex items-center gap-2 text-[13px]">
                                <Icon name="user" size={14} className="shrink-0 text-faint" />
                                <span className="nums latin-nums min-w-0 flex-1 truncate text-muted" dir="ltr">
                                    {shortAddress(signer)}
                                </span>
                                {signer.toLowerCase() === session.address().toLowerCase() && (
                                    <Badge tone="brand">{t('admin.thisWallet')}</Badge>
                                )}
                            </li>
                        ))}
                    </ul>

                    {isOwner ? (
                        <div className="flex flex-col gap-2 border-t border-line pt-3">
                            {rows.map((row, index) => (
                                <div key={index} className="flex items-center gap-2">
                                    <div className="flex-1">
                                        <Input
                                            label={t('admin.signerAddress')}
                                            placeholder="0x"
                                            dir="ltr"
                                            value={row}
                                            onInput={(next) =>
                                                setRows(rows.map((entry, at) => (at === index ? next : entry)))
                                            }
                                        />
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        icon="trash"
                                        label={t('admin.removeSigner')}
                                        disabled={rows.length < 2 || onchain.pending()}
                                        onClick={() => setRows(rows.filter((_, at) => at !== index))}
                                    />
                                </div>
                            ))}

                            <div className="flex flex-wrap items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    icon="plus"
                                    disabled={rows.length >= maxSigners || onchain.pending()}
                                    onClick={() => setRows([...rows, ''])}
                                >
                                    {t('admin.addSigner')}
                                </Button>
                                <div className="w-28">
                                    <Input
                                        type="number"
                                        label={t('admin.quorum')}
                                        value={required}
                                        onInput={setRequired}
                                    />
                                </div>
                            </div>

                            {!valid && (
                                <p className="text-[12px] font-semibold text-no">{t('admin.validationSigners')}</p>
                            )}

                            <Button
                                variant="danger"
                                size="sm"
                                icon="alert"
                                disabled={!valid || !changed || onchain.pending()}
                                loading={onchain.busy('signers')}
                                onClick={() => void save()}
                            >
                                {t('admin.saveSigners')}
                            </Button>
                        </div>
                    ) : (
                        <p className="border-t border-line pt-3 text-[12px] text-faint">
                            {t('admin.signersOwnerOnly')}
                        </p>
                    )}
                </div>
            )}
        </Card>
    );
}
