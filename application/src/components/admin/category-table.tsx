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
// Every action here is a transaction: the ids, the names and whether a category still accepts
// markets all live in the factory. Nothing is deleted, because the chain has no such thing -
// a category is retired instead, which leaves the markets already filed under it alone.
//
// Rows whose id is not a number are markets from before the registry existed. They are shown
// because they still label real markets, and they have no actions because there is nothing on
// chain to act on.
export default function CategoryTable() {
    const { t, text } = useLocale();
    const admin = useAdmin();
    const categories = useCategories();
    const onchain = useOnchain();
    const toasts = useToasts();

    const [editing, setEditing] = useState('');
    const [label, setLabel] = useState<TextDraft>(emptyText());
    const [writing, setWriting] = useState<ContentLang>('en');

    const rows = categories.list.data() ?? [];
    const id = categoryIdOf(editing);
    const taken = id !== null && rows.some((row) => row.id === String(id));

    const open = (row: CategoryCount): void => {
        setEditing(row.id);
        setLabel(textOf(row.label));
        setWriting('en');
    };

    const reset = (): void => {
        setEditing('');
        setLabel(emptyText());
        setWriting('en');
    };

    // English is the factory's own fallback as well as the reader's: a category without it
    // would read as blank in every language nobody has translated yet, so it is required here
    // rather than left for the contract to reject.
    const named = trimText(label).en !== '';

    const save = async (): Promise<void> => {
        if (id === null || !named) {
            return;
        }
        const names = trimText(label);
        const ok = taken ? await admin.setCategoryNames(id, names) : await admin.addCategory(id, names);
        if (ok) {
            toasts.push('success', t('admin.categorySaved'), 'check');
            reset();
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
                        <Input
                            type="number"
                            label={t('admin.categoryId')}
                            placeholder={t('admin.categoryId')}
                            dir="ltr"
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
                    <Button
                        variant="primary"
                        size="sm"
                        icon={taken ? 'check' : 'plus'}
                        disabled={id === null || !named || !hasText(label) || onchain.pending()}
                        loading={id !== null && onchain.busy(`category:${id}`)}
                        onClick={() => void save()}
                    >
                        {taken ? t('admin.categorySave') : t('admin.categoryNew')}
                    </Button>
                </div>
                {editing !== '' && id === null && (
                    <p className="text-[12px] font-semibold text-no">{t('admin.categoryIdInvalid')}</p>
                )}
                {(editing === '' || id !== null) && (
                    <p className="text-[12px] text-faint">{t('admin.categoryIdHint')}</p>
                )}
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

                        {isRegistryId(row.id) && (
                            <>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    icon="edit"
                                    label={t('admin.categorySave')}
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
                        )}
                    </div>
                ))}
            </div>
        </Card>
    );
}
