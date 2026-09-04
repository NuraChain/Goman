import { useLocale } from '../../stores/locale.store.ts';
import { useChrome } from '../../stores/chrome.store.ts';
import { useSession, WalletUnavailableError, type DiscoveredWallet } from '../../stores/session.store.ts';
import { useToasts } from '../../stores/toasts.store.ts';

import { WALLET_LABEL, type WalletBrand } from '../../icons/brands.ts';
import BrandIcon from '../../icons/brand-icon.tsx';
import Icon from '../../icons/icon.tsx';

import Sheet from '../ui/sheet.tsx';

// Wallet-ONLY auth: the wallet IS the account system on a web3 market. Still ONE surface,
// ever - the anti-pattern this replaces is a QR overlay stacked on a dialog stacked on a
// modal. The list is what the BROWSER announced over EIP-6963, not a fixed brand grid: a
// fixed grid tells someone with Frame or Zerion installed that they have no wallet, and
// offers five they do not have. A missing extension and a declined request each answer with
// an honest toast.
export default function AuthSheet() {
    const { t } = useLocale();
    const chrome = useChrome();
    const session = useSession();
    const toasts = useToasts();

    // Shown only when nothing announced itself - then the grid is advice on what to install,
    // and says so, rather than six buttons that all fail the same way.
    const suggestions = Object.keys(WALLET_LABEL) as WalletBrand[];

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
            // Only 4001 is a DECLINE (EIP-1193). Reporting every other failure - a locked
            // wallet, a dead RPC, an internal provider error - as "you declined" hides a real
            // problem behind a choice the visitor never made.
            if ((error as { code?: number }).code === 4001) {
                toasts.push('info', t('auth.rejected'), 'info');
                return;
            }
            toasts.push('error', t('chain.failed'), 'alert');
        }
    };

    return (
        <Sheet open={chrome.authOpen()} title={t('auth.title')} onClose={() => chrome.close()}>
            <div className="flex flex-col gap-4">
                <p className="text-[14px] text-muted">{t('auth.subtitle')}</p>

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

                {session.wallets().length === 0 && (
                    <div className="flex flex-col gap-3">
                        <p className="flex items-start gap-2 rounded-control bg-overlay p-3 text-[13px] leading-relaxed text-muted">
                            <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-gold" />
                            <span>{t('auth.noWallets')}</span>
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                            {suggestions.map((brand) => (
                                <span
                                    key={brand}
                                    className="flex h-12 items-center gap-3 rounded-control border border-line px-3 opacity-60"
                                >
                                    <BrandIcon brand={brand} size={22} />
                                    <span className="min-w-0 flex-1 truncate text-start text-[13px] font-semibold">
                                        {WALLET_LABEL[brand]}
                                    </span>
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                <p className="flex items-start gap-2 text-[12px] leading-relaxed text-faint">
                    <Icon name="info" size={14} className="mt-0.5 shrink-0" />
                    <span>{t('auth.terms')}</span>
                </p>
            </div>
        </Sheet>
    );
}
