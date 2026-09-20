import { useEffect, useState } from 'react';

import { parseEther } from 'viem';

import { CONTENT_LANGS, encodeTitleMeta, encodeTextMeta, type ContentLang, type Localized } from '../../api.ts';

import { categoryIcon, categoryIdOf, isImageURI, isRegistryId, matchesText } from '../../lib/market.ts';
import { chain, explorerTxUrl } from '../../lib/chain.ts';

import { fieldDir, LANGS, langRow } from '../../i18n/langs.ts';
import { formatDateTime } from '../../i18n/format.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { usePreferences } from '../../stores/preferences.store.ts';
import { useAdmin } from '../../stores/admin.store.ts';
import { useOnchain } from '../../stores/onchain.store.ts';
import {
    useCreateDraft,
    draftToQuery,
    hasText,
    trimText,
    FEE_BPS_DEFAULT,
    LIQUIDITY_DEFAULT,
    RESOLVE_HOURS_DEFAULT
} from '../../stores/create-draft.store.ts';
import { useCategories } from '../../stores/categories.store.ts';

import Icon from '../../icons/icon.tsx';

import DraftPreview from './draft-preview.tsx';
import ImageField from './image-field.tsx';
import LanguagePicker from './language-picker.tsx';

import Tooltip from '../ui/tooltip.tsx';
import Card from '../ui/card.tsx';
import Button from '../ui/button.tsx';
import Chip from '../ui/chip.tsx';
import Input from '../ui/input.tsx';
import DateField from '../ui/date-field.tsx';
import TagField from '../ui/tag-field.tsx';

const EMOJI = ['🔥', '₿', '⚽', '🏆', '🗳️', '🎬', '🚀', '📈', '📉', '🌍', '🧪', '💻', '🎮', '🏛️', '⚖️', '🎯'];

/** The three groups of fields, and the unit validation reports against. NOT steps: everything
 *  is on the page at once, and a group is only how a complaint says where it belongs. */
type Group = 'question' | 'outcomes' | 'timing';

const FEE_MAX = 1000;

/** A month. Past this the resolve time stops being a schedule and starts being a typo. */
const RESOLVE_MAX_HOURS = 720;

/** True when a label was written in English and nothing else - it rides the chain as a plain
 *  string rather than a one-key envelope, which is what every older market already looks like. */
function englishOnly(label: Localized): boolean
{
    return CONTENT_LANGS.every((code) => code === 'en' || label[code] === undefined);
}

