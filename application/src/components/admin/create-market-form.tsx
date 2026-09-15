import { useState } from 'react';

import { parseEther } from 'viem';

import { CONTENT_LANGS, encodeTitleMeta, encodeTextMeta, type ContentLang, type Localized } from '../../api.ts';

import { categoryIcon, categoryIdOf, isImageURI, isRegistryId } from '../../lib/market.ts';
import { chain, explorerTxUrl } from '../../lib/chain.ts';

import { fieldDir, LANGS, langRow } from '../../i18n/langs.ts';
import { formatDateTime } from '../../i18n/format.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { usePreferences } from '../../stores/preferences.store.ts';
import { useAdmin } from '../../stores/admin.store.ts';
import { useOnchain } from '../../stores/onchain.store.ts';
import { useCreateDraft, hasText, trimText } from '../../stores/create-draft.store.ts';
import { useCategories } from '../../stores/categories.store.ts';

import Icon from '../../icons/icon.tsx';

import ImageField from './image-field.tsx';
import LanguagePicker from './language-picker.tsx';

import Tooltip from '../ui/tooltip.tsx';
import Card from '../ui/card.tsx';
import Button from '../ui/button.tsx';
import Chip from '../ui/chip.tsx';
import Input from '../ui/input.tsx';
import DateField from '../ui/date-field.tsx';

const EMOJI = ['🔥', '₿', '⚽', '🏆', '🗳️', '🎬', '🚀', '📈', '📉', '🌍', '🧪', '💻', '🎮', '🏛️', '⚖️', '🎯'];
type Step = 'question' | 'outcomes' | 'timing' | 'review';
const STEPS: Step[] = ['question', 'outcomes', 'timing', 'review'];
const FEE_MAX = 1000;
const SHARE_MAX = 10_000;

/** A month. Past this the resolve time stops being a schedule and starts being a typo. */
const RESOLVE_MAX_HOURS = 720;

/** True when a label was written in English and nothing else - it rides the chain as a plain
 *  string rather than a one-key envelope, which is what every older market already looks like. */
function englishOnly(label: Localized): boolean {
    return CONTENT_LANGS.every((code) => code === 'en' || label[code] === undefined);
}

