import { useState } from 'react';

import type { CategoryCount, ContentLang } from '../../api.ts';

import { categoryIdOf, isRegistryId } from '../../lib/market.ts';

import { langRow } from '../../i18n/langs.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { useAdmin } from '../../stores/admin.store.ts';
import { useCategories } from '../../stores/categories.store.ts';
import { useOnchain } from '../../stores/onchain.store.ts';
import { useToasts } from '../../stores/toasts.store.ts';
import { emptyText, hasText, textOf, trimText, type TextDraft } from '../../stores/create-draft.store.ts';

import LanguagePicker from './language-picker.tsx';

import Button from '../ui/button.tsx';
import Card from '../ui/card.tsx';
import Icon from '../../icons/icon.tsx';
import Input from '../ui/input.tsx';
import EmptyState from '../ui/empty-state.tsx';
import Skeleton from '../ui/skeleton.tsx';

// The factory's category registry. A category is an ID and nothing else on chain; what a reader
// is shown is the meaning stored against that id, once per language, which is why the name is
// ONE field driven by the shared language picker rather than a column per language.
//
// TWO ERAS answer in this one table, and they are edited by different machinery:
//
//   A numeric id is a REGISTRY category. Its name and whether it still accepts markets live in
//   the factory, so every action on it is a transaction. It cannot be deleted - the registry
//   has no remove function at all - so it is retired instead, which leaves the markets already
//   filed under it alone.
//
//   Any other id is a PRE-REGISTRY category: a raw string carried by markets from before the
//   registry existed. The chain holds no meaning for it, so its name is a presentation row in
//   the server's own table, renamed and deleted with a signed request rather than a
//   transaction. Deleting one forgets that row and nothing else: the markets keep listing
//   under the id and simply show it raw again, which is why this is recoverable by naming the
//   same id a second time.
//
// The distinction is `isRegistryId`, and it decides which save the form runs and which actions
// a row offers. Both eras share the one name field and language picker, because what an admin
// is doing - saying what a category is CALLED, per language - is the same job either way.
export default function CategoryTable() {
    const { t, text } = useLocale();
    const admin = useAdmin();
    const categories = useCategories();
    const onchain = useOnchain();
    const toasts = useToasts();

    const [editing, setEditing] = useState('');
    const [label, setLabel] = useState<TextDraft>(emptyText());
    const [writing, setWriting] = useState<ContentLang>('en');

    // The pre-registry row being renamed, or ''. It is held apart from `editing` because that
    // field is the registry's ID INPUT - a free-text number someone may be typing a new
    // category into - while this one names a row that already exists and whose id is fixed.
    const [legacy, setLegacy] = useState('');

    // Signed requests rather than transactions, so `onchain.busy` never sees them and they
    // need their own in-flight flag to make the buttons inert.
    const [saving, setSaving] = useState(false);

    // The pre-registry row whose delete is one more click away. Destructive and off-chain, so
    // it asks twice, the same way closing a market does.
    const [confirming, setConfirming] = useState('');

    const rows = categories.list.data() ?? [];
    const id = categoryIdOf(editing);
    const taken = id !== null && rows.some((row) => row.id === String(id));

    const open = (row: CategoryCount): void => {
        setLegacy(isRegistryId(row.id) ? '' : row.id);
        setEditing(isRegistryId(row.id) ? row.id : '');
        setLabel(textOf(row.label));
        setWriting('en');
        setConfirming('');
    };

    const reset = (): void => {
        setEditing('');
        setLegacy('');
        setLabel(emptyText());
        setWriting('en');
    };

    // English is the factory's own fallback as well as the reader's: a category without it
    // would read as blank in every language nobody has translated yet, so it is required here
    // rather than left for the contract to reject.
    const named = trimText(label).en !== '';

    const save = async (): Promise<void> => {
        if (!named) {
            return;
        }
        const names = trimText(label);

        // A pre-registry row: a signed request to the server's presentation table, never a
        // transaction. `retired` is carried through unchanged because this form does not own
        // it - there is no retire control for these rows - and sending the row's current value
        // is what stops a rename from quietly reopening a retired category.
        if (legacy !== '') {
            const row = rows.find((entry) => entry.id === legacy);
            setSaving(true);
            try {
                // sortOrder is 0 because the listing does not return it, so there is nothing
                // to carry through. Nothing in this app writes a non-zero order today; the day
                // something does, it has to come back from /categories before it can be kept.
                const ok = await admin.saveCategory({
                    id: legacy,
                    label: names,
                    sortOrder: 0,
                    retired: row?.retired ?? false
                });
                if (ok) {
                    toasts.push('success', t('admin.categorySaved'), 'check');
                    reset();
                }
            } finally {
                setSaving(false);
            }
            return;
        }

        if (id === null) {
            return;
        }
        const ok = taken ? await admin.setCategoryNames(id, names) : await admin.addCategory(id, names);
        if (ok) {
            toasts.push('success', t('admin.categorySaved'), 'check');
            reset();
        }
    };

    /** Forgets a pre-registry row's name. The id itself lives inside every market that carries
     *  it, so this cannot remove the category - only what it is called. */
    const remove = async (row: CategoryCount): Promise<void> => {
        setSaving(true);
        try {
            if (await admin.deleteCategory(row.id)) {
                toasts.push('success', t('admin.categoryDeleted'), 'check');
                if (legacy === row.id) {
                    reset();
                }
            }
        } finally {
            setSaving(false);
            setConfirming('');
        }
    };

    const setOpen = async (row: CategoryCount): Promise<void> => {
        const target = categoryIdOf(row.id);
        if (target !== null) {
            await admin.setCategoryOpen(target, row.retired);
        }
    };

    const name = (row: CategoryCount): string => {
        const chosen = text(row.label);
        return chosen === '' ? row.id : chosen;
    };

    const active = langRow(writing);

    return (
        <Card>
            <h2 className="text-lg font-bold tracking-tight">{t('admin.categoriesTitle')}</h2>
            <p className="mb-4 mt-1 text-[13px] leading-relaxed text-muted">{t('admin.categoriesHint')}</p>

            <div className="mb-5 flex flex-col gap-2.5 rounded-card border border-line bg-overlay/40 p-3.5">
                <LanguagePicker value={writing} onChange={setWriting} filled={(code) => label[code].trim() !== ''} />

                {/* No visible labels on these inputs (see `Input`), so each placeholder has to NAME
                     its field: an example id in the first one read as a value someone had typed. */}
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
                    <div className="w-full sm:w-32">
                        {/* A pre-registry id is not editable by anyone: it is a raw string
                             inside every market already filed under it. Shown, not typed. */}
                        {legacy === '' ? (
                            <Input
                                type="number"
                                label={t('admin.categoryId')}
                                placeholder={t('admin.categoryId')}
                                dir="ltr"
                                value={editing}
                                onInput={setEditing}
                            />
                        ) : (
                            <div className="flex h-10 items-center rounded-control border border-line bg-overlay/60 px-3">
                                <span className="nums truncate text-[13px] font-semibold text-muted">
                                    <bdi dir="ltr">{legacy}</bdi>
                                </span>
                            </div>
                        )}
                    </div>
                    <div className="flex-1">
                        <Input
                            label={`${t('admin.categoryLabel')} - ${active.endonym}`}
                            placeholder={`${t('admin.categoryLabel')} - ${active.endonym}`}
                            dir={active.dir}
                            value={label[writing]}
                            onInput={(next) => setLabel({ ...label, [writing]: next })}
                        />
                    </div>
                    <Button
                        variant="primary"
                        size="sm"
                        icon={legacy !== '' || taken ? 'check' : 'plus'}
                        disabled={
                            (legacy === '' && id === null) || !named || !hasText(label) || saving || onchain.pending()
                        }
                        loading={saving || (id !== null && onchain.busy(`category:${id}`))}
                        onClick={() => void save()}
                    >
                        {legacy !== '' || taken ? t('admin.categorySave') : t('admin.categoryNew')}
                    </Button>
                    {legacy !== '' && (
                        <Button variant="ghost" size="sm" disabled={saving} onClick={reset}>
                            {t('common.cancel')}
                        </Button>
                    )}
                </div>
                {legacy === '' && editing !== '' && id === null && (
                    <p className="text-[12px] font-semibold text-no">{t('admin.categoryIdInvalid')}</p>
                )}
                {legacy === '' && (editing === '' || id !== null) && (
                    <p className="text-[12px] text-faint">{t('admin.categoryIdHint')}</p>
                )}
                {legacy !== '' && <p className="text-[12px] text-faint">{t('admin.categoryLegacyHint')}</p>}
            </div>

            {categories.list.data() === undefined && <Skeleton className="h-40 rounded-control" />}

            {categories.list.data() !== undefined && rows.length === 0 && (
                <EmptyState icon="tag" title={t('admin.categoryEmpty')} hint={t('admin.categoryEmptyHint')} />
            )}

            <div className="flex flex-col divide-y divide-line">
                {rows.map((row) => (
                    <div key={row.id} className="flex flex-wrap items-center gap-3 py-2.5">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-overlay">
                            <Icon name="tag" size={16} className="text-faint" />
                        </span>
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-[14px] font-bold">{name(row)}</p>
                            <p className="nums truncate text-[12px] text-faint">
                                <bdi dir="ltr">{isRegistryId(row.id) ? `#${row.id}` : row.id}</bdi>
                            </p>
                        </div>

                        <span className="nums shrink-0 text-[12px] text-muted">
                            {row.count} {t('admin.categoryMarkets')}
                        </span>
                        {row.retired && (
                            <span className="shrink-0 rounded-full bg-overlay px-2 py-0.5 text-[11px] font-bold text-faint">
                                {t('admin.categoryRetired')}
                            </span>
                        )}

                        {isRegistryId(row.id) ? (
                            <>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    icon="edit"
                                    label={t('admin.editAction')}
                                    disabled={onchain.pending()}
                                    onClick={() => open(row)}
                                />
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={onchain.pending()}
                                    loading={onchain.busy(`category:${row.id}`)}
                                    onClick={() => void setOpen(row)}
                                >
                                    {row.retired ? t('admin.categoryRestore') : t('admin.categoryRetire')}
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    icon="edit"
                                    label={t('admin.editAction')}
                                    disabled={saving}
                                    onClick={() => open(row)}
                                />
                                {confirming === row.id ? (
                                    <Button
                                        variant="danger"
                                        size="sm"
                                        icon="alert"
                                        disabled={saving}
                                        loading={saving}
                                        onClick={() => void remove(row)}
                                    >
                                        {t('admin.categoryDeleteConfirm')}
                                    </Button>
                                ) : (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        icon="trash"
                                        disabled={saving}
                                        onClick={() => setConfirming(row.id)}
                                    >
                                        {t('admin.categoryDelete')}
                                    </Button>
                                )}
                            </>
                        )}
                        {/* Says what the delete costs at the moment it is being confirmed, not
                             as a permanent warning nobody reads. */}
                        {confirming === row.id && row.count > 0 && (
                            <p className="w-full text-[12px] font-semibold text-no">{t('admin.categoryDeleteInUse')}</p>
                        )}
                    </div>
                ))}
            </div>
        </Card>
    );
}
