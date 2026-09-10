import { useLocale } from '../../stores/locale.store.ts';
import { useChrome } from '../../stores/chrome.store.ts';
import {
    useSession,
    WalletUnavailableError,
    WalletNoAccountError,
    type DiscoveredWallet
} from '../../stores/session.store.ts';
import { useToasts } from '../../stores/toasts.store.ts';

import { WALLET_LABEL, WALLET_OFFERS } from '../../icons/brands.ts';
import BrandIcon from '../../icons/brand-icon.tsx';
import Icon from '../../icons/icon.tsx';

import Sheet from '../ui/sheet.tsx';

// Wallet-ONLY auth: the wallet IS the account system on a web3 market. Still ONE surface,
// ever - the anti-pattern this replaces is a QR overlay stacked on a dialog stacked on a
// modal.
//
// What the BROWSER announced over EIP-6963 comes first, always: that is what admits an
// installed Frame, Zerion or OKX the site has never heard of, which is the whole point of
// 6963. The named wallets that did NOT announce follow, as install LINKS - a visitor who
// has MetaMask should still be able to find Trust, Binance or the chain's own wallet, and
// a link is the honest control for one that is not installed, where a connect button could
// only ever fail. A declined request still answers with a toast.
export default function AuthSheet() {
    const { t } = useLocale();
    const chrome = useChrome();
    const session = useSession();
    const toasts = useToasts();

    const announced = new Set(session.wallets().map((entry) => entry.rdns));
    const missing = WALLET_OFFERS.filter((offer) => !announced.has(offer.rdns));

    const pick = async (entry: DiscoveredWallet): Promise<void> => {
        if (session.connecting() !== null) {
            return;
        }
        try {
            await session.connect(entry.rdns);
            chrome.close();
            toasts.push('success', t('toast.connected'), 'wallet');
        } catch (error) {
            if (error instanceof WalletUnavailableError) {
                toasts.push('error', `${entry.name} ${t('auth.notDetected')}`, 'alert');
                return;
            }
            // The wallet replied, with nothing in it. The sheet STAYS open on this one, because
            // unlocking the extension and pressing the same button again is the whole fix.
            if (error instanceof WalletNoAccountError) {
                toasts.push('error', t('auth.noAccount'), 'alert');
                return;
            }
            const code = (error as { code?: number }).code;
            // Only 4001 is a DECLINE (EIP-1193). Reporting every other failure - a locked
            // wallet, a dead RPC, an internal provider error - as "you declined" hides a real
            // problem behind a choice the visitor never made.
            if (code === 4001) {
                toasts.push('info', t('auth.rejected'), 'info');
                return;
            }
            // -32002: the wallet already has THIS prompt open, usually behind the browser
            // window. Generic failure copy sends the visitor to reload the page, which drops
            // the very prompt they need to answer.
            if (code === -32002) {
                toasts.push('info', t('auth.pending'), 'info');
                return;
            }
            // 4100 UNAUTHORIZED is what a LOCKED wallet answers, and it answers INSTANTLY -
            // no approval window ever opens. Nura Wallet rejects `eth_requestAccounts` this
            // way whenever its vault is locked, so without this branch the one wallet this
            // chain ships looked simply broken: press connect, no prompt, a generic error.
            // The visitor has to be told the wallet is locked, because unlocking it is the
            // entire fix and nothing on screen hinted at it.
            if (code === 4100) {
                toasts.push('error', t('auth.locked'), 'alert');
                return;
            }
            // 4900/4901: the provider is there but has no chain behind it - an unreachable RPC,
            // or a bridge that never came up. Reloading does not help; opening the wallet does.
            if (code === 4900 || code === 4901) {
                toasts.push('error', t('auth.offline'), 'alert');
                return;
            }
            // NOT chain.failed - that reads "Transaction failed", and nothing was ever sent.
            toasts.push('error', t('auth.failed'), 'alert');
        }
    };

    return (
        <Sheet open={chrome.authOpen()} title={t('auth.title')} onClose={() => chrome.close()}>
            <div className="flex flex-col gap-4">
                <p className="text-[14px] text-muted">{t('auth.subtitle')}</p>

                {session.wallets().length === 0 && (
                    <p className="flex items-start gap-2 rounded-control bg-overlay p-3 text-[13px] leading-relaxed text-muted">
                        <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-gold" />
                        <span>{t('auth.noWallets')}</span>
                    </p>
                )}

                {session.wallets().length > 0 && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {session.wallets().map((entry) => (
                            <button
                                key={entry.rdns}
                                className={
                                    session.connecting() !== null && session.connecting() !== entry.rdns
                                        ? 'flex h-14 cursor-pointer items-center gap-3 rounded-control border border-line bg-raised px-3 opacity-40 transition duration-200'
                                        : 'flex h-14 cursor-pointer items-center gap-3 rounded-control border border-line bg-raised px-3 transition duration-200 hover:border-line-strong hover:bg-overlay active:scale-[0.98]'
                                }
                                type="button"
                                disabled={session.connecting() !== null}
                                onClick={() => void pick(entry)}
                            >
                                {entry.brand !== null ? (
                                    <BrandIcon brand={entry.brand} size={26} />
                                ) : (
                                    <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center overflow-hidden rounded-md bg-overlay">
                                        {entry.icon !== '' ? (
                                            <img className="h-full w-full object-contain" src={entry.icon} alt="" />
                                        ) : (
                                            <Icon name="wallet" size={15} className="text-muted" />
                                        )}
                                    </span>
                                )}
                                <span className="min-w-0 flex-1 truncate text-start text-[13px] font-semibold">
                                    {session.connecting() === entry.rdns ? (
                                        <span className="text-muted">{t('auth.connecting')}...</span>
                                    ) : (
                                        <span>{entry.name}</span>
                                    )}
                                </span>
                                {session.connecting() === entry.rdns && (
                                    <span
                                        className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-brand"
                                        aria-hidden="true"
                                    ></span>
                                )}
                            </button>
                        ))}
                    </div>
                )}

                {/* One column, unlike the connect grid above: the trailing Install badge and a
                    name as long as "Binance Wallet" do not both survive a half-width cell. */}
                <div className="flex flex-col gap-2">
                    {missing.map((offer) => (
                        <a
                            key={offer.rdns}
                            className="flex h-12 items-center gap-3 rounded-control border border-line border-dashed px-3 transition duration-200 hover:border-line-strong hover:bg-overlay"
                            href={offer.install}
                            target="_blank"
                            rel="noreferrer"
                        >
                            <BrandIcon brand={offer.brand} size={22} />
                            <span className="min-w-0 flex-1 truncate text-start text-[13px] font-semibold text-muted">
                                {WALLET_LABEL[offer.brand]}
                            </span>
                            <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-faint">
                                {t('auth.install')}
                                <Icon name="external" size={12} />
                            </span>
                        </a>
                    ))}
                </div>

                <p className="flex items-start gap-2 text-[12px] leading-relaxed text-faint">
                    <Icon name="info" size={14} className="mt-0.5 shrink-0" />
                    <span>{t('auth.terms')}</span>
                </p>
            </div>
        </Sheet>
    );
}
