import { useState } from 'react';

import { parseEther } from 'viem';

import { CONTENT_LANGS, encodeTitleMeta, encodeTextMeta, type ContentLang, type Localized } from '../../api.ts';

import { categoryIcon, isImageURI } from '../../lib/market.ts';
import { chain, explorerTxUrl } from '../../lib/chain.ts';

import { LANGS, langRow } from '../../i18n/langs.ts';

import { useLocale } from '../../stores/locale.store.ts';
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

const EMOJI = ['🔥', '₿', '⚽', '🏆', '🗳️', '🎬', '🚀', '📈', '📉', '🌍', '🧪', '💻', '🎮', '🏛️', '⚖️', '🎯'];
type Step = 'question' | 'outcomes' | 'timing' | 'review';
const STEPS: Step[] = ['question', 'outcomes', 'timing', 'review'];
const FEE_MAX = 1000;
const SHARE_MAX = 10_000;

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
    const { t } = useLocale();
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

    const suggestions = categories
        .active()
        .filter((entry) => draft.category().trim() === '' || entry.id.includes(draft.category().trim().toLowerCase()))
        .slice(0, 10);

    const matched = (categories.list.data() ?? []).some((entry) => entry.id === draft.category().trim().toLowerCase());

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

    const lockSeconds = draft.lockAt() === '' ? 0 : Math.floor(new Date(draft.lockAt()).getTime() / 1000);
    const resolveSeconds = draft.resolveAt() === '' ? 0 : Math.floor(new Date(draft.resolveAt()).getTime() / 1000);

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
            if (lockSeconds <= Math.floor(Date.now() / 1000) || resolveSeconds <= lockSeconds) {
                return t('admin.validationTiming');
            }
            if (draft.liquidity().trim() === '' || !(Number(draft.liquidity()) > 0)) {
                return t('admin.validationLiquidity');
            }
            if (!feeValid) {
                return t('admin.validationFee');
            }
            if (!shareValid) {
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
        const result = await admin.create({
            title: encodeTitleMeta({ ...trimText(title), emoji: draft.emoji().trim() }),
            description: encodeTextMeta(trimText(description)),
            category: draft.category().trim().toLowerCase(),
            imageURI: draft.imageURI().trim(),
            lockTime: lockSeconds,
            resolveTime: resolveSeconds,
            feeBps: Number(draft.feeBps()) || 0,
            protocolFeeShareBps: Number(draft.protocolShareBps()) || 0,
            outcomeNames: names.map((entry) =>
                entry.icon === '' && englishOnly(entry.label)
                    ? entry.label.en
                    : encodeTextMeta({ ...entry.label, icon: entry.icon })
            ),
            initialLiquidity: parseEther(draft.liquidity())
        });
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
                        {source !== null && (
                            <a
                                className="flex items-center gap-1.5 self-start text-[12px] font-semibold text-muted no-underline transition-colors duration-200 hover:text-brand"
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                            >
                                <Icon name="globe" size={13} />
                                <span>{t('admin.importedFrom')}</span>
                                <Icon name="external" size={12} />
                            </a>
                        )}
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
                            placeholder={t('admin.formDescription')}
                            dir={active.dir}
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
                                label={t('admin.formCategory')}
                                placeholder={t('admin.categoryHint')}
                                value={draft.category()}
                                onInput={(next) => draft.setCategory(next)}
                            />
                            {draft.category().trim() !== '' && (
                                <p
                                    className={
                                        matched
                                            ? 'mt-1 text-[12px] text-faint'
                                            : 'mt-1 text-[12px] font-semibold text-gold'
                                    }
                                >
                                    {matched ? t('admin.categoryMatched') : t('admin.categoryMinting')}
                                </p>
                            )}
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {suggestions.map((entry) => (
                                    <Chip
                                        key={entry.id}
                                        compact
                                        icon={categoryIcon(entry.id)}
                                        selected={draft.category().trim().toLowerCase() === entry.id}
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
                                <p className="mb-1 text-[12px] font-semibold text-muted">{t('admin.formLock')}</p>
                                <Input
                                    type="datetime-local"
                                    label={t('admin.formLock')}
                                    value={draft.lockAt()}
                                    onInput={(next) => draft.setLockAt(next)}
                                />
                            </div>
                            <div>
                                <p className="mb-1 text-[12px] font-semibold text-muted">{t('admin.formResolve')}</p>
                                <Input
                                    type="datetime-local"
                                    label={t('admin.formResolve')}
                                    value={draft.resolveAt()}
                                    onInput={(next) => draft.setResolveAt(next)}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                            <div>
                                <p className="mb-1 text-[12px] font-semibold text-muted">{t('admin.formFee')}</p>
                                <Input
                                    type="number"
                                    label={t('admin.formFee')}
                                    value={draft.feeBps()}
                                    onInput={(next) => draft.setFeeBps(next)}
                                />
                            </div>
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
                                <dd className="font-semibold">{draft.category().trim().toLowerCase()}</dd>
                            </div>
                            <div className="flex justify-between gap-2">
                                <dt className="text-muted">{t('admin.formLiquidity')}</dt>
                                <dd className="nums latin-nums font-semibold">
                                    <bdi dir="ltr">
                                        {draft.liquidity()} {chain.nativeCurrency.symbol}
                                    </bdi>
                                </dd>
                            </div>
                            <div className="flex justify-between gap-2">
                                <dt className="text-muted">{t('admin.formFee')}</dt>
                                <dd className="nums latin-nums font-semibold">
                                    <bdi dir="ltr">{draft.feeBps()}</bdi>
                                </dd>
                            </div>
                            <div className="flex justify-between gap-2">
                                <dt className="text-muted">{t('admin.formProtocolShare')}</dt>
                                <dd className="nums latin-nums font-semibold">
                                    <bdi dir="ltr">{draft.protocolShareBps()}</bdi>
                                </dd>
                            </div>
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
