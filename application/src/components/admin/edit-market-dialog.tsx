import { useState } from 'react';

import {
    client,
    type AdminMarketRow,
    type ContentLang,
    type Localized,
    type MarketEditOutcome,
    type MarketEditState
} from '../../api.ts';

import { categoryIcon, matchesText } from '../../lib/market.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { usePreferences } from '../../stores/preferences.store.ts';
import { useAdmin } from '../../stores/admin.store.ts';
import { useCategories } from '../../stores/categories.store.ts';
import { useToasts } from '../../stores/toasts.store.ts';
import { useResource } from '../../hooks/use-resource.ts';

import { fieldDir, langRow } from '../../i18n/langs.ts';
import { formatDateTime } from '../../i18n/format.ts';

import Icon from '../../icons/icon.tsx';

import Sheet from '../ui/sheet.tsx';
import Button from '../ui/button.tsx';
import Chip from '../ui/chip.tsx';
import Input from '../ui/input.tsx';
import DateField from '../ui/date-field.tsx';
import TagField from '../ui/tag-field.tsx';
import SkeletonList from '../ui/skeleton-list.tsx';

import LanguagePicker from './language-picker.tsx';
import ImageField from './image-field.tsx';

const EMOJI = ['🔥', '₿', '⚽', '🏆', '🗳️', '🎬', '🚀', '📈', '📉', '🌍', '🧪', '💻', '🎮', '🏛️', '⚖️', '🎯'];

// Correcting a market that is ALREADY RUNNING.
//
// Every contract in this app writes its title, rules, image, category and outcome names once
// inside `initialize` and exposes no setter for any of them - so nothing here is a transaction
// and nothing here reaches the chain. What it changes is what the SITE shows. That is not a
// detail to bury: people have staked money against the text this market shipped with, so the
// on-chain original stays one tap away and can be restored at any time.
//
// The times are shown and NOT editable, because those genuinely are on chain: `lockTime` and
// `resolveTime` are what the contract itself enforces. The one time that IS editable is the
// scheduled opening, which was never on chain to begin with - it is a pause this server lifts.

/** The market's text as the form holds it while it is being edited. */
interface Draft {
    title: Localized;
    emoji: string;
    rules: Localized;
    image: string;
    category: string;
    tags: string[];
    outcomes: MarketEditOutcome[];
}

/** True when these two outcomes are the plain Yes/No pair the binary UI is built around. */
function binaryPair(outcomes: MarketEditOutcome[]): boolean
{
    return (
        outcomes.length === 2 &&
        outcomes[0].label.en.trim().toLowerCase() === 'yes' &&
        outcomes[1].label.en.trim().toLowerCase() === 'no'
    );
}

function draftOf(state: MarketEditState): Draft
{
    return {
        title: state.title,
        emoji: state.emoji,
        rules: state.rules,
        image: state.image,
        category: state.category,
        tags: [...state.tags],
        outcomes: state.outcomes.map((outcome) => ({ label: { ...outcome.label }, icon: outcome.icon }))
    };
}

