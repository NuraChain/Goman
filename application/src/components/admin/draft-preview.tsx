import { useState, type ReactNode } from 'react';

import { categoryIdOf } from '../../lib/market.ts';

import { LANGS, langRow, type Lang } from '../../i18n/langs.ts';
import { formatDateTime, formatMoney, formatOddsSet } from '../../i18n/format.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { usePreferences } from '../../stores/preferences.store.ts';
import { useCategories } from '../../stores/categories.store.ts';
import { hasText, type DraftFields, type TextDraft } from '../../stores/create-draft.store.ts';

import Icon from '../../icons/icon.tsx';

import MarketAvatar from '../market/market-avatar.tsx';
import Badge from '../ui/badge.tsx';
import Button from '../ui/button.tsx';
import Card from '../ui/card.tsx';
import ChanceRing from '../ui/chance-ring.tsx';
import { chipClass } from '../ui/variants.ts';

// The last look before a draft leaves the form.
//
// It exists because a proposal is read by SOMEBODY ELSE. The form is a form - fourteen fields,
// ten language tabs and a validation line - and none of that is what the market will look like
// to the person deciding whether to sign it. This is: the question, the answers, the art and
// the dates, laid out the way a reader meets them.
//
// Built from the card's own primitives rather than from MarketCard itself, which is made of
// LINKS - to a market page that does not exist yet, and a favourite button that would star a
// market id nobody has. A preview that navigates is not a preview.
//
// It takes plain `DraftFields` rather than the draft store, so the same screen can later show
// a proposal pulled from the queue without either side learning about the other.

/** Even money. A market that has not traded opens with its outcomes priced alike, and showing
 *  anything else would be inventing a probability nobody has set. */
function openingPrices(count: number): number[]
{
    return Array.from({ length: count }, () => (count === 0 ? 0 : 1 / count));
}

/** The reader's language where the author wrote it, English where they did not - the same
 *  fallback every market on the site already gets. */
function read(text: TextDraft, lang: Lang): string
{
    const written = text[lang].trim();
    return written === '' ? text.en.trim() : written;
}

/** One line of the spec table. Module level, not a closure inside the render: a component
 *  redefined every render is a component React remounts every render. */
function Row(props: { label: string; children: ReactNode })
{
    return (
        <div className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 last:border-b-0">
            <dt className="shrink-0 text-[12px] font-semibold text-muted">{props.label}</dt>
            <dd className="min-w-0 text-end text-[13px] font-semibold">{props.children}</dd>
        </div>
    );
}

