import { useEffect, useState } from 'react';

import type { IconName } from '../icons/registry.ts';

import { useLocale } from '../stores/locale.store.ts';
import { useChrome } from '../stores/chrome.store.ts';
import { useSession } from '../stores/session.store.ts';
import { useAdmin } from '../stores/admin.store.ts';
import { useConfig } from '../stores/config.store.ts';

import Icon from '../icons/icon.tsx';

import Button from '../components/ui/button.tsx';
import EmptyState from '../components/ui/empty-state.tsx';
import Skeleton from '../components/ui/skeleton.tsx';

import AdminStats from '../components/admin/admin-stats.tsx';
import MarketTable from '../components/admin/market-table.tsx';
import CategoryTable from '../components/admin/category-table.tsx';
import DiscoverTable from '../components/admin/discover-table.tsx';
import CreateMarketForm from '../components/admin/create-market-form.tsx';
import TreasuryCard from '../components/admin/treasury-card.tsx';
import ConfigCard from '../components/admin/config-card.tsx';
import ActivityFeed from '../components/admin/activity-feed.tsx';

// The operator console. Lists and stats come from the indexer (server-side search/filter/
// pagination - instant at a 100k-market registry); the role gate and every write go
// straight to the chain through the connected wallet. Gated on the factory's ADMIN_ROLE.
export default function Admin() {
    const { t } = useLocale();
    const chrome = useChrome();
    const session = useSession();
    const admin = useAdmin();
    const config = useConfig();

    // The chain moves while this page is away; every visit re-pulls the read model. It runs
    // on MOUNT, not in the render body - a refresh during render bumps the store, which
    // re-renders, which refreshes again.
    useEffect(() => {
        admin.refresh();
        // oxlint-disable-next-line react/exhaustive-deps
    }, []);

    const [section, setSection] = useState('markets');

    const sections = [
        { id: 'markets', label: t('admin.sectionMarkets'), icon: 'chart' as IconName },
        { id: 'categories', label: t('admin.sectionCategories'), icon: 'tag' as IconName },
        { id: 'create', label: t('admin.sectionCreate'), icon: 'plus' as IconName },
        { id: 'treasury', label: t('admin.sectionTreasury'), icon: 'wallet' as IconName },
        { id: 'factory', label: t('admin.sectionFactory'), icon: 'settings' as IconName },
        { id: 'discover', label: t('admin.discover'), icon: 'compass' as IconName },
        { id: 'activity', label: t('admin.sectionActivity'), icon: 'activity' as IconName }
    ];

    if (!session.connected()) {
        return (
            <section className="shell py-5">
                <EmptyState
                    icon="wallet"
                    tone="brand"
                    size="lg"
                    heading
                    title={t('profile.connectTitle')}
                    hint={t('admin.deniedHint')}
                >
                    <Button onClick={() => chrome.openAuth()}>{t('auth.title')}</Button>
                </EmptyState>
            </section>
        );
    }

    if (config.error() !== null) {
        return (
            <section className="shell py-5">
                <EmptyState
                    icon="globe"
                    size="lg"
                    heading
                    title={t('admin.noDeployment')}
                    hint={t('admin.noDeploymentHint')}
                />
            </section>
        );
    }

    if (admin.checking() || (config.loading() && config.data() === undefined)) {
        return (
            <section className="shell py-5">
                <Skeleton className="h-64 rounded-card" />
            </section>
        );
    }

    if (!admin.isAdmin()) {
        return (
            <section className="shell py-5">
                <EmptyState
                    icon="alert"
                    tone="danger"
                    size="lg"
                    heading
                    title={t('admin.denied')}
                    hint={t('admin.deniedHint')}
                />
            </section>
        );
    }

    return (
        <section className="shell py-5">
            <header className="mb-5 flex flex-wrap items-center gap-3 motion-safe:animate-rise">
                <div className="min-w-0 flex-1">
                    <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t('admin.title')}</h1>
                    <p className="text-[13px] text-muted">{t('admin.subtitle')}</p>
                </div>
                {section !== 'create' && (
                    <Button variant="primary" size="sm" icon="plus" onClick={() => setSection('create')}>
                        {t('admin.create')}
                    </Button>
                )}
            </header>

            <div className="mb-6">
                <AdminStats />
            </div>

            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
                <nav
                    className="rail rail-bleed rail-fade min-w-0 gap-2 lg:sticky lg:top-20 lg:flex-col lg:gap-1"
                    aria-label={t('admin.title')}
                >
                    {sections.map((entry) => (
                        <button
                            key={entry.id}
                            className={
                                section === entry.id
                                    ? 'flex h-11 shrink-0 cursor-pointer items-center gap-2.5 rounded-control bg-overlay px-3.5 text-[14px] font-bold text-text lg:w-full'
                                    : 'flex h-11 shrink-0 cursor-pointer items-center gap-2.5 rounded-control px-3.5 text-[14px] font-semibold text-muted transition-colors duration-200 hover:text-text lg:w-full'
                            }
                            type="button"
                            onClick={() => setSection(entry.id)}
                        >
                            <Icon name={entry.icon} size={17} />
                            <span>{entry.label}</span>
                        </button>
                    ))}
                </nav>

                <div className="min-w-0 motion-safe:animate-fade">
                    {section === 'markets' && <MarketTable />}
                    {section === 'categories' && <CategoryTable />}
                    {section === 'create' && <CreateMarketForm />}
                    {section === 'treasury' && (
                        <div className="mx-auto max-w-xl">
                            <TreasuryCard />
                        </div>
                    )}
                    {section === 'factory' && (
                        <div className="mx-auto max-w-xl">
                            <ConfigCard />
                        </div>
                    )}
                    {section === 'discover' && <DiscoverTable onImport={() => setSection('create')} />}
                    {section === 'activity' && <ActivityFeed />}
                </div>
            </div>
        </section>
    );
}