export default function EditMarketDialog(props: { market: AdminMarketRow | null; onClose: () => void })
{
    const { t, lang } = useLocale();
    const { calendarSystem } = usePreferences();
    const admin = useAdmin();
    const categories = useCategories();
    const toasts = useToasts();

    const [writing, setWriting] = useState<ContentLang>('en');
    const [draft, setDraft] = useState<Draft | null>(null);

    /** Which market the form currently holds. Null before the first fetch lands. */
    const [seeded, setSeeded] = useState<string | null>(null);
    const [startsAt, setStartsAt] = useState('');
    const [saving, setSaving] = useState(false);
    const [reverting, setReverting] = useState(false);
    const [showOrigin, setShowOrigin] = useState(false);

    const marketId = props.market?.id ?? null;

    const state = useResource(
        () => marketId ?? false,
        (id: string) => client.admin.marketEdit({ params: { id } })
    );

    // The resource KEEPS its last value when the gate closes, so between opening a second row
    // and its fetch landing, `state.data()` is still the previous market's. Rendering that for
    // a frame would flash one market's question over another's - and seed the form with it.
    const fetched = state.data();
    const loaded = fetched?.marketId === marketId ? fetched : undefined;

    // Seeded from the fetch rather than from `props.market`, which carries the title and
    // nothing else. Adjusted DURING render rather than in an effect: an effect would paint the
    // empty form first and fill it on the next frame, and the seed is not a synchronisation
    // with anything outside React - it is state derived from a value that just arrived.
    // `seeded` is what makes it happen once per market instead of on every render.
    // Closing forgets the form. Without this, reopening the same row showed the draft as it
    // was left - including a language the picker was no longer on, and edits the admin had
    // walked away from rather than saved.
    if (marketId === null && seeded !== null)
    {
        setSeeded(null);
    }
    if (loaded !== undefined && seeded !== loaded.marketId)
    {
        setSeeded(loaded.marketId);
        setDraft(draftOf(loaded));
        setStartsAt(loaded.startsAt ?? '');
        setWriting('en');
        setShowOrigin(false);
    }

    const active = langRow(writing);

    const FIELD =
        'w-full rounded-control border border-line bg-raised px-3.5 text-[15px] text-text placeholder:text-faint transition-colors duration-200 focus:border-brand focus:outline-none';

    // The hint is page copy, so it decides the direction of the field while the field is empty.
    const rulesHint = t('admin.formDescription');

    const patch = (next: Partial<Draft>): void =>
    {
        setDraft((current) => (current === null ? current : { ...current, ...next }));
    };

    const setLocalized = (field: 'title' | 'rules', value: string): void =>
    {
        setDraft((current) =>
        {
            if (current === null)
            {
                return current;
            }
            const merged: Localized = { ...current[field], [writing]: value };
            return { ...current, [field]: merged };
        });
    };

    const setLabel = (index: number, value: string): void =>
    {
        setDraft((current) =>
        {
            if (current === null)
            {
                return current;
            }
            return {
                ...current,
                outcomes: current.outcomes.map((outcome, idx) =>
                    idx === index ? { ...outcome, label: { ...outcome.label, [writing]: value } } : outcome
                )
            };
        });
    };

    // Whether the market reads as Yes/No is decided by the ENGLISH pair alone, and the whole
    // trading surface branches on it: one tradeable side with a probability ring, or a list.
    // Reshaping that under people who already hold positions is not a correction, so English
    // is held on a binary market - every other language stays editable, which is where a
    // mistranslated "Yes" actually needs fixing.
    const binary = loaded !== undefined && binaryPair(loaded.origin.outcomes);
    const labelsLocked = binary && writing === 'en';

    const dirty = draft !== null && loaded !== undefined && JSON.stringify(draft) !== JSON.stringify(draftOf(loaded));
    const scheduleDirty = loaded !== undefined && startsAt !== (loaded.startsAt ?? '');
    const edited = loaded?.editedAt !== null && loaded?.editedAt !== undefined;

    const save = async (): Promise<void> =>
    {
        if (draft === null || marketId === null)
        {
            return;
        }
        setSaving(true);
        // Two signatures at most, and only for the halves that actually changed: the text goes
        // through the override endpoint, the opening through the schedule one. They are
        // separate records on the server, so submitting them together would still be two.
        const okText = dirty ? await admin.editMarket({ marketId, ...draft }) : true;
        const okSchedule = okText && scheduleDirty ? await admin.schedule(marketId, startsAt) : okText;
        setSaving(false);
        if (okText && okSchedule)
        {
            toasts.push('success', t('admin.editSaved'), 'circle-check');
            props.onClose();
        }
    };

    const revert = async (): Promise<void> =>
    {
        if (marketId === null)
        {
            return;
        }
        setReverting(true);
        const ok = await admin.revertMarket(marketId);
        setReverting(false);
        if (ok)
        {
            toasts.push('success', t('admin.editReverted'), 'circle-check');
            props.onClose();
        }
    };

    const typed = draft?.category.trim() ?? '';
    const suggestions = (categories.list.data() ?? [])
        .filter(
            (entry) =>
                typed === '' ||
                entry.id.startsWith(typed) ||
                matchesText(entry.label, typed) ||
                categories.label(entry.id).toLowerCase().includes(typed.toLowerCase())
        )
        .slice(0, 8);
    const when = (iso: string): string => formatDateTime(iso, lang(), calendarSystem());

    return (
        <Sheet open={props.market !== null} title={t('admin.editTitle')} onClose={() => props.onClose()}>
            <div className="flex flex-col gap-4">
                <p className="flex items-start gap-2 rounded-control bg-overlay p-3 text-[13px] leading-relaxed text-muted">
                    <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-gold" />
                    <span>{t('admin.editHint')}</span>
                </p>

                {state.loading() && draft === null && <SkeletonList count={4} height="h-11" radius="control" />}

                {draft !== null && loaded !== undefined && (
                    <>
                        <LanguagePicker
                            value={writing}
                            onChange={setWriting}
                            filled={(code) =>
                                (draft.title[code] ?? '') !== '' ||
                                (draft.rules[code] ?? '') !== '' ||
                                draft.outcomes.some((outcome) => (outcome.label[code] ?? '') !== '')
                            }
                        />

                        <Input
                            label={`${ t('admin.formTitle') } - ${ active.endonym }`}
                            placeholder={t('admin.formTitle')}
                            dir={active.dir}
                            value={draft.title[writing] ?? ''}
                            onInput={(next) => setLocalized('title', next)}
                        />

                        <textarea
                            className={`${ FIELD } h-24 resize-none py-2.5`}
                            aria-label={`${ t('admin.formDescription') } - ${ active.endonym }`}
                            placeholder={rulesHint}
                            dir={fieldDir(draft.rules[writing] ?? '', rulesHint, active.dir)}
                            value={draft.rules[writing] ?? ''}
                            onChange={(event) => setLocalized('rules', event.target.value)}
                        ></textarea>

                        <div>
                            <p className="mb-1.5 text-[12px] font-semibold text-muted">{t('admin.formEmoji')}</p>
                            <div className="flex flex-wrap gap-1.5">
                                {EMOJI.map((entry) => (
                                    <button
                                        key={entry}
                                        className={
                                            draft.emoji === entry
                                                ? 'flex h-10 w-10 cursor-pointer items-center justify-center rounded-control bg-brand-soft text-[19px] ring-1 ring-brand'
                                                : 'flex h-10 w-10 cursor-pointer items-center justify-center rounded-control bg-overlay text-[19px] transition-colors duration-200 hover:bg-raised'
                                        }
                                        type="button"
                                        aria-pressed={draft.emoji === entry}
                                        onClick={() => patch({ emoji: draft.emoji === entry ? '' : entry })}
                                    >
                                        {entry}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <Input
                                label={t('admin.formCategory')}
                                placeholder={t('admin.categoryHint')}
                                dir="ltr"
                                value={draft.category}
                                onInput={(next) => patch({ category: next })}
                            />
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {suggestions.map((entry) => (
                                    <Chip
                                        key={entry.id}
                                        compact
                                        icon={categoryIcon(entry.id)}
                                        selected={draft.category.trim().toLowerCase() === entry.id}
                                        onSelect={() => patch({ category: entry.id })}
                                    >
                                        {categories.label(entry.id)}
                                    </Chip>
                                ))}
                            </div>
                        </div>

                        <ImageField
                            label={t('admin.formImage')}
                            value={draft.image}
                            onChange={(uri) => patch({ image: uri })}
                        />

                        {/* Correctable for the same reason the title is: the tags were
                             committed in the on-chain envelope and have no setter either, so
                             without this a market filed under the wrong subject stays there
                             for its whole life. */}
                        <div>
                            <p className="mb-1.5 text-[12px] font-semibold text-muted">{t('tags.label')}</p>
                            <TagField
                                label={t('tags.label')}
                                dir={active.dir}
                                value={draft.tags}
                                onChange={(next) => patch({ tags: next })}
                            />
                        </div>

                        <div>
                            <p className="mb-1.5 text-[12px] font-semibold text-muted">{t('admin.formOutcomes')}</p>
                            <div className="flex flex-col gap-2">
                                {draft.outcomes.map((outcome, index) => (
                                    <Input
                                        key={index}
                                        label={`${ t('admin.formOutcomes') } ${ index + 1 } - ${ active.endonym }`}
                                        placeholder={active.endonym}
                                        dir={active.dir}
                                        disabled={labelsLocked}
                                        value={outcome.label[writing] ?? ''}
                                        onInput={(next) => setLabel(index, next)}
                                    />
                                ))}
                            </div>
                            {labelsLocked && <p className="mt-1.5 text-[12px] text-faint">{t('admin.editBinary')}</p>}
                        </div>

                        <div className="border-t border-line pt-4">
                            <p className="mb-1 text-[12px] font-semibold text-muted">{t('admin.formStart')}</p>
                            <DateField
                                label={t('admin.formStart')}
                                placeholder={t('admin.formStartNow')}
                                value={startsAt}
                                onChange={(next) => setStartsAt(next)}
                            />
                            <p className="mt-1 text-[12px] text-faint">{t('admin.formStartHint')}</p>

                            {/* Shown, never editable: these two ARE on chain, and the contract
                                 enforces them itself. An admin looking for them here has to be
                                 told why they cannot move, not left to guess. */}
                            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[12px]">
                                <span className="flex items-center gap-1.5">
                                    <dt className="text-muted">{t('admin.locks')}</dt>
                                    <dd className="nums latin-nums text-faint" dir="ltr">
                                        {when(loaded.locksAt)}
                                    </dd>
                                </span>
                                <span className="flex items-center gap-1.5">
                                    <dt className="text-muted">{t('admin.resolves')}</dt>
                                    <dd className="nums latin-nums text-faint" dir="ltr">
                                        {when(loaded.resolvesAt)}
                                    </dd>
                                </span>
                            </dl>
                            <p className="mt-1 text-[12px] text-faint">{t('admin.editTimesFixed')}</p>
                        </div>

                        {edited && (
                            <div className="border-t border-line pt-4">
                                <button
                                    className="flex w-full cursor-pointer items-center gap-2 text-start text-[13px] font-semibold text-muted transition-colors duration-200 hover:text-text"
                                    type="button"
                                    aria-expanded={showOrigin}
                                    onClick={() => setShowOrigin(!showOrigin)}
                                >
                                    <Icon name={showOrigin ? 'chevron-up' : 'chevron-down'} size={15} />
                                    <span>{t('admin.editOnChain')}</span>
                                </button>
                                {showOrigin && (
                                    <div className="mt-2 flex flex-col gap-1.5 rounded-control bg-overlay p-3 text-[13px]">
                                        <p className="font-semibold">{loaded.origin.title.en}</p>
                                        {loaded.origin.rules.en !== '' && (
                                            <p className="text-muted">{loaded.origin.rules.en}</p>
                                        )}
                                        <p className="text-faint">
                                            <bdi dir="ltr">
                                                {loaded.origin.category} ·{' '}
                                                {loaded.origin.outcomes.map((outcome) => outcome.label.en).join(' / ')}
                                            </bdi>
                                        </p>
                                    </div>
                                )}
                                <div className="mt-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        icon="arrow-left"
                                        loading={reverting}
                                        disabled={saving}
                                        onClick={() => void revert()}
                                    >
                                        {t('admin.editRevert')}
                                    </Button>
                                </div>
                            </div>
                        )}

                        <div className="flex items-center gap-2 border-t border-line pt-4">
                            <Button
                                variant="primary"
                                icon="circle-check"
                                loading={saving}
                                disabled={reverting || (!dirty && !scheduleDirty)}
                                onClick={() => void save()}
                            >
                                {t('admin.editSave')}
                            </Button>
                            <Button variant="ghost" disabled={saving || reverting} onClick={() => props.onClose()}>
                                {t('common.cancel')}
                            </Button>
                        </div>
                    </>
                )}
            </div>
        </Sheet>
    );
}
