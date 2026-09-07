import { useLocale, type MessageKey } from '../stores/locale.store.ts';

import Icon from '../icons/icon.tsx';
import type { IconName } from '../icons/registry.ts';

import Card from '../components/ui/card.tsx';

// The whole product explained on ONE page, in every language the app speaks. It is deliberately
// short: someone reads this while a market is open in another tab, so each section is a heading
// and a few lines, and anything longer belongs in docs/user-guide.md instead.
//
// Nothing here is fetched. The page renders with no wallet, no chain and no server, which is the
// point - it is the page you send someone BEFORE they have any of those.
const SECTIONS: Array<{ icon: IconName; title: MessageKey; body: MessageKey }> = [
    { icon: 'wallet', title: 'docs.startTitle', body: 'docs.startBody' },
    { icon: 'rules', title: 'docs.marketTitle', body: 'docs.marketBody' },
    { icon: 'gavel', title: 'docs.tradeTitle', body: 'docs.tradeBody' },
    { icon: 'deposit', title: 'docs.feesTitle', body: 'docs.feesBody' },
    { icon: 'trophy', title: 'docs.claimTitle', body: 'docs.claimBody' },
    { icon: 'chart', title: 'docs.portfolioTitle', body: 'docs.portfolioBody' },
    { icon: 'share', title: 'docs.referralTitle', body: 'docs.referralBody' },
    { icon: 'language', title: 'docs.languageTitle', body: 'docs.languageBody' }
];

const FAQ: Array<{ q: MessageKey; a: MessageKey }> = [
    { q: 'docs.faqAccountQ', a: 'docs.faqAccountA' },
    { q: 'docs.faqNetworkQ', a: 'docs.faqNetworkA' },
    { q: 'docs.faqSellQ', a: 'docs.faqSellA' },
    { q: 'docs.faqResolveQ', a: 'docs.faqResolveA' },
    { q: 'docs.faqVoidQ', a: 'docs.faqVoidA' },
    { q: 'docs.faqPayoutQ', a: 'docs.faqPayoutA' }
];

export default function Docs() {
    const { t } = useLocale();

    return (
        <section className="shell py-5">
            <div className="mx-auto max-w-4xl">
                <h1 className="text-2xl font-bold tracking-tight motion-safe:animate-rise">{t('docs.title')}</h1>
                <p className="mt-1 text-[15px] text-muted">{t('docs.subtitle')}</p>

                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {SECTIONS.map((entry) => (
                        <Card key={entry.title}>
                            <div className="flex gap-3">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-overlay">
                                    <Icon name={entry.icon} size={16} className="text-brand" />
                                </span>
                                <div className="min-w-0">
                                    <h2 className="text-[15px] font-bold tracking-tight">{t(entry.title)}</h2>
                                    <p className="mt-1 text-[13px] leading-relaxed text-muted">{t(entry.body)}</p>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>

                <Card className="mt-3">
                    <h2 className="text-[15px] font-bold tracking-tight">{t('docs.faqTitle')}</h2>
                    <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3.5 sm:grid-cols-2">
                        {FAQ.map((entry) => (
                            <div key={entry.q}>
                                <dt className="text-[13px] font-semibold">{t(entry.q)}</dt>
                                <dd className="mt-0.5 text-[13px] leading-relaxed text-muted">{t(entry.a)}</dd>
                            </div>
                        ))}
                    </dl>
                </Card>

                <p className="mt-4 text-[12px] leading-relaxed text-faint">{t('footer.disclaimer')}</p>
            </div>
        </section>
    );
}
