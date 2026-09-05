import { useState } from 'react';

import type { ReferralCampaign } from '../../api.ts';

import { copyText } from '../../lib/clipboard.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { useToasts } from '../../stores/toasts.store.ts';
import { useReferrals, referralLink } from '../../stores/referrals.store.ts';

import { formatMoney, formatCount, formatDate } from '../../i18n/format.ts';

import Icon from '../../icons/icon.tsx';

import Card from '../ui/card.tsx';
import Input from '../ui/input.tsx';
import Button from '../ui/button.tsx';
import EmptyState from '../ui/empty-state.tsx';

// A referrer's links. The row's subject is the LINK, not the code: a code is what the server
// stores, but the thing anybody actually does with a campaign is copy its URL and paste it
// somewhere, so that is the control the row is built around.
export default function CampaignList(props: { campaigns: ReferralCampaign[]; loading: boolean }) {
    const { t, lang } = useLocale();
    const toasts = useToasts();
    const referrals = useReferrals();

    const [name, setName] = useState('');

    const submit = async (): Promise<void> => {
        const code = await referrals.createCampaign(name);
        if (code !== null) {
            setName('');
        }
    };

    const copy = async (code: string): Promise<void> => {
        if (await copyText(referralLink(code))) {
            toasts.push('info', t('referral.copied'), 'copy');
            return;
        }
        toasts.push('error', t('toast.copyFailed'), 'alert');
    };

    return (
        <Card animate="rise">
            <h2 className="text-lg font-bold tracking-tight">{t('referral.campaigns')}</h2>
            <p className="mb-4 text-[13px] text-muted">{t('referral.campaignsHint')}</p>

            <div className="mb-4 flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                    <Input
                        value={name}
                        label={t('referral.campaignName')}
                        placeholder={t('referral.campaignName')}
                        icon="tag"
                        onInput={setName}
                        onEnter={() => void submit()}
                    />
                </div>
                <Button
                    icon="plus"
                    loading={referrals.working()}
                    disabled={name.trim() === ''}
                    onClick={() => void submit()}
                >
                    {t('referral.create')}
                </Button>
            </div>

            {props.campaigns.length === 0 && !props.loading && (
                <EmptyState icon="tag" title={t('referral.noCampaigns')} hint={t('referral.noCampaignsHint')} />
            )}

            {props.campaigns.length > 0 && (
                <ul className="flex flex-col">
                    {props.campaigns.map((campaign) => (
                        <li
                            key={campaign.code}
                            className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line py-3 last:border-b-0"
                        >
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-[14px] font-semibold">{campaign.name}</p>
                                {/* The code is a Latin token in an interface that may be RTL. */}
                                <p className="nums latin-nums truncate text-[12px] text-faint" dir="ltr">
                                    {referralLink(campaign.code)}
                                </p>
                            </div>

                            <div className="flex items-center gap-4 text-end">
                                <div>
                                    <p className="text-[11px] text-muted">{t('referral.signups')}</p>
                                    <p className="nums text-[14px] font-bold">
                                        {formatCount(campaign.signups, lang())}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-[11px] text-muted">{t('referral.earned')}</p>
                                    <p className="nums text-[14px] font-bold text-brand">
                                        {formatMoney(campaign.earnings, lang(), { compact: true })}
                                    </p>
                                </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-1">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    icon="copy"
                                    label={t('referral.copy')}
                                    onClick={() => void copy(campaign.code)}
                                />
                            </div>

                            <p className="w-full text-[11px] text-faint">
                                <Icon name="calendar" size={11} className="me-1 inline align-[-1px]" />
                                {formatDate(campaign.createdAt, lang())}
                            </p>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}
