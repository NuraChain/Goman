import { useState, type ReactNode } from 'react';

import { useSearchParams } from 'react-router';

import { client, type Proposal, type ProposalState } from '../../api.ts';

import { shortAddress } from '../../lib/wallet.ts';

import { formatDateTime } from '../../i18n/format.ts';

import { useResource } from '../../hooks/use-resource.ts';

import { useLocale, type Lang, type MessageKey } from '../../stores/locale.store.ts';
import { usePreferences } from '../../stores/preferences.store.ts';
import { useAdmin } from '../../stores/admin.store.ts';
import { useCreateDraft, draftFromQuery, type DraftFields } from '../../stores/create-draft.store.ts';

import Icon from '../../icons/icon.tsx';
import type { IconName } from '../../icons/registry.ts';

import Badge from '../ui/badge.tsx';
import type { BadgeTone } from '../ui/variants.ts';
import Button from '../ui/button.tsx';
import Card from '../ui/card.tsx';
import EmptyState from '../ui/empty-state.tsx';
import Input from '../ui/input.tsx';
import Skeleton from '../ui/skeleton.tsx';

// The queue: markets written by someone who cannot deploy one.
//
// A proposal is a create-form draft parked on the server, so decoding one is the same job as
// opening a draft link - `draftFromQuery`, unchanged. That is the whole reason a proposal has
// no fields of its own on the wire: the form is the only thing that has ever known what a
// market is made of, and it still is.
//
// Accepting DEPLOYS nothing by itself. It opens the form, seeded, where the owner reads it,
// fixes whatever needs fixing and signs the same transaction they would have signed anyway -
// and the proposal is marked accepted when that lands. No server anywhere holds a key that
// could mint a market.

/** A stored draft back as form fields. Written by `draftToQuery`, so a row that decodes to
 *  nothing is a hand-edited one - it renders as an empty summary rather than taking the tab
 *  down with it. */
function fieldsOf(draft: string): Partial<DraftFields>
{
    return draftFromQuery(new URLSearchParams(draft)) ?? {};
}

/** The question, in the reader's language where the author wrote one. */
function titleOf(fields: Partial<DraftFields>, lang: Lang): string
{
    const written = fields.title;
    if (written === undefined)
    {
        return '';
    }
    return (written[lang] ?? '').trim() === '' ? written.en.trim() : written[lang].trim();
}

/** How a state reads: the badge's tone, its icon, and the word. Spelled out per state rather
 *  than assembled from the state name - a message key built by interpolation is a key the
 *  dictionary's type cannot check. */
const STATE: Record<ProposalState, { tone: BadgeTone; icon: IconName; key: MessageKey }> = {
    pending: { tone: 'gold', icon: 'clock', key: 'admin.proposalPending' },
    accepted: { tone: 'yes', icon: 'circle-check', key: 'admin.proposalAccepted' },
    declined: { tone: 'no', icon: 'circle-x', key: 'admin.proposalDeclined' }
};

/** One row's headline and the few numbers worth showing before it is opened. Shared by the
 *  console's queue and by a proposer's own list, which differ only in what they may DO. */
function ProposalCard(props: { row: Proposal; children?: ReactNode })
{
    const { t, lang } = useLocale();
    const { calendarSystem } = usePreferences();

    const row = props.row;
    const fields = fieldsOf(row.draft);
    const title = titleOf(fields, lang());
    const answers = fields.outcomes?.length ?? 0;
    const state = row.state;

    return (
        <li className="flex flex-col gap-3 rounded-card border border-line p-4">
            <div className="flex flex-wrap items-start gap-2">
                <p className="min-w-0 flex-1 text-[15px] font-bold leading-snug">
                    {title === '' ? t('admin.proposalUntitled') : title}
                </p>
                <Badge tone={STATE[state].tone} icon={STATE[state].icon}>
                    {t(STATE[state].key)}
                </Badge>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-faint">
                <span className="nums latin-nums" dir="ltr">
                    #{row.id}
                </span>
                <span className="inline-flex items-center gap-1">
                    <Icon name="user" size={13} />
                    <span className="nums latin-nums" dir="ltr">
                        {shortAddress(row.proposer)}
                    </span>
                </span>
                <span className="inline-flex items-center gap-1">
                    <Icon name="holders" size={13} />
                    <span className="nums">{answers}</span>
                </span>
                <span>
                    <bdi>{formatDateTime(row.createdAt, lang(), calendarSystem())}</bdi>
                </span>
            </div>

            {/* A rejection nobody can read is a support ticket waiting to happen, so the note
                is shown on BOTH sides of the queue - the owner sees what they wrote, and the
                proposer sees why. */}
            {row.note !== '' && (
                <p className="rounded-control bg-overlay px-3 py-2 text-[13px] leading-relaxed text-muted">
                    {row.note}
                </p>
            )}

            {props.children}
        </li>
    );
}