export default function DraftPreview(props: {
    fields: DraftFields;

    /** Back to the form, with everything still in it. */
    onBack: () => void;

    /** The action this screen is the last step of. */
    onConfirm: () => void;
    confirmLabel: string;
    busy?: boolean;
})
{
    const { t, lang } = useLocale();
    const { calendarSystem, oddsMode } = usePreferences();
    const categories = useCategories();

    // Which language the preview is READ in. It starts on the page's own, and the switcher
    // offers only the languages this draft was actually written in - a tab showing the English
    // fallback under a Persian name would tell the author a translation landed when it did not.
    const [reading, setReading] = useState<Lang>(lang());

    const fields = props.fields;
    const written = LANGS.filter(
        (row) =>
            fields.title[row.code].trim() !== '' ||
            fields.description[row.code].trim() !== '' ||
            fields.outcomes.some((outcome) => outcome.labels[row.code].trim() !== '')
    );
    const active: Lang = written.some((row) => row.code === reading) ? reading : 'en';

    const answers = fields.outcomes.filter((outcome) => hasText(outcome.labels));
    const odds = formatOddsSet(openingPrices(answers.length), lang(), oddsMode());

    // A Yes/No market gets the ring, exactly as the real card does; anything else is a list of
    // candidates, where a single "chance" figure would be the chance of nothing in particular.
    const binary =
        answers.length === 2 &&
        answers[0]?.labels.en.trim().toLowerCase() === 'yes' &&
        answers[1]?.labels.en.trim().toLowerCase() === 'no';

    const categoryId = categoryIdOf(fields.category);
    const minted = read(fields.categoryLabel, active);
    const categoryName = categoryId === null ? '' : minted !== '' ? minted : categories.label(String(categoryId));

    const stops = fields.lockAt === '' ? null : new Date(fields.lockAt);
    const starts = fields.startAt === '' ? null : new Date(fields.startAt);
    const hours = Number(fields.resolveHours);
    const resolves =
        stops === null || !Number.isFinite(hours) ? null : new Date(stops.getTime() + hours * 60 * 60 * 1000);

    const when = (at: Date | null): string =>
        at === null || Number.isNaN(at.getTime()) ? '—' : formatDateTime(at.toISOString(), lang(), calendarSystem());

    return (
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
            <header className="text-center motion-safe:animate-rise">
                <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand">
                    <Icon name="search" size={22} />
                </span>
                <h2 className="text-[19px] font-bold tracking-tight">{t('admin.previewTitle')}</h2>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">{t('admin.previewHint')}</p>
            </header>

            {/* Above the card, not inside it: this changes what you are READING, which is not a
                property of the market. Absent on a one-language draft, where it would be a
                control with a single setting. */}
            {written.length > 1 && (
                <div className="flex flex-wrap justify-center gap-1.5">
                    {written.map((row) => (
                        <button
                            key={row.code}
                            type="button"
                            className={chipClass(row.code === active, true)}
                            onClick={() => setReading(row.code)}
                        >
                            {row.endonym}
                        </button>
                    ))}
                </div>
            )}

            {/* The market as a reader meets it. `dir` follows the language being read, not the
                console's - a Persian question inside an English admin session still has to set
                its own punctuation and alignment. */}
            <div dir={langRow(active).dir}>
                <Card className="motion-safe:animate-rise">
                    <div className="mb-3 flex items-start gap-3">
                        <MarketAvatar image={fields.imageURI.trim()} emoji={fields.emoji.trim()} size="md" />
                        <p className="min-w-0 flex-1 text-[17px] font-bold leading-snug">
                            {read(fields.title, active) === ''
                                ? t('admin.proposalUntitled')
                                : read(fields.title, active)}
                        </p>
                        {binary && (
                            <span className="relative flex h-11 w-11 shrink-0 items-center justify-center">
                                <span className="absolute inset-0">
                                    <ChanceRing share={0.5} size={44} />
                                </span>
                                <span className="nums relative text-[11px] font-bold text-brand">{odds[0] ?? ''}</span>
                            </span>
                        )}
                    </div>

                    {read(fields.description, active) !== '' && (
                        <p className="mb-3 whitespace-pre-line text-[13px] leading-relaxed text-muted">
                            {read(fields.description, active)}
                        </p>
                    )}

                    <div className="mb-3 flex flex-col gap-2">
                        {answers.map((outcome, index) => (
                            <div
                                key={index}
                                className="flex items-center gap-2.5 rounded-control bg-overlay px-3 py-2.5"
                            >
                                {outcome.icon.trim() === '' ? (
                                    <span className="h-6 w-6 shrink-0 rounded-full bg-raised"></span>
                                ) : (
                                    <span className="h-6 w-6 shrink-0 overflow-hidden rounded-full bg-raised">
                                        <img className="h-full w-full object-cover" src={outcome.icon.trim()} alt="" />
                                    </span>
                                )}
                                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                                    {read(outcome.labels, active)}
                                </span>
                                {/* The opening price, not a guess at the answer: every outcome
                                    starts level and the first trade is what moves it. */}
                                <span className="nums shrink-0 text-[14px] font-bold text-brand">
                                    {odds[index] ?? ''}
                                </span>
                            </div>
                        ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[12px] text-faint">
                        {categoryName !== '' && (
                            <span className="flex items-center gap-1.5">
                                <Icon name="tag" size={13} />
                                <span>{categoryName}</span>
                            </span>
                        )}
                        {stops !== null && (
                            <span className="nums flex items-center gap-1 whitespace-nowrap rounded-full border border-line px-2 py-0.5">
                                <Icon name="clock" size={12} />
                                <bdi>{when(stops)}</bdi>
                            </span>
                        )}
                        {fields.tags.map((tag) => (
                            <span key={tag} className="rounded-full bg-overlay px-2 py-0.5 font-semibold text-muted">
                                {tag}
                            </span>
                        ))}
                    </div>
                </Card>
            </div>

            {/* Everything the card never shows, each of which costs money or a redeploy to get
                wrong. Read-only: this screen is a look, and the form is where things change. */}
            <Card>
                <dl className="flex flex-col">
                    <Row label={t('admin.formKind')}>
                        <Badge tone={fields.kind === 'pool' ? 'gold' : 'brand'}>
                            {fields.kind === 'pool' ? t('admin.kindPool') : t('admin.kindAmm')}
                        </Badge>
                    </Row>
                    <Row label={t('admin.formStart')}>
                        <bdi className="nums">{starts === null ? t('admin.formStartNow') : when(starts)}</bdi>
                    </Row>
                    <Row label={t('admin.formStop')}>
                        <bdi className="nums">{when(stops)}</bdi>
                    </Row>
                    <Row label={t('admin.formResolveOpens')}>
                        <bdi className="nums">{when(resolves)}</bdi>
                    </Row>
                    {fields.kind !== 'pool' && (
                        <Row label={t('admin.formLiquidity')}>
                            <span className="nums">{formatMoney(Number(fields.liquidity) || 0, lang())}</span>
                        </Row>
                    )}
                    <Row label={t('admin.formFee')}>
                        <span className="nums latin-nums" dir="ltr">
                            {Number(fields.feeBps) || 0} bps
                        </span>
                    </Row>
                    <Row label={t('admin.formLanguage')}>
                        <span className="text-muted">
                            {written.length === 0 ? '—' : written.map((row) => row.endonym).join(' · ')}
                        </span>
                    </Row>
                </dl>
            </Card>

            <Card>
                <div className="flex flex-wrap items-center gap-3">
                    <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-faint">
                        {t('admin.previewNothingSent')}
                    </p>
                    <Button variant="ghost" icon="edit" onClick={() => props.onBack()}>
                        {t('admin.previewBack')}
                    </Button>
                    <Button
                        variant="primary"
                        icon="send"
                        loading={props.busy === true}
                        onClick={() => props.onConfirm()}
                    >
                        {props.confirmLabel}
                    </Button>
                </div>
            </Card>
        </div>
    );
}