// The create surface: ONE page carrying every field, not a wizard. It used to be four steps,
// which meant an author could not see what they had written, could not fix a fee without
// walking back through the question, and could not tell whether a deploy was one field away
// or six. The groups survive as headings; nothing is hidden behind a Next button.
//
// The question, the rules and every answer are written in as many of the app's languages as
// the author has - ONE language picker drives every text field, because ten stacked field
// pairs is not a form anyone fills in. English is the required floor: it is what a reader in
// an untranslated language falls back to, so a market without it would be unreadable to most
// of the world.
//
// The category is FREE TEXT over the registered ones - typing a new name mints it. Every
// field lives in the draft store so leaving the section and coming back does not lose a
// half-written market, and the whole draft can be filed as a proposal for the owner to sign.
export default function CreateMarketForm(props: {
    /**
     * False for a wallet the console INVITED to prepare markets rather than run it. The
     * factory gates `createMarket` on ADMIN_ROLE and has no create-only role, so such a wallet
     * cannot sign a deploy at all - the button would be a prompt that always reverts. It files
     * the draft as a PROPOSAL instead, and the owner signs it from the same form.
     */
    canDeploy?: boolean;
})
{
    const { t, lang } = useLocale();
    const { calendarSystem } = usePreferences();
    const admin = useAdmin();
    const onchain = useOnchain();
    const draft = useCreateDraft();
    const categories = useCategories();

    const canDeploy = props.canDeploy !== false;

    const [writing, setWriting] = useState<ContentLang>('en');
    const [created, setCreated] = useState<{ hash: string; marketId: number | null; address: string | null } | null>(
        null
    );

    /** The proposal just filed, by number - what the author quotes if they have to ask. */
    const [proposed, setProposed] = useState<number | null>(null);

    /** Reviewing the draft rather than editing it. A proposal is read by somebody else, so the
     *  last thing the author sees before sending is what that reader will see - not the form. */
    const [previewing, setPreviewing] = useState(false);

    /** The proposal POST is in flight. The deploy has `onchain.busy`; this has nothing else. */
    const [filing, setFiling] = useState(false);

    /** A deploy has been ATTEMPTED. Until then an untouched group keeps quiet. */
    const [tried, setTried] = useState(false);

    // The trade fee a new market is born with belongs to the FACTORY, not to this form, and it
    // is the same number the Config card edits. It arrives from a chain read, so it is written
    // in when it lands rather than at first paint - and the store drops it on the floor if the
    // author or a draft link has already picked a fee.
    const factory = admin.defaults.data();
    const seedFee = (): void =>
    {
        if (factory !== undefined)
        {
            draft.seedFee(String(factory.defaultFeeBps));
        }
    };
    useEffect(() =>
    {
        seedFee();
        // oxlint-disable-next-line react/exhaustive-deps
    }, [factory]);

    const title = draft.title();
    const description = draft.description();

    // Only registry ids can be offered: the factory takes a uint32 and rejects anything it
    // has not been told about, so the names markets carried before the registry are history
    // the picker cannot deploy against.
    //
    // What is TYPED, though, is matched against the name as well as the id. The field used to
    // filter on `id.startsWith`, which meant the only way to find a category was to already
    // know its number - and the numbers are exactly the part nobody remembers. `matchesText`
    // is the same any-language match the rest of the app searches with, so typing `foot`,
    // `فوتبال` or `12` all reach the same chip.
    const typed = draft.category().trim();
    const suggestions = categories
        .active()
        .filter((entry) => isRegistryId(entry.id))
        .filter(
            (entry) =>
                typed === '' ||
                entry.id.startsWith(typed) ||
                matchesText(entry.label, typed) ||
                categories.label(entry.id).toLowerCase().includes(typed.toLowerCase())
        )
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

    // A parimutuel pool: no AMM and no liquidity providers, so there is no seed liquidity to
    // ask for - which is why that field disappears.
    const pool = draft.kind() === 'pool';

    const imageValid = draft.imageURI().trim() === '' || isImageURI(draft.imageURI());
    const feeValid =
        Number.isFinite(Number(draft.feeBps())) && Number(draft.feeBps()) >= 0 && Number(draft.feeBps()) <= FEE_MAX;

    // Per-group, so a missing English title never reports itself as an outcomes problem.
    const issueFor = (which: Group): string =>
    {
        if (which === 'question')
        {
            if (title.en.trim() === '')
            {
                return t('admin.validationTitle');
            }
            if (draft.category().trim() === '')
            {
                return t('admin.validationCategory');
            }
            if (categoryId === null)
            {
                return suggestions.length === 0 ? t('admin.categoryIdInvalid') : t('admin.categoryPick');
            }
            // Retiring a category leaves its markets alone and stops new ones. The factory
            // enforces that, so the form says so before a deploy spends gas finding out.
            if (registered?.retired === true)
            {
                return t('admin.validationCategoryRetired');
            }
            if (minting && !categoryNamed)
            {
                return t('admin.validationCategoryLabel');
            }
            if (!imageValid)
            {
                return t('admin.validationImage');
            }
            return '';
        }
        if (which === 'outcomes')
        {
            if (halfFilled)
            {
                return t('admin.validationOutcomeEn');
            }
            if (names.length < 2)
            {
                return t('admin.validationOutcomes');
            }
            return '';
        }
        if (lockSeconds <= Math.floor(Date.now() / 1000))
        {
            return t('admin.validationTiming');
        }
        // A start after the stop time is a market that never trades: the pause would lift
        // into a betting window that had already closed.
        if (startSeconds !== 0 && startSeconds >= lockSeconds)
        {
            return t('admin.formStartPast');
        }
        if (!resolveValid)
        {
            return t('admin.validationResolveWindow');
        }
        // A pool forms its prize from the bets themselves: it is deployed with no value
        // attached at all, and the factory rejects the call outright if any is sent.
        if (!pool && (draft.liquidity().trim() === '' || !(Number(draft.liquidity()) > 0)))
        {
            return t('admin.validationLiquidity');
        }
        if (!feeValid)
        {
            return t('admin.validationFee');
        }
        return '';
    };

    const issue = issueFor('question') || issueFor('outcomes') || issueFor('timing');

    // An untouched group is not a group with mistakes in it. A complaint appears once someone
    // has written in that part of the form, or once they have asked for a deploy.
    const startedIn: Record<Group, boolean> = {
        question:
            hasText(title) ||
            hasText(description) ||
            draft.category().trim() !== '' ||
            draft.imageURI().trim() !== '' ||
            draft.tags().length > 0 ||
            draft.emoji() !== '',
        outcomes: started.length > 0,
        timing: draft.startAt() !== '' || draft.lockAt() !== '' || draft.liquidity().trim() !== ''
    };

    /** The complaint to print under a group. Two of them already print under the category
     *  field itself, and the same sentence twice on one card reads as two problems. */
    const shownIssue = (which: Group): string =>
    {
        const found = tried || startedIn[which] ? issueFor(which) : '';
        const inline =
            found === t('admin.categoryIdInvalid') ||
            found === t('admin.categoryPick') ||
            found === t('admin.validationCategoryRetired');
        return inline ? '' : found;
    };

    const submit = async (): Promise<void> =>
    {
        setTried(true);
        if (issue !== '')
        {
            return;
        }
        // Any start time at all means the scheduled flow. Comparing it to "now" here would put
        // a clock read in the render body, and a start time already past simply opens on the
        // server's next tick - which is what asking for it meant.
        const scheduled = startSeconds !== 0;

        // The ID is registered WITH its names BEFORE the deploy: a market carries nothing but
        // the number, and the factory rejects one it has not been told about. It costs a second
        // transaction, and a registered category with no market of its own is legal by design.
        if (minting && categoryId !== null && !(await admin.addCategory(categoryId, trimText(draft.categoryLabel()))))
        {
            return;
        }

        const input = {
            title: encodeTitleMeta({ ...trimText(title), emoji: draft.emoji().trim(), tags: draft.tags() }),
            description: encodeTextMeta(trimText(description)),
            categoryId: categoryId ?? 0,
            imageURI: draft.imageURI().trim(),
            lockTime: lockSeconds,
            resolveTime: resolveSeconds,
            feeBps: Number(draft.feeBps()) || 0,
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
        if (result !== null)
        {
            // A market that came out of the QUEUE is answered by the deploy itself - recording
            // the verdict separately would be a second thing to remember, and a proposal left
            // pending under a market that already exists is how one gets deployed twice. Not
            // awaited: it is a signature prompt of its own, and the market exists either way.
            const fromProposal = draft.proposalId();
            if (fromProposal !== null)
            {
                void admin.decideProposal(fromProposal, true, '');
            }
            // The transaction LANDED. Clear the draft even when the log did not parse, because
            // the market exists either way and a pre-filled form invites a duplicate deploy.
            setCreated({
                hash: result.hash,
                marketId: result.market?.marketId ?? null,
                address: result.market?.address ?? null
            });
            draft.reset();
            // A cleared form is a fresh one, and a fresh one starts on the factory's fee
            // again - the reset put the store back on its own opening number.
            seedFee();
            setWriting('en');
            setTried(false);
        }
    };

    // The draft, filed for the owner to sign off on. This is the half of the job that happens
    // somewhere else: a market worked out in a chat is written down here, usually by a wallet
    // that cannot deploy anything at all. It used to be handed over as a LINK, which only
    // worked if the author also had a way to reach the owner and the owner remembered to open
    // it; the queue is the console's now, and it carries FIELDS, never a signature.
    //
    // Validated exactly as a deploy is, and for the same reason: a proposal is a market
    // someone else is being asked to sign, so the missing half-filled answer should be found
    // by the person who can still fix it.
    const review = (): void =>
    {
        setTried(true);
        if (issue !== '')
        {
            return;
        }
        setPreviewing(true);
    };

    const propose = async (): Promise<void> =>
    {
        setFiling(true);
        const id = await admin.submitProposal(draftToQuery(draft.fields()));
        setFiling(false);
        if (id !== null)
        {
            setProposed(id);
            setPreviewing(false);
            draft.reset();
            seedFee();
            setWriting('en');
            setTried(false);
        }
    };

    const again = (): void =>
    {
        setCreated(null);
        setProposed(null);
        setTried(false);
    };

    const FIELD =
        'w-full rounded-control border border-line bg-raised px-3.5 text-[15px] text-text placeholder:text-faint transition-colors duration-200 focus:border-brand focus:outline-none';

    /** The rule every group heading follows: name on the start side, a tick once it is clean. */
    const HEADING = 'mb-4 flex items-center gap-2 border-b border-line pb-3';

    // The hint is page copy, so it decides the direction of the field while the field is empty.
    const descriptionHint = t('admin.formDescription');

    const active = langRow(writing);

    if (previewing)
    {
        return (
            <DraftPreview
                fields={draft.fields()}
                busy={filing}
                confirmLabel={t('admin.propose')}
                onBack={() => setPreviewing(false)}
                onConfirm={() => void propose()}
            />
        );
    }

    if (proposed !== null)
    {
        return (
            <Card className="mx-auto max-w-lg text-center">
                <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand">
                    <Icon name="send" size={24} />
                </span>
                <p className="text-[17px] font-bold">{t('admin.proposedTitle')}</p>
                <p className="mt-1 text-[13px] text-muted">{t('admin.proposedHint')}</p>
                <p className="nums latin-nums mt-3 text-[12px] text-faint">
                    <bdi dir="ltr">#{proposed}</bdi>
                </p>
                <div className="mt-4 flex justify-center">
                    <Button variant="outline" size="sm" icon="plus" onClick={() => again()}>
                        {t('admin.proposeAgain')}
                    </Button>
                </div>
            </Card>
        );
    }

    if (created !== null)
    {
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
            {/* ONE picker for every text field on the page: an author writes the question, the
                rules and the answers in a language, then switches once and does the next. */}
            <Card>
                <LanguagePicker
                    value={writing}
                    onChange={setWriting}
                    filled={(code) => written.some((entry) => entry.code === code)}
                />
            </Card>

            <Card>
                <div className={HEADING}>
                    <h2 className="min-w-0 flex-1 text-[15px] font-bold tracking-tight">{t('admin.stepquestion')}</h2>
                    {issueFor('question') === '' && <Icon className="text-yes" name="circle-check" size={16} />}
                </div>

                <div className="flex flex-col gap-3">
                    <Input
                        label={`${ t('admin.formTitle') } - ${ active.endonym }`}
                        placeholder={t('admin.formTitle')}
                        dir={active.dir}
                        value={title[writing]}
                        onInput={(next) => draft.setTitle(writing, next)}
                    />

                    <textarea
                        className={`${ FIELD } h-24 resize-none py-2.5`}
                        aria-label={`${ t('admin.formDescription') } - ${ active.endonym }`}
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
                            icon="search"
                            label={t('admin.formCategory')}
                            placeholder={t('admin.categoryHint')}
                            value={draft.category()}
                            onInput={(next) => draft.setCategory(next)}
                        />
                        {/* Quiet while the text is still FINDING something: typing a name is
                             how this field is meant to be used now, and every keystroke of
                             `football` is an invalid id on the way to a valid chip. It has to
                             speak the moment a deploy is asked for, though - a name nobody
                             turned into a chip is the one way to press the button and have
                             nothing at all happen. */}
                        {typed !== '' &&
                            categoryId === null &&
                            (suggestions.length === 0 ? (
                                <p className="mt-1 text-[12px] font-semibold text-no">{t('admin.categoryIdInvalid')}</p>
                            ) : (
                                tried && (
                                    <p className="mt-1 text-[12px] font-semibold text-no">{t('admin.categoryPick')}</p>
                                )
                            ))}
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
                                    : `${ t('admin.categoryMatched') }: ${ categories.label(String(categoryId)) }`}
                            </p>
                        )}
                        {minting && (
                            <div className="mt-2 flex flex-col gap-1.5">
                                <p className="text-[12px] font-semibold text-gold">{t('admin.categoryMinting')}</p>
                                <Input
                                    label={`${ t('admin.categoryLabel') } - ${ active.endonym }`}
                                    placeholder={`${ t('admin.categoryLabel') } - ${ active.endonym }`}
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

                    {/* Beside the category on purpose: one market has ONE category and as
                         many tags as it is about. A league fixture is `football`, `iran` and
                         `league` at once, and only the tags can say all three. */}
                    <div>
                        <p className="mb-1.5 text-[12px] font-semibold text-muted">{t('tags.label')}</p>
                        <TagField
                            label={t('tags.label')}
                            dir={active.dir}
                            value={draft.tags()}
                            onChange={(next) => draft.setTags(next)}
                        />
                    </div>
                </div>

                {shownIssue('question') !== '' && (
                    <p className="mt-3 text-[13px] font-semibold text-no">{shownIssue('question')}</p>
                )}
            </Card>

            <Card>
                <div className={HEADING}>
                    <h2 className="min-w-0 flex-1 text-[15px] font-bold tracking-tight">{t('admin.stepoutcomes')}</h2>
                    {issueFor('outcomes') === '' && <Icon className="text-yes" name="circle-check" size={16} />}
                </div>

                <div className="flex flex-col gap-2.5">
                    {draft.outcomes().map((outcome, index) => (
                        <div
                            key={String(outcome.id)}
                            className="flex flex-col gap-2 rounded-card border border-line p-3"
                        >
                            <div className="flex items-center gap-2">
                                <div className="min-w-0 flex-1">
                                    <Input
                                        label={`${ t('admin.formOutcomes') } ${ index + 1 } - ${ active.endonym }`}
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

                {shownIssue('outcomes') !== '' && (
                    <p className="mt-3 text-[13px] font-semibold text-no">{shownIssue('outcomes')}</p>
                )}
            </Card>

            <Card>
                <div className={HEADING}>
                    <h2 className="min-w-0 flex-1 text-[15px] font-bold tracking-tight">{t('admin.steptiming')}</h2>
                    {issueFor('timing') === '' && <Icon className="text-yes" name="circle-check" size={16} />}
                </div>

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
                                placeholder={t('admin.formStopEmpty')}
                                value={draft.lockAt()}
                                onChange={(next) => draft.setLockAt(next)}
                                min={draft.startAt() === '' ? new Date() : new Date(draft.startAt())}
                            />
                            <p className="mt-1 text-[12px] text-faint">{t('admin.formStopHint')}</p>
                        </div>
                        {/* Under the STOP field, in both directions: the window is measured from
                             that instant, and a grid column index follows the writing direction. */}
                        <div className="sm:col-start-2">
                            <p className="mb-1 text-[12px] font-semibold text-muted">{t('admin.formResolveWindow')}</p>
                            <Input
                                type="number"
                                label={t('admin.formResolveWindow')}
                                placeholder={RESOLVE_HOURS_DEFAULT}
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
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {!pool && (
                            <div>
                                <p className="mb-1 text-[12px] font-semibold text-muted">
                                    {t('admin.formLiquidity')} ({chain.nativeCurrency.symbol})
                                </p>
                                <Input
                                    type="number"
                                    label={t('admin.formLiquidity')}
                                    placeholder={LIQUIDITY_DEFAULT}
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
                                placeholder={FEE_BPS_DEFAULT}
                                value={draft.feeBps()}
                                onInput={(next) => draft.setFeeBps(next)}
                            />
                        </div>
                    </div>
                    <p className="text-[12px] text-faint">{t('admin.inheritHint')}</p>
                </div>

                {shownIssue('timing') !== '' && (
                    <p className="mt-3 text-[13px] font-semibold text-no">{shownIssue('timing')}</p>
                )}
            </Card>

            {/* Deploy, and nothing else. There was a review card here that reprinted the
                question, the answers, the category and the fee - every one of them already
                on screen a few centimetres above, in the fields an author would go back and
                edit anyway. A summary of a form you can still see is a second thing to
                proof-read, not a safeguard. */}
            <Card>
                {/* The button stays LIVE while the draft is incomplete: a dead button explains
                    nothing, and pressing it is how an author asks what is still missing. */}
                {tried && issue !== '' && <p className="mb-3 text-[13px] font-semibold text-no">{issue}</p>}

                {canDeploy ? (
                    // Beside the deploy button, because parking the draft and signing it are
                    // the same decision made two ways - and the draft is only worth filing
                    // once it is finished, which is here rather than at the top of the page
                    // where the button used to sit above an empty form.
                    //
                    // A form opened FROM the queue offers no propose button: re-filing a
                    // proposal as a second proposal is the one thing it cannot usefully do.
                    <div className="flex flex-wrap items-center gap-3">
                        <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-faint">
                            {draft.proposalId() === null ? t('admin.proposeHint') : t('admin.reviewingProposal')}
                        </p>
                        {draft.proposalId() === null && (
                            <Button variant="ghost" icon="send" onClick={() => review()}>
                                {t('admin.propose')}
                            </Button>
                        )}
                        <Button
                            variant="primary"
                            icon="sparkles"
                            disabled={onchain.pending()}
                            loading={onchain.busy('create')}
                            onClick={() => void submit()}
                        >
                            {t('admin.submitCreate')}
                        </Button>
                    </div>
                ) : (
                    // No deploy button at all, rather than a disabled one: this wallet is not
                    // waiting on a missing field, it will never be able to sign this.
                    <div className="flex flex-wrap items-center gap-3">
                        <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-muted">
                            {t('admin.contributorNoDeploy')}
                        </p>
                        <Button variant="primary" icon="send" onClick={() => review()}>
                            {t('admin.propose')}
                        </Button>
                    </div>
                )}
            </Card>
        </div>
    );
}