/** The console's queue, with the verdicts attached. Owner only - every write behind it is an
 *  admin route, and the resource itself is gated on the console session. */
export default function ProposalTable()
{
    const { t } = useLocale();
    const admin = useAdmin();
    const draft = useCreateDraft();
    const [params, setParams] = useSearchParams();

    /** Which row has its decline note open. One at a time: a note belongs to a decision, and
     *  two half-typed reasons on screen is two chances to send the wrong one. */
    const [declining, setDeclining] = useState<number | null>(null);
    const [note, setNote] = useState('');

    const rows = admin.proposals.data();

    // Seeds the form and goes there. The form is the only place a market has ever been
    // deployed from, so "accept" and "edit before accepting" are the same journey - reading
    // a proposal and fixing a typo in it should not be two different buttons.
    const open = (row: Proposal): void =>
    {
        draft.loadProposal(row.id, fieldsOf(row.draft));
        const next = new URLSearchParams(params);
        next.set('section', 'create');
        setParams(next, { replace: true });
    };

    const decline = async (id: number): Promise<void> =>
    {
        if (await admin.decideProposal(id, false, note))
        {
            setDeclining(null);
            setNote('');
        }
    };

    if (rows === undefined)
    {
        return <Skeleton className="h-64 rounded-card" />;
    }

    return (
        <Card>
            <h2 className="mb-1 text-lg font-bold tracking-tight">{t('admin.proposalsTitle')}</h2>
            <p className="mb-4 text-[13px] leading-relaxed text-muted">{t('admin.proposalsHint')}</p>

            {rows.length === 0 ? (
                <EmptyState icon="send" title={t('admin.proposalsEmpty')} hint={t('admin.proposalsEmptyHint')} />
            ) : (
                <ul className="flex flex-col gap-3">
                    {rows.map((row) => (
                        <ProposalCard key={row.id} row={row}>
                            {row.state === 'pending' &&
                                (declining === row.id ? (
                                    <div className="flex flex-col gap-2 border-t border-line pt-3">
                                        <Input
                                            label={t('admin.proposalNote')}
                                            placeholder={t('admin.proposalNoteHint')}
                                            value={note}
                                            onInput={setNote}
                                        />
                                        <div className="flex flex-wrap gap-2">
                                            <Button
                                                variant="danger"
                                                size="sm"
                                                icon="circle-x"
                                                onClick={() => void decline(row.id)}
                                            >
                                                {t('admin.proposalDecline')}
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() =>
                                                {
                                                    setDeclining(null);
                                                    setNote('');
                                                }}
                                            >
                                                {t('common.cancel')}
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                                        <Button variant="primary" size="sm" icon="sparkles" onClick={() => open(row)}>
                                            {t('admin.proposalSubmit')}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            icon="circle-x"
                                            onClick={() =>
                                            {
                                                setDeclining(row.id);
                                                setNote('');
                                            }}
                                        >
                                            {t('admin.proposalDecline')}
                                        </Button>
                                    </div>
                                ))}
                        </ProposalCard>
                    ))}
                </ul>
            )}
        </Card>
    );
}

/** What one wallet proposed, and what became of it. Read by address rather than through the
 *  admin session, because a proposer has no session and never will. */
export function MyProposals(props: { address: string })
{
    const { t } = useLocale();

    const mine = useResource(
        () => (props.address === '' ? false : props.address),
        (address: string) => client.proposals.mine({ query: { address } })
    );

    const rows = mine.data() ?? [];
    if (rows.length === 0)
    {
        return null;
    }

    return (
        <Card>
            <h2 className="mb-1 text-lg font-bold tracking-tight">{t('admin.myProposalsTitle')}</h2>
            <p className="mb-4 text-[13px] leading-relaxed text-muted">{t('admin.myProposalsHint')}</p>
            <ul className="flex flex-col gap-3">
                {rows.map((row) => (
                    <ProposalCard key={row.id} row={row} />
                ))}
            </ul>
        </Card>
    );
}
