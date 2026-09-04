import { useState } from 'react';

import type { CategoryCount } from '../../api.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { useAdmin } from '../../stores/admin.store.ts';
import { useCategories } from '../../stores/categories.store.ts';
import { useToasts } from '../../stores/toasts.store.ts';

import ImageField from './image-field.tsx';

import Button from '../ui/button.tsx';
import Card from '../ui/card.tsx';
import Icon from '../../icons/icon.tsx';
import Input from '../ui/input.tsx';
import EmptyState from '../ui/empty-state.tsx';
import Skeleton from '../ui/skeleton.tsx';

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Categories are the one part of a market that is legitimately off-chain. The ID rides
// on-chain inside every market that carries it, so it is permanent; the label, image and
// order are ours to edit. Registering one here also lets a category exist BEFORE its first
// market, which the derived GROUP BY it replaced could never do.
export default function CategoryTable() {
    const { t, lang } = useLocale();
    const admin = useAdmin();
    const categories = useCategories();
    const toasts = useToasts();

    const [editing, setEditing] = useState('');
    const [labelEn, setLabelEn] = useState('');
    const [labelFa, setLabelFa] = useState('');
    const [image, setImage] = useState('');
    const [sortOrder, setSortOrder] = useState('0');
    const [saving, setSaving] = useState('');

    const rows = categories.list.data() ?? [];
    const taken = rows.some((row) => row.id === editing.trim().toLowerCase());
    const idValid = ID_PATTERN.test(editing.trim().toLowerCase());
    const isNew = editing !== '' && !taken;

    const open = (row: CategoryCount): void => {
        setEditing(row.id);
        setLabelEn(row.labelEn);
        setLabelFa(row.labelFa);
        setImage(row.image);
        setSortOrder('0');
    };

    const reset = (): void => {
        setEditing('');
        setLabelEn('');
        setLabelFa('');
        setImage('');
        setSortOrder('0');
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
            labelEn: row === null ? labelEn.trim() : row.labelEn,
            labelFa: row === null ? labelFa.trim() : row.labelFa,
            image: row === null ? image.trim() : row.image,
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

    const label = (row: CategoryCount): string => {
        const chosen = lang() === 'fa' ? row.labelFa : row.labelEn;
        return chosen === '' ? row.id : chosen;
    };

    return (
        <Card>
            <h2 className="text-lg font-bold tracking-tight">{t('admin.categoriesTitle')}</h2>
            <p className="mb-4 mt-1 text-[13px] leading-relaxed text-muted">{t('admin.categoriesHint')}</p>

            <div className="mb-5 flex flex-col gap-2.5 rounded-card border border-line bg-overlay/40 p-3.5">
                <div className="flex flex-col gap-2.5 sm:flex-row">
                    <div className="flex-1">
                        <Input
                            label={t('admin.categoryId')}
                            placeholder="iran-football"
                            value={editing}
                            onInput={setEditing}
                        />
                    </div>
                    <div className="flex-1">
                        <Input
                            label={t('admin.categoryLabelEn')}
                            placeholder="Iran football"
                            value={labelEn}
                            onInput={setLabelEn}
                        />
                    </div>
                    <div className="flex-1">
                        <Input
                            label={t('admin.categoryLabelFa')}
                            placeholder="فوتبال ایران"
                            value={labelFa}
                            onInput={setLabelFa}
                        />
                    </div>
                </div>
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
                    <div className="flex-1">
                        <ImageField label={t('admin.categoryImage')} value={image} onChange={setImage} />
                    </div>
                    <div className="w-full sm:w-24">
                        <Input
                            type="number"
                            label={t('admin.categorySort')}
                            placeholder="0"
                            value={sortOrder}
                            onInput={setSortOrder}
                        />
                    </div>
                    <Button
                        variant="primary"
                        size="sm"
                        icon={isNew ? 'plus' : 'check'}
                        disabled={editing === '' || !idValid}
                        loading={saving !== '' && saving === editing.trim().toLowerCase()}
                        onClick={() => void save(null)}
                    >
                        {isNew ? t('admin.categoryNew') : t('admin.categorySave')}
                    </Button>
                </div>
                {editing !== '' && !idValid && (
                    <p className="text-[12px] font-semibold text-no">{t('admin.categoryIdInvalid')}</p>
                )}
                {idValid && taken && <p className="text-[12px] text-faint">{t('admin.categoryIdHint')}</p>}
            </div>

            {categories.list.data() === undefined && <Skeleton className="h-40 rounded-control" />}

            {categories.list.data() !== undefined && rows.length === 0 && (
                <EmptyState icon="tag" title={t('admin.categoryEmpty')} hint={t('admin.categoryEmptyHint')} />
            )}

            <div className="flex flex-col divide-y divide-line">
                {rows.map((row) => (
                    <div key={row.id} className="flex items-center gap-3 py-2.5">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-control bg-overlay">
                            {row.image !== '' ? (
                                <img className="h-full w-full object-cover" src={row.image} alt="" loading="lazy" />
                            ) : (
                                <Icon name="tag" size={16} className="text-faint" />
                            )}
                        </span>
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-[14px] font-bold">{label(row)}</p>
                            <p className="nums truncate text-[12px] text-faint" dir="ltr">
                                {row.id}
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
                        <Button
                            variant="ghost"
                            size="sm"
                            icon="edit"
                            label={t('admin.categorySave')}
                            onClick={() => open(row)}
                        />
                        <Button variant="ghost" size="sm" loading={saving === row.id} onClick={() => void save(row)}>
                            {row.retired ? t('admin.categoryRestore') : t('admin.categoryRetire')}
                        </Button>
                    </div>
                ))}
            </div>
        </Card>
    );
}
