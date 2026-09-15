import { useState } from 'react';

import { shortAddress } from '../../lib/wallet.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { useAdmin } from '../../stores/admin.store.ts';
import { useCreateDraft } from '../../stores/create-draft.store.ts';

import Icon from '../../icons/icon.tsx';

import { faDigits } from '../../i18n/format.ts';

import Badge from '../ui/badge.tsx';
import Button from '../ui/button.tsx';
import Chip from '../ui/chip.tsx';
import EmptyState from '../ui/empty-state.tsx';
import Input from '../ui/input.tsx';
import Pagination from '../ui/pagination.tsx';
import SkeletonList from '../ui/skeleton-list.tsx';

import type { ProposalState } from '../../api.ts';

// Markets people suggested over the Telegram bot, and the one decision to make about each.
//
// What Approve does NOT do is deploy anything. It records the verdict, tells the proposer, and
// seeds the create form with the suggestion - and the admin then signs the market from their
// own wallet, exactly as for one they typed out themselves. The server holds no key that could
// mint a market, which is the property that lets a queue fed by other people stay harmless: a
// row here is a sentence somebody wrote, not an instruction anything acts on.
export default function ProposalTable(props: { onApprove?: () => void }) {
    const { t, lang } = useLocale();
    const admin = useAdmin();
    const draft = useCreateDraft();

    const [rejecting, setRejecting] = useState<number | null>(null);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState<number | null>(null);

    const page = admin.proposals.data();
    const state = admin.proposalState();
    const firstLoad = admin.proposals.loading() && page === undefined;

    /** Counts and ids in the reader's own digits. */
    const num = (value: number | string): string => (lang() === 'fa' ? faDigits(String(value)) : String(value));

    const filters: Array<{ id: ProposalState | ''; label: string }> = [
        { id: 'pending', label: t('admin.proposalPending') },
        { id: 'approved', label: t('admin.proposalApproved') },
        { id: 'rejected', label: t('admin.proposalRejected') },
        { id: '', label: t('admin.all') }
    ];

    const approve = async (row: {
        id: number;
        question: string;
        description: string;
        outcomes: string[];
        closesAt: string;
        category: string;
    }): Promise<void> => {
        setBusy(row.id);
        if (await admin.decideProposal(row.id, true)) {
            // Seeded only after the verdict lands. Filling the form first and failing to record
            // the decision would leave an admin typing out a market the queue still calls
            // pending, and a second admin about to do the same.
            draft.importProposal(row);
            props.onApprove?.();
        }
        setBusy(null);
    };

    const reject = async (id: number): Promise<void> => {
        setBusy(id);
        if (await admin.decideProposal(id, false, note)) {
            setRejecting(null);
            setNote('');
        }
        setBusy(null);
    };

    return (
        <section>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <h2 className="text-lg font-bold tracking-tight">{t('admin.proposalsTitle')}</h2>
                    <p className="text-[13px] text-muted">{t('admin.proposalsHint')}</p>
                </div>
                {page !== undefined && page.pending > 0 && (
                    <Badge tone="brand">
                        <span className="nums">{num(page.pending)}</span> {t('admin.proposalWaiting')}
                    </Badge>
                )}
            </div>

            <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label={t('admin.proposalsTitle')}>
                {filters.map((entry) => (
                    <Chip
                        key={entry.id === '' ? 'all' : entry.id}
                        compact
                        selected={state === entry.id}
                        onSelect={() => admin.setProposalState(entry.id)}
                    >
                        {entry.label}
                    </Chip>
                ))}
            </div>

            {firstLoad && <SkeletonList count={4} height="h-24" />}

            {admin.proposals.error() !== null && page === undefined && (
                <EmptyState icon="alert" title={t('admin.proposalsFailed')} hint={t('admin.proposalsFailedHint')} />
            )}

            {page !== undefined && page.rows.length === 0 && (
                <EmptyState icon="messages" title={t('admin.proposalsEmpty')} hint={t('admin.proposalsEmptyHint')} />
            )}

            {page !== undefined && page.rows.length > 0 && (
                <ul className="flex flex-col gap-2">
                    {page.rows.map((row) => {
                        const answers = row.outcomes.length >= 2 ? row.outcomes.join(' / ') : t('admin.proposalYesNo');
                        const closes =
                            row.closesAt === ''
                                ? t('admin.proposalNoDate')
                                : row.closesAt.slice(0, 16).replace('T', ' ');
                        return (
                            <li key={row.id} className="rounded-control border border-line bg-surface-1 p-3">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                        <p className="flex items-center gap-1.5 text-[12px] text-muted">
                                            <span className="nums">#{num(row.id)}</span>
                                            <span aria-hidden="true">·</span>
                                            <span className="min-w-0 truncate" dir="ltr">
                                                {row.username === '' ? row.from : `@${row.username}`}
                                            </span>
                                        </p>
                                        <p className="mt-0.5 text-[14px] font-bold">{row.question}</p>
                                        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                                            <span>{answers}</span>
                                            <span aria-hidden="true">·</span>
                                            <span className="nums">{closes}</span>
                                            {row.category !== '' && (
                                                <>
                                                    <span aria-hidden="true">·</span>
                                                    <span>{row.category}</span>
                                                </>
                                            )}
                                        </p>
                                        {row.description !== '' && (
                                            <p className="mt-1.5 text-[13px] text-muted">{row.description}</p>
                                        )}
                                    </div>

                                    {row.state === 'pending' ? (
                                        <div className="flex shrink-0 items-center gap-1.5">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={busy !== null}
                                                onClick={() => {
                                                    setRejecting(rejecting === row.id ? null : row.id);
                                                    setNote('');
                                                }}
                                            >
                                                {t('admin.proposalReject')}
                                            </Button>
                                            <Button
                                                size="sm"
                                                icon="check"
                                                disabled={busy !== null}
                                                loading={busy === row.id && rejecting !== row.id}
                                                onClick={() => void approve(row)}
                                            >
                                                {t('admin.proposalApprove')}
                                            </Button>
                                        </div>
                                    ) : (
                                        <Badge tone={row.state === 'approved' ? 'yes' : 'no'}>
                                            {row.state === 'approved'
                                                ? t('admin.proposalApproved')
                                                : t('admin.proposalRejected')}
                                        </Badge>
                                    )}
                                </div>

                                {row.state !== 'pending' && row.decidedBy !== '' && (
                                    <p className="mt-2 flex items-center gap-1.5 border-t border-line pt-2 text-[12px] text-muted">
                                        <Icon name="user" size={12} className="shrink-0 text-faint" />
                                        <span className="latin-nums" dir="ltr">
                                            {shortAddress(row.decidedBy)}
                                        </span>
                                        {row.note !== '' && <span className="min-w-0 truncate">- {row.note}</span>}
                                    </p>
                                )}

                                {rejecting === row.id && (
                                    <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-line pt-2">
                                        <div className="min-w-40 flex-1">
                                            <Input
                                                label={t('admin.proposalRejectNote')}
                                                placeholder={t('admin.proposalRejectNoteHint')}
                                                value={note}
                                                onInput={setNote}
                                            />
                                        </div>
                                        <Button
                                            variant="danger"
                                            size="sm"
                                            disabled={busy !== null}
                                            loading={busy === row.id}
                                            onClick={() => void reject(row.id)}
                                        >
                                            {t('admin.proposalRejectConfirm')}
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={() => setRejecting(null)}>
                                            {t('common.cancel')}
                                        </Button>
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            {page !== undefined && page.pages > 1 && (
                <div className="mt-3">
                    <Pagination page={page.page} pages={page.pages} onChange={(next) => admin.setProposalPage(next)} />
                </div>
            )}
        </section>
    );
}
