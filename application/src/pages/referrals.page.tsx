import { PERIODS, REFERRAL_DIRECT_RATE, REFERRAL_INDIRECT_RATE, type Period } from '../api.ts';

import { shortAddress } from '../lib/wallet.ts';

import { useLocale } from '../stores/locale.store.ts';
import { useChrome } from '../stores/chrome.store.ts';
import { useSession } from '../stores/session.store.ts';
import { useReferrals } from '../stores/referrals.store.ts';

import { formatMoney, formatCount, formatRate } from '../i18n/format.ts';

import Icon from '../icons/icon.tsx';

import Card from '../components/ui/card.tsx';
import Badge from '../components/ui/badge.tsx';
import Button from '../components/ui/button.tsx';
import StatTile from '../components/ui/stat-tile.tsx';
import Skeleton from '../components/ui/skeleton.tsx';
import EmptyState from '../components/ui/empty-state.tsx';
import PillGroup from '../components/ui/pill-group.tsx';

import CampaignList from '../components/referral/campaign-list.tsx';
import ReferredTable from '../components/referral/referred-table.tsx';

// The referral program: what a wallet has earned by bringing other people to the market, and
// the links it earns through.
//
// Every number here is derived from the same indexed trades the rest of the app reads, so
// nothing on this page is a projection or a promise - it is the share of protocol fees that
// have already been paid. What the page does NOT do is move money: payouts are settled from
// the treasury, which is a signed on-chain act and not a button on a dashboard, and the page
// says so rather than implying a balance that can be spent here.
export default function Referrals() {
    const { t, lang } = useLocale();
    const chrome = useChrome();
    const session = useSession();
    const referrals = useReferrals();

    const dashboard = referrals.dashboard.data();
    const loading = referrals.dashboard.loading();
    const invite = referrals.invite.data();

    const periodTabs = PERIODS.map((entry) => ({
        id: entry,
        label: t(`leaderboard.${entry}` as 'leaderboard.day')
    }));

    // The invitation someone arrived with, shown before a wallet is even connected: the point
    // of a referral link is to say who sent you while you are still deciding.
    // A wallet cannot refer itself, so its own link is not an invitation to it - offering the
    // button here would offer one that always fails.
    const ownInvite = invite !== undefined && invite.owner === session.address().toLowerCase();

    const inviteCard = invite !== undefined && !ownInvite && (
        <Card tone="brand" animate="rise" className="mb-5">
            <div className="flex flex-wrap items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-surface text-brand">
                    <Icon name="send" size={20} />
                </span>
                <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-bold">{t('referral.invited')}</p>
                    <p className="truncate text-[13px] text-muted">
                        {invite.name} · <span dir="ltr">{shortAddress(invite.owner)}</span>
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => referrals.dismissInvite()}>
                        {t('referral.decline')}
                    </Button>
                    {session.connected() ? (
                        <Button size="sm" loading={referrals.working()} onClick={() => void referrals.join()}>
                            {t('referral.accept')}
                        </Button>
                    ) : (
                        <Button size="sm" onClick={() => chrome.openAuth()}>
                            {t('auth.title')}
                        </Button>
                    )}
                </div>
            </div>
        </Card>
    );

    const header = (
        <>
            <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold tracking-tight motion-safe:animate-rise">
                <Icon name="share" size={22} className="text-brand" />
                {t('referral.title')}
            </h1>
            <p className="mb-3 max-w-2xl text-[14px] text-muted motion-safe:animate-rise">{t('referral.subtitle')}</p>
            <div className="mb-5 flex flex-wrap items-center gap-2 motion-safe:animate-rise">
                <Badge tone="brand" icon="user">
                    {formatRate(REFERRAL_DIRECT_RATE, lang())} · {t('referral.direct')}
                </Badge>
                <Badge tone="gold" icon="holders">
                    {formatRate(REFERRAL_INDIRECT_RATE, lang())} · {t('referral.indirect')}
                </Badge>
            </div>
        </>
    );

    if (!session.connected()) {
        return (
            <section className="shell py-5">
                <div className="mx-auto max-w-5xl">
                    {header}
                    {inviteCard}
                    <EmptyState
                        icon="wallet"
                        tone="brand"
                        size="lg"
                        heading
                        title={t('referral.connectTitle')}
                        hint={t('referral.connectHint')}
                    >
                        <Button onClick={() => chrome.openAuth()}>{t('auth.title')}</Button>
                    </EmptyState>
                </div>
            </section>
        );
    }

    const stats = dashboard?.window;
    const period = referrals.period();

    return (
        <section className="shell py-5">
            <div className="mx-auto max-w-5xl">
                {header}
                {inviteCard}

                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[13px] text-muted">
                        {t('referral.lifetime')}{' '}
                        <span className="nums font-bold text-brand">
                            {formatMoney(dashboard?.total.earnings ?? 0, lang())}
                        </span>
                    </p>
                    <PillGroup
                        items={periodTabs}
                        active={period}
                        onChange={(next) => referrals.setPeriod(next as Period)}
                    />
                </div>

                {loading && dashboard === undefined && <Skeleton className="mb-5 h-24 rounded-card" />}

                {stats !== undefined && (
                    <div className="mb-5 grid grid-cols-2 gap-2 motion-safe:animate-rise sm:grid-cols-4 sm:gap-3">
                        <StatTile
                            label={t('referral.earnings')}
                            value={formatMoney(stats.earnings, lang(), { compact: true })}
                            tone="yes"
                        />
                        <StatTile label={t('referral.signups')} value={formatCount(stats.signups, lang())} />
                        <StatTile
                            label={t('referral.activeTraders')}
                            value={formatCount(stats.activeTraders, lang())}
                        />
                        <StatTile
                            label={t('referral.volume')}
                            value={formatMoney(stats.volume, lang(), { compact: true })}
                        />
                    </div>
                )}

                {dashboard?.referrer != null && (
                    <p className="mb-5 text-[13px] text-muted">
                        {t('referral.yourReferrer')}{' '}
                        <span className="nums latin-nums font-semibold text-text" dir="ltr">
                            {shortAddress(dashboard.referrer.address)}
                        </span>
                    </p>
                )}

                <div className="mb-5">
                    <CampaignList campaigns={dashboard?.campaigns ?? []} loading={loading} />
                </div>

                <div className="mb-5">
                    <ReferredTable rows={dashboard?.referred ?? []} loading={loading} />
                </div>

                {/* Said plainly rather than buried: a dashboard that shows an earned figure and
                     no way to move it has to explain itself, or it reads as a broken wallet. */}
                <p className="text-[12px] leading-relaxed text-faint">{t('referral.payoutHint')}</p>
            </div>
        </section>
    );
}