// The create surface, as its own admin section rather than a 416px sheet. The question, the
// rules and every answer are written in as many of the app's languages as the author has -
// ONE language picker drives both text steps, because ten stacked field pairs is not a form
// anyone fills in. English is the required floor: it is what a reader in an untranslated
// language falls back to, so a market without it would be unreadable to most of the world.
//
// The category is FREE TEXT over the registered ones - typing a new name mints it. Every
// field lives in the draft store so leaving the section and coming back does not lose a
// half-written market.
export default function CreateMarketForm() {
    const { t, lang } = useLocale();
    const { calendarSystem } = usePreferences();
    const admin = useAdmin();
    const onchain = useOnchain();
    const draft = useCreateDraft();
    const categories = useCategories();

    const [step, setStep] = useState<Step>('question');
    const [writing, setWriting] = useState<ContentLang>('en');
    const [created, setCreated] = useState<{ hash: string; marketId: number | null; address: string | null } | null>(
        null
    );
    const [visited, setVisited] = useState<Step[]>([]);

    const source = draft.source();
    const title = draft.title();
    const description = draft.description();

    // Only registry ids can be offered: the factory takes a uint32 and rejects anything it has
    // not been told about, so the names markets carried before the registry are history the
    // picker cannot deploy against.
    const suggestions = categories
        .active()
        .filter((entry) => isRegistryId(entry.id))
        .filter((entry) => draft.category().trim() === '' || entry.id.startsWith(draft.category().trim()))
        .slice(0, 10);

    const categoryId = categoryIdOf(draft.category());
    const registered = (categories.list.data() ?? []).find((entry) => entry.id === String(categoryId));

    // An id the registry has never heard of is about to be REGISTERED, which is a transaction of
    // its own: the factory refuses a market whose category it does not know, and the names are
    // what every reader will be shown, so they are collected here rather than left for later.
    const minting = categoryId !== null && registered === undefined;
    const categoryNamed = trimText(draft.categoryLabel()).en !== '';

    // An answer with a Persian name and no English one used to be dropped in silence, so a
    // 3-outcome market deployed with 2. A row counts as STARTED once any language has text in
    // it, and every started row must carry an English name.
    const started = draft.outcomes().filter((outcome) => hasText(outcome.labels));
    const names = started.map((outcome) => ({ label: trimText(outcome.labels), icon: outcome.icon.trim() }));
    const halfFilled = names.some((entry) => entry.label.en === '');

    /** Which languages this market has any text in - the dot on the picker, and the review list. */
    const written = LANGS.filter(
        (row) =>
            title[row.code].trim() !== '' ||
            description[row.code].trim() !== '' ||
            draft.outcomes().some((outcome) => outcome.labels[row.code].trim() !== '')
    );

    // Empty START is the ordinary case: the market opens the moment it is deployed. A filled
    // one means the market is deployed PAUSED and a scheduled job lifts the pause.
    const startSeconds = draft.startAt() === '' ? 0 : Math.floor(new Date(draft.startAt()).getTime() / 1000);
    const lockSeconds = draft.lockAt() === '' ? 0 : Math.floor(new Date(draft.lockAt()).getTime() / 1000);
    // Resolution is a DURATION from the stop time, not a second date. A day suits most
    // markets and is the default; a sports market can resolve in an hour and an election
    // may need a week, so the window is per-market - it is the gap that is asked for,
    // which cannot land before the lock however it is edited.
    const resolveHours = Number(draft.resolveHours());
    const resolveValid = Number.isFinite(resolveHours) && resolveHours > 0 && resolveHours <= RESOLVE_MAX_HOURS;
    const resolveSeconds = lockSeconds === 0 || !resolveValid ? 0 : lockSeconds + Math.round(resolveHours * 60 * 60);

    // A parimutuel pool: no AMM, no liquidity providers, and therefore no protocol/LP split
    // to configure - the whole fee goes to the treasury, which is why both fields disappear.
    const pool = draft.kind() === 'pool';

    const imageValid = draft.imageURI().trim() === '' || isImageURI(draft.imageURI());
    const feeValid =
        Number.isFinite(Number(draft.feeBps())) && Number(draft.feeBps()) >= 0 && Number(draft.feeBps()) <= FEE_MAX;
    const shareValid =
        Number.isFinite(Number(draft.protocolShareBps())) &&
        Number(draft.protocolShareBps()) >= 0 &&
        Number(draft.protocolShareBps()) <= SHARE_MAX;

    // Per-step, so a missing English title never reports itself as an outcomes problem.
    const issueFor = (which: Step): string => {
        if (which === 'question') {
            if (title.en.trim() === '') {
                return t('admin.validationTitle');
            }
            if (draft.category().trim() === '') {
                return t('admin.validationCategory');
            }
            if (categoryId === null) {
                return t('admin.categoryIdInvalid');
            }
            // Retiring a category leaves its markets alone and stops new ones. The factory
            // enforces that, so the form says so before a deploy spends gas finding out.
            if (registered?.retired === true) {
                return t('admin.validationCategoryRetired');
            }
            if (minting && !categoryNamed) {
                return t('admin.validationCategoryLabel');
            }
            if (!imageValid) {
                return t('admin.validationImage');
            }
            return '';
        }
        if (which === 'outcomes') {
            if (halfFilled) {
                return t('admin.validationOutcomeEn');
            }
            if (names.length < 2) {
                return t('admin.validationOutcomes');
            }
            return '';
        }
        if (which === 'timing') {
            if (lockSeconds <= Math.floor(Date.now() / 1000)) {
                return t('admin.validationTiming');
            }
            // A start after the stop time is a market that never trades: the pause would lift
            // into a betting window that had already closed.
            if (startSeconds !== 0 && startSeconds >= lockSeconds) {
                return t('admin.formStartPast');
            }
            if (!resolveValid) {
                return t('admin.validationResolveWindow');
            }
            // A pool forms its prize from the bets themselves: it is deployed with no value
            // attached at all, and the factory rejects the call outright if any is sent.
            if (!pool && (draft.liquidity().trim() === '' || !(Number(draft.liquidity()) > 0))) {
                return t('admin.validationLiquidity');
            }
            if (!feeValid) {
                return t('admin.validationFee');
            }
            if (!pool && !shareValid) {
                return t('admin.validationShare');
            }
            return '';
        }
        return '';
    };

    const issue = issueFor('question') || issueFor('outcomes') || issueFor('timing');
    const stepIssue = issueFor(step);

    const submit = async (): Promise<void> => {
        if (issue !== '') {
            return;
        }
        // Any start time at all means the scheduled flow. Comparing it to "now" here would put
        // a clock read in the render body, and a start time already past simply opens on the
        // server's next tick - which is what asking for it meant.
        const scheduled = startSeconds !== 0;

        // The ID is registered WITH its names BEFORE the deploy: a market carries nothing but
        // the number, and the factory rejects one it has not been told about. It costs a second
        // transaction, and a registered category with no market of its own is legal by design.
        if (minting && categoryId !== null && !(await admin.addCategory(categoryId, trimText(draft.categoryLabel())))) {
            return;
        }

        const input = {
            title: encodeTitleMeta({ ...trimText(title), emoji: draft.emoji().trim() }),
            description: encodeTextMeta(trimText(description)),
            categoryId: categoryId ?? 0,
            imageURI: draft.imageURI().trim(),
            lockTime: lockSeconds,
            resolveTime: resolveSeconds,
            feeBps: Number(draft.feeBps()) || 0,
            protocolFeeShareBps: pool ? 0 : Number(draft.protocolShareBps()) || 0,
            outcomeNames: names.map((entry) =>
                entry.icon === '' && englishOnly(entry.label)
                    ? entry.label.en
                    : encodeTextMeta({ ...entry.label, icon: entry.icon })
            ),
            initialLiquidity: pool ? 0n : parseEther(draft.liquidity())
        };
        // Two different flows, deliberately: a scheduled market costs the admin a second
        // signature (the pause), and asking for it when nothing is scheduled would be a prompt
        // with nothing behind it.
        const result = scheduled
            ? await admin.createScheduled(input, new Date(draft.startAt()).toISOString(), draft.kind())
            : await admin.create(input, draft.kind());
        if (result !== null) {
            // The transaction LANDED. Clear the draft even when the log did not parse, because
            // the market exists either way and a pre-filled form invites a duplicate deploy.
            setCreated({
                hash: result.hash,
                marketId: result.market?.marketId ?? null,
                address: result.market?.address ?? null
            });
            draft.reset();
            setWriting('en');
        }
    };

    const again = (): void => {
        setCreated(null);
        setStep('question');
    };

    const mark = (): void => {
        setVisited((current) => (current.includes(step) ? current : [...current, step]));
    };

    const advance = (): void => {
        mark();
        const at = STEPS.indexOf(step);
        if (at < STEPS.length - 1) {
            setStep(STEPS[at + 1]!);
        }
    };

    const back = (): void => {
        mark();
        const at = STEPS.indexOf(step);
        if (at > 0) {
            setStep(STEPS[at - 1]!);
        }
    };

    const FIELD =
        'w-full rounded-control border border-line bg-raised px-3.5 text-[15px] text-text placeholder:text-faint transition-colors duration-200 focus:border-brand focus:outline-none';

    // The hint is page copy, so it decides the direction of the field while the field is empty.
    const descriptionHint = t('admin.formDescription');

    const active = langRow(writing);

    if (created !== null) {
        const explorer = explorerTxUrl(created.hash);
        return (
            <Card className="mx-auto max-w-lg text-center">
                <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-yes-soft text-yes">
                    <Icon name="circle-check" size={24} />
                </span>
                <p className="text-[17px] font-bold">{t('admin.createdTitle')}</p>
                <p className="mt-1 text-[13px] text-muted">
                    {created.address === null ? t('admin.createdUnparsed') : t('admin.createdHint')}
                </p>
                <p className="nums latin-nums mt-3 break-all text-[12px] text-faint">
                    <bdi dir="ltr">{created.address ?? created.hash}</bdi>
                </p>
                <div className="mt-4 flex justify-center gap-2">
                    {explorer !== null && explorer !== '' && (
                        <a
                            className="flex h-10 items-center gap-1.5 rounded-control border border-line px-3.5 text-[14px] font-semibold text-muted transition-colors duration-200 hover:text-text"
                            href={explorer}
                            target="_blank"
                            rel="noreferrer"
                        >
                            <Icon name="external" size={15} />
                            <span>{t('chain.viewTx')}</span>
                        </a>
                    )}
                    <Button variant="primary" size="sm" icon="plus" onClick={() => again()}>
                        {t('admin.create')}
                    </Button>
                </div>
            </Card>
        );
    }

    return (
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
            <nav className="rail rail-bleed gap-2" aria-label={t('admin.createTitle')}>
                {STEPS.map((entry, index) => (
                    <button
                        key={entry}
                        className={
                            step === entry
                                ? 'flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full bg-brand px-4 text-[13px] font-bold text-on-brand'
                                : 'flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-line px-4 text-[13px] font-semibold text-muted transition-colors duration-200 hover:text-text'
                        }
                        type="button"
                        onClick={() => {
                            mark();
                            setStep(entry);
                        }}
                    >
                        <span className="nums latin-nums opacity-60">{index + 1}</span>
                        <span>{t(`admin.step${entry}` as 'admin.stepquestion')}</span>
                        {entry !== 'review' && issueFor(entry) === '' && <Icon name="check" size={14} />}
                    </button>
                ))}
            </nav>

            <Card>
                {/* ONE picker for both text steps: an author writes the question, the rules and
                     the answers in a language, then switches once and does the next. Splitting it
                     per step made them switch twice for every language they speak. */}
                {(step === 'question' || step === 'outcomes') && (
                    <div className="mb-4 border-b border-line pb-4">
                        <LanguagePicker
                            value={writing}
                            onChange={setWriting}
                            filled={(code) => written.some((entry) => entry.code === code)}
                        />
                    </div>
                )}

                {step === 'question' && (
                    <div className="flex flex-col gap-3">
                        {/* Where this draft's wording came from. A suggestion sent over the bot
                            has no address to open, so it reads as a label rather than a dead
                            link - only a source with a url is a link. */}
                        {source !== null &&
                            (source.url === '' ? (
                                <p className="flex items-center gap-1.5 self-start text-[12px] font-semibold text-muted">
                                    <Icon name="globe" size={13} />
                                    <span>
                                        {t('admin.importedFrom')} {source.venue}
                                    </span>
                                </p>
                            ) : (
                                <a
                                    className="flex items-center gap-1.5 self-start text-[12px] font-semibold text-muted no-underline transition-colors duration-200 hover:text-brand"
                                    href={source.url}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    <Icon name="globe" size={13} />
                                    <span>
                                        {t('admin.importedFrom')} {source.venue}
                                    </span>
                                    <Icon name="external" size={12} />
                                </a>
                            ))}
                        <Input
                            label={`${t('admin.formTitle')} - ${active.endonym}`}
                            placeholder={t('admin.formTitle')}
                            dir={active.dir}
                            value={title[writing]}
                            onInput={(next) => draft.setTitle(writing, next)}
                        />

                        <textarea
                            className={`${FIELD} h-24 resize-none py-2.5`}
                            aria-label={`${t('admin.formDescription')} - ${active.endonym}`}
                            placeholder={descriptionHint}
                            dir={fieldDir(description[writing], descriptionHint, active.dir)}
                            value={description[writing]}
                            onChange={(event) => draft.setDescription(writing, event.target.value)}
                        ></textarea>

                        <div>
                            <p className="mb-1.5 text-[12px] font-semibold text-muted">{t('admin.formEmoji')}</p>
                            <div className="flex flex-wrap gap-1.5">
                                {EMOJI.map((entry) => (
                                    <button
                                        key={entry}
                                        className={
                                            draft.emoji() === entry
                                                ? 'flex h-10 w-10 cursor-pointer items-center justify-center rounded-control bg-brand-soft text-[19px] ring-1 ring-brand'
                                                : 'flex h-10 w-10 cursor-pointer items-center justify-center rounded-control bg-overlay text-[19px] transition-colors duration-200 hover:bg-raised'
                                        }
                                        type="button"
                                        aria-pressed={draft.emoji() === entry}
                                        onClick={() => draft.setEmoji(draft.emoji() === entry ? '' : entry)}
                                    >
                                        {entry}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <Input
                                type="number"
                                label={t('admin.formCategory')}
                                placeholder={t('admin.categoryHint')}
                                dir="ltr"
                                value={draft.category()}
                                onInput={(next) => draft.setCategory(next)}
                            />
                            {draft.category().trim() !== '' && categoryId === null && (
                                <p className="mt-1 text-[12px] font-semibold text-no">{t('admin.categoryIdInvalid')}</p>
                            )}
                            {registered !== undefined && (
                                // The NAME the id resolves to, not just "matches": an id is not a
                                // word anyone reads, and the market header will show this.
                                <p
                                    className={
                                        registered.retired
                                            ? 'mt-1 text-[12px] font-semibold text-no'
                                            : 'mt-1 text-[12px] text-faint'
                                    }
                                >
                                    {registered.retired
                                        ? t('admin.validationCategoryRetired')
                                        : `${t('admin.categoryMatched')}: ${categories.label(String(categoryId))}`}
                                </p>
                            )}
                            {minting && (
                                <div className="mt-2 flex flex-col gap-1.5">
                                    <p className="text-[12px] font-semibold text-gold">{t('admin.categoryMinting')}</p>
                                    <Input
                                        label={`${t('admin.categoryLabel')} - ${active.endonym}`}
                                        placeholder={`${t('admin.categoryLabel')} - ${active.endonym}`}
                                        dir={active.dir}
                                        value={draft.categoryLabel()[writing]}
                                        onInput={(next) => draft.setCategoryLabel(writing, next)}
                                    />
                                    <p className="text-[12px] text-faint">{t('admin.categoryIdHint')}</p>
                                </div>
                            )}
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {suggestions.map((entry) => (
                                    <Chip
                                        key={entry.id}
                                        compact
                                        icon={categoryIcon(entry.id)}
                                        selected={String(categoryId) === entry.id}
                                        onSelect={() => draft.setCategory(entry.id)}
                                    >
                                        {categories.label(entry.id)}
                                    </Chip>
                                ))}
                            </div>
                        </div>

                        <ImageField
                            label={t('admin.formImage')}
                            value={draft.imageURI()}
                            onChange={(uri) => draft.setImageURI(uri)}
                        />
                    </div>
                )}

                {step === 'outcomes' && (
                    <div className="flex flex-col gap-2.5">
                        {draft.outcomes().map((outcome, index) => (
                            <div
                                key={String(outcome.id)}
                                className="flex flex-col gap-2 rounded-card border border-line p-3"
                            >
                                <div className="flex items-center gap-2">
                                    <div className="min-w-0 flex-1">
                                        <Input
                                            label={`${t('admin.formOutcomes')} ${index + 1} - ${active.endonym}`}
                                            placeholder={active.endonym}
                                            dir={active.dir}
                                            value={outcome.labels[writing]}
                                            onInput={(next) => draft.setOutcomeLabel(outcome.id, writing, next)}
                                        />
                                    </div>
                                    {draft.outcomes().length > 2 && (
                                        <Tooltip label={t('admin.removeOutcome')}>
                                            <button
                                                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-control text-muted transition-colors duration-200 hover:bg-no-soft hover:text-no"
                                                type="button"
                                                aria-label={t('admin.removeOutcome')}
                                                onClick={() => draft.removeOutcome(outcome.id)}
                                            >
                                                <Icon name="trash" size={16} />
                                            </button>
                                        </Tooltip>
                                    )}
                                </div>
                                {/* The English name is what identifies the answer everywhere else -
                                     the on-chain id, the binary Yes/No collapse - so it is shown
                                     beside a translation rather than hidden behind the picker. */}
                                {writing !== 'en' && outcome.labels.en.trim() !== '' && (
                                    <p className="text-[12px] text-faint">
                                        <bdi dir="ltr">{outcome.labels.en.trim()}</bdi>
                                    </p>
                                )}
                                <ImageField
                                    label={t('admin.outcomeIcon')}
                                    value={outcome.icon}
                                    onChange={(uri) => draft.setOutcomeIcon(outcome.id, uri)}
                                />
                            </div>
                        ))}
                        {draft.outcomes().length < 16 && (
                            <Button variant="ghost" size="sm" icon="plus" onClick={() => draft.addOutcome()}>
                                {t('admin.addOutcome')}
                            </Button>
                        )}
                    </div>
                )}

                {step === 'timing' && (
                    <div className="flex flex-col gap-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                                <p className="mb-1 text-[12px] font-semibold text-muted">{t('admin.formStart')}</p>
                                <DateField
                                    label={t('admin.formStart')}
                                    placeholder={t('admin.formStartNow')}
                                    value={draft.startAt()}
                                    onChange={(next) => draft.setStartAt(next)}
                                />
                                <p className="mt-1 text-[12px] text-faint">{t('admin.formStartHint')}</p>
                            </div>
                            <div>
                                <p className="mb-1 text-[12px] font-semibold text-muted">{t('admin.formStop')}</p>
                                <DateField
                                    label={t('admin.formStop')}
                                    value={draft.lockAt()}
                                    onChange={(next) => draft.setLockAt(next)}
                                    min={draft.startAt() === '' ? new Date() : new Date(draft.startAt())}
                                />
                                <p className="mt-1 text-[12px] text-faint">{t('admin.formStopHint')}</p>
                            </div>
                            {/* Under the STOP field, in both directions: the window is measured from
                                 that instant, and a grid column index follows the writing direction. */}
                            <div className="sm:col-start-2">
                                <p className="mb-1 text-[12px] font-semibold text-muted">
                                    {t('admin.formResolveWindow')}
                                </p>
                                <Input
                                    type="number"
                                    label={t('admin.formResolveWindow')}
                                    value={draft.resolveHours()}
                                    onInput={(next) => draft.setResolveHours(next)}
                                />
                                {/* The instant itself, not the arithmetic: an author who cannot see
                                     what "+72" lands on has no way to tell a Sunday from a holiday. */}
                                <p className="mt-1 text-[12px] text-faint">
                                    {resolveSeconds === 0 ? (
                                        t('admin.formResolveHint')
                                    ) : (
                                        <>
                                            {t('admin.formResolveOpens')}{' '}
                                            <bdi>
                                                {formatDateTime(
                                                    new Date(resolveSeconds * 1000).toISOString(),
                                                    lang(),
                                                    calendarSystem()
                                                )}
                                            </bdi>
                                        </>
                                    )}
                                </p>
                            </div>
                        </div>
                        <div>
                            <p className="mb-1 text-[12px] font-semibold text-muted">{t('admin.formKind')}</p>
                            <div className="flex flex-wrap gap-2">
                                <Chip compact selected={!pool} onSelect={() => draft.setKind('amm')}>
                                    {t('admin.kindAmm')}
                                </Chip>
                                <Chip compact selected={pool} onSelect={() => draft.setKind('pool')}>
                                    {t('admin.kindPool')}
                                </Chip>
                            </div>
                            <p className="mt-1 text-[12px] leading-relaxed text-faint">
                                {pool ? t('admin.kindPoolHint') : t('admin.kindAmmHint')}
                            </p>
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            {!pool && (
                                <div>
                                    <p className="mb-1 text-[12px] font-semibold text-muted">
                                        {t('admin.formLiquidity')} ({chain.nativeCurrency.symbol})
                                    </p>
                                    <Input
                                        type="number"
                                        label={t('admin.formLiquidity')}
                                        placeholder="100"
                                        value={draft.liquidity()}
                                        onInput={(next) => draft.setLiquidity(next)}
                                    />
                                </div>
                            )}
                            <div>
                                <p className="mb-1 text-[12px] font-semibold text-muted">{t('admin.formFee')}</p>
                                <Input
                                    type="number"
                                    label={t('admin.formFee')}
                                    value={draft.feeBps()}
                                    onInput={(next) => draft.setFeeBps(next)}
                                />
                            </div>
                            {!pool && (
                                <div>
                                    <p className="mb-1 text-[12px] font-semibold text-muted">
                                        {t('admin.formProtocolShare')}
                                    </p>
                                    <Input
                                        type="number"
                                        label={t('admin.formProtocolShare')}
                                        value={draft.protocolShareBps()}
                                        onInput={(next) => draft.setProtocolShareBps(next)}
                                    />
                                </div>
                            )}
                        </div>
                        <p className="text-[12px] text-faint">{t('admin.inheritHint')}</p>
                    </div>
                )}

                {step === 'review' && (
                    <div className="flex flex-col gap-3">
                        <div className="flex items-start gap-3 rounded-card border border-line p-3.5">
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-control bg-overlay text-[21px]">
                                {draft.imageURI().trim() !== '' ? (
                                    <img className="h-full w-full object-cover" src={draft.imageURI().trim()} alt="" />
                                ) : (
                                    <span>{draft.emoji() === '' ? '?' : draft.emoji()}</span>
                                )}
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="text-[15px] font-bold leading-snug">{title.en.trim()}</p>
                                {written.length > 1 && (
                                    <p className="mt-1 text-[12px] text-muted">
                                        {written.map((row) => row.endonym).join(' · ')}
                                    </p>
                                )}
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {names.map((entry) => (
                                <span
                                    key={entry.label.en}
                                    className="rounded-full bg-overlay px-3 py-1 text-[13px] font-semibold"
                                >
                                    {entry.label.en}
                                </span>
                            ))}
                        </div>
                        <dl className="grid grid-cols-2 gap-2 text-[13px]">
                            <div className="flex justify-between gap-2">
                                <dt className="text-muted">{t('admin.formCategory')}</dt>
                                <dd className="font-semibold">
                                    {registered === undefined
                                        ? trimText(draft.categoryLabel()).en
                                        : categories.label(String(categoryId))}{' '}
                                    <span className="nums latin-nums text-faint" dir="ltr">
                                        #{categoryId ?? 0}
                                    </span>
                                </dd>
                            </div>
                            <div className="flex justify-between gap-2">
                                <dt className="text-muted">{t('admin.formKind')}</dt>
                                <dd className="font-semibold">{pool ? t('admin.kindPool') : t('admin.kindAmm')}</dd>
                            </div>
                            {!pool && (
                                <div className="flex justify-between gap-2">
                                    <dt className="text-muted">{t('admin.formLiquidity')}</dt>
                                    <dd className="nums latin-nums font-semibold">
                                        <bdi dir="ltr">
                                            {draft.liquidity()} {chain.nativeCurrency.symbol}
                                        </bdi>
                                    </dd>
                                </div>
                            )}
                            <div className="flex justify-between gap-2">
                                <dt className="text-muted">{t('admin.formFee')}</dt>
                                <dd className="nums latin-nums font-semibold">
                                    <bdi dir="ltr">{draft.feeBps()}</bdi>
                                </dd>
                            </div>
                            {!pool && (
                                <div className="flex justify-between gap-2">
                                    <dt className="text-muted">{t('admin.formProtocolShare')}</dt>
                                    <dd className="nums latin-nums font-semibold">
                                        <bdi dir="ltr">{draft.protocolShareBps()}</bdi>
                                    </dd>
                                </div>
                            )}
                        </dl>
                    </div>
                )}

                {stepIssue !== '' && visited.includes(step) && (
                    <p className="mt-3 text-[13px] font-semibold text-no">{stepIssue}</p>
                )}
                {step === 'review' && issue !== '' && <p className="mt-3 text-[13px] font-semibold text-no">{issue}</p>}

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-4">
                    <Button
                        variant="ghost"
                        size="sm"
                        icon="arrow-left"
                        disabled={step === 'question'}
                        onClick={() => back()}
                    >
                        {t('common.back')}
                    </Button>
                    {step === 'review' ? (
                        <Button
                            variant="primary"
                            icon="sparkles"
                            disabled={issue !== '' || onchain.pending()}
                            loading={onchain.busy('create')}
                            onClick={() => void submit()}
                        >
                            {t('admin.submitCreate')}
                        </Button>
                    ) : (
                        <Button variant="outline" size="sm" disabled={stepIssue !== ''} onClick={() => advance()}>
                            {t('common.next')}
                        </Button>
                    )}
                </div>
            </Card>
        </div>
    );
}
