import { useState } from 'react';

import type { CategoryCount, ContentLang } from '../../api.ts';

import { langRow } from '../../i18n/langs.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { useAdmin } from '../../stores/admin.store.ts';
import { useCategories } from '../../stores/categories.store.ts';
import { useToasts } from '../../stores/toasts.store.ts';
import { emptyText, hasText, textOf, trimText, type TextDraft } from '../../stores/create-draft.store.ts';

import LanguagePicker from './language-picker.tsx';

import Button from '../ui/button.tsx';
import Card from '../ui/card.tsx';
import Icon from '../../icons/icon.tsx';
import Input from '../ui/input.tsx';
import EmptyState from '../ui/empty-state.tsx';
import Skeleton from '../ui/skeleton.tsx';

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Categories are the one part of a market that is legitimately off-chain. The ID rides
// on-chain inside every market that carries it, so it is permanent; the name and the order
// are ours to edit. Registering one here also lets a category exist BEFORE its first market,
// which the derived GROUP BY it replaced could never do.
//
// The name is ONE field driven by the shared language picker, the same way a market's text
// is - a category called "ورزش" for a Persian reader and nothing at all for a Turkish one was
// the old two-field shape's ceiling.
export default function CategoryTable() {
    const { t, text } = useLocale();
    const admin = useAdmin();
    const categories = useCategories();
    const toasts = useToasts();

    const [editing, setEditing] = useState('');
    const [label, setLabel] = useState<TextDraft>(emptyText());
    const [writing, setWriting] = useState<ContentLang>('en');
    const [sortOrder, setSortOrder] = useState('');
    const [saving, setSaving] = useState('');

    // Deleting is one click away from permanent, so the row asks first. Kept as row state
    // rather than a dialog: the confirmation belongs next to the name it is about.
    const [confirming, setConfirming] = useState('');
    const [deleting, setDeleting] = useState('');

    const rows = categories.list.data() ?? [];
    const taken = rows.some((row) => row.id === editing.trim().toLowerCase());
    const idValid = ID_PATTERN.test(editing.trim().toLowerCase());
    const isNew = editing !== '' && !taken;

    const open = (row: CategoryCount): void => {
        setEditing(row.id);
        setLabel(textOf(row.label));
        setWriting('en');
        setSortOrder('');
    };

    const reset = (): void => {
        setEditing('');
        setLabel(emptyText());
        setWriting('en');
        setSortOrder('');
    };

    const save = async (row: CategoryCount | null): Promise<void> => {
        const id = (row?.id ?? editing).trim().toLowerCase();
        if (id === '' || !ID_PATTERN.test(id)) {
            toasts.push('error', t('admin.categoryIdInvalid'), 'alert');
            return;
        }
        setSaving(id);
        const ok = await admin.saveCategory({
            id,
            label: row === null ? trimText(label) : row.label,
            sortOrder: row === null ? Number(sortOrder) || 0 : 0,
            retired: row === null ? false : !row.retired
        });
        setSaving('');
        if (ok) {
            toasts.push('success', t('admin.categorySaved'), 'check');
            if (row === null) {
                reset();
            }
        }
    };

    const remove = async (row: CategoryCount): Promise<void> => {
        setDeleting(row.id);
        const ok = await admin.deleteCategory(row.id);
        setDeleting('');
        setConfirming('');
        if (ok) {
            toasts.push('success', t('admin.categoryDeleted'), 'check');
            if (editing === row.id) {
                reset();
            }
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
                    <div className="flex-1">
                        <Input
                            label={t('admin.categoryId')}
                            placeholder={t('admin.categoryId')}
                            value={editing}
                            onInput={setEditing}
                        />
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
                    <div className="w-full sm:w-24">
                        <Input
                            type="number"
                            label={t('admin.categorySort')}
                            placeholder={t('admin.categorySort')}
                            value={sortOrder}
                            onInput={setSortOrder}
                        />
                    </div>
                    <Button
                        variant="primary"
                        size="sm"
                        icon={isNew ? 'plus' : 'check'}
                        disabled={editing === '' || !idValid || !hasText(label)}
                        loading={saving !== '' && saving === editing.trim().toLowerCase()}
                        onClick={() => void save(null)}
                    >
                        {isNew ? t('admin.categoryNew') : t('admin.categorySave')}
                    </Button>
                </div>
                {editing !== '' && !idValid && (
                    <p className="text-[12px] font-semibold text-no">{t('admin.categoryIdInvalid')}</p>
                )}
                {(editing === '' || idValid) && <p className="text-[12px] text-faint">{t('admin.categoryIdHint')}</p>}
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
                                <bdi dir="ltr">{row.id}</bdi>
                            </p>
                        </div>

                        {confirming === row.id ? (
                            // The count is the whole warning: removing a row that labels live
                            // markets leaves them showing the raw id, which is recoverable but
                            // visible to everyone until the id is registered again.
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[12px] font-semibold text-no">
                                    {row.count > 0 ? t('admin.categoryDeleteInUse') : t('admin.categoryDeleteConfirm')}
                                </span>
                                <Button variant="ghost" size="sm" onClick={() => setConfirming('')}>
                                    {t('common.cancel')}
                                </Button>
                                <Button
                                    variant="danger"
                                    size="sm"
                                    icon="trash"
                                    loading={deleting === row.id}
                                    onClick={() => void remove(row)}
                                >
                                    {t('admin.categoryDelete')}
                                </Button>
                            </div>
                        ) : (
                            <>
                                <span className="nums shrink-0 text-[12px] text-muted">
                                    {row.count} {t('admin.categoryMarkets')}
                                </span>
                                {row.retired && (
                                    <span className="shrink-0 rounded-full bg-overlay px-2 py-0.5 text-[11px] font-bold text-faint">
                                        {t('admin.categoryRetired')}
                                    </span>
                                )}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    icon="edit"
                                    label={t('admin.categorySave')}
                                    onClick={() => open(row)}
                                />
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    loading={saving === row.id}
                                    onClick={() => void save(row)}
                                >
                                    {row.retired ? t('admin.categoryRestore') : t('admin.categoryRetire')}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    icon="trash"
                                    label={t('admin.categoryDelete')}
                                    onClick={() => setConfirming(row.id)}
                                />
                            </>
                        )}
                    </div>
                ))}
            </div>
        </Card>
    );
}
