// The REAL wallet session. Injected wallets announce themselves via EIP-6963
// (`eip6963:announceProvider` with an rdns identity); connecting asks the chosen provider
// for accounts over EIP-1193 and adopts the REAL address. A saved session restores
// silently on boot through `eth_accounts` (no prompt), and `accountsChanged`/`disconnect`
// keep the store honest afterward. WalletConnect has no injected provider (it is an SDK
// plus a relay), so until that SDK lands it can only report "not detected".
//
// EVERY announced wallet is admitted, keyed by its own rdns. Matching against a hard-coded
// brand list is what EIP-6963 exists to end: it made an installed Frame, Zerion, OKX or
// Brave wallet report "not detected", because the site had never heard of it.

import { createStore, createSignal, type Getter } from '../lib/reactive.ts';

import { readSetting, writeSetting } from '../lib/storage.ts';

import { useToasts } from './toasts.store.ts';
import { useLocale } from './locale.store.ts';

import type { WalletBrand } from '../icons/brands.ts';

const STORAGE_KEY = 'goman.session';
const LEGACY_STORAGE_KEY = 'auctionhouse.session';

/** The EIP-1193 minimum this store speaks; exported so the contract layer can transact. */
export interface Eip1193Provider {
    request(args: { method: string; params?: unknown[] }): Promise<unknown>;
    on?(event: string, handler: (payload: unknown) => void): void;
}

interface Eip6963Detail {
    info?: { rdns?: string; name?: string; icon?: string };
    provider: Eip1193Provider;
}

/** rdns identities we ship a crisp vector for; anything else uses the announced icon. */
const BRAND_RDNS: Record<string, WalletBrand> = {
    'io.metamask': 'metamask',
    'com.coinbase.wallet': 'coinbase',
    'app.phantom': 'phantom',
    'io.rabby': 'rabby',
    'com.trustwallet.app': 'trust'
};

/** One wallet the browser actually announced. `brand` is set only when we have its vector. */
export interface DiscoveredWallet {
    rdns: string;
    name: string;

    /** The wallet's OWN icon (a data URI, per EIP-6963). Used when `brand` is null. */
    icon: string;
    brand: WalletBrand | null;
}

/** Thrown when the picked wallet has not injected a provider (extension not installed). */
export class WalletUnavailableError extends Error {
    public readonly rdns: string;

    constructor(rdns: string) {
        super(`No injected provider for ${rdns}`);
        this.rdns = rdns;
    }
}

export interface SessionApi {
    /** True once a wallet session is established. */
    connected: Getter<boolean>;

    /** The rdns of the wallet a connection is mid-handshake with, or null. */
    connecting: Getter<string | null>;

    /** Every wallet this browser announced, in announcement order. */
    wallets: Getter<DiscoveredWallet[]>;

    /** The connected wallet's display name, or null. */
    wallet: Getter<string | null>;

    /** The connected account address ('' when signed out). */
    address: Getter<string>;

    /** The connected wallet's EIP-1193 provider, or null when signed out. This is the seam
     *  the on-chain layer transacts through - reading it is what lets a component send a
     *  transaction with the wallet the visitor already chose. */
    provider: Getter<Eip1193Provider | null>;

    /** Requests accounts from that wallet's provider; throws WalletUnavailableError when it
     *  is not installed, and rethrows the provider's rejection when declined. */
    connect(rdns: string): Promise<void>;

    /** Clears the LOCAL session; injected wallets keep their own permission list. */
    disconnect(): void;
}

export const useSession = createStore((): SessionApi => {
    const toasts = useToasts();
    const { t } = useLocale();

    const [wallet, setWallet] = createSignal<string | null>(null);
    const [connectedRdns, setConnectedRdns] = createSignal<string | null>(null);
    const [address, setAddress] = createSignal('');
    const [connecting, setConnecting] = createSignal<string | null>(null);
    const [wallets, setWallets] = createSignal<DiscoveredWallet[]>([]);

    const providers = new Map<string, Eip1193Provider>();
    const watched = new Set<Eip1193Provider>();

    const clear = (): void => {
        setWallet(null);
        setConnectedRdns(null);
        setAddress('');
        writeSetting(STORAGE_KEY, '');
    };

    const adopt = (entry: DiscoveredWallet, provider: Eip1193Provider, accounts: unknown): void => {
        const account = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : null;
        if (account === null) {
            return;
        }
        setWallet(entry.name);
        setConnectedRdns(entry.rdns);
        setAddress(account);
        writeSetting(STORAGE_KEY, entry.rdns);
        if (!watched.has(provider)) {
            watched.add(provider);
            // A wallet-side disconnect or account switch changes WHO the app is showing -
            // portfolio, claims, admin role and balance all silently re-resolve to someone
            // else. The in-app disconnect says so; these have to as well, or the page just
            // appears to lose its data.
            provider.on?.('accountsChanged', (next) => {
                const current = Array.isArray(next) && typeof next[0] === 'string' ? next[0] : null;
                if (current === null) {
                    clear();
                    toasts.push('info', t('toast.disconnected'), 'wallet');
                } else if (current.toLowerCase() !== address().toLowerCase()) {
                    setAddress(current);
                    toasts.push('info', t('toast.accountSwitched'), 'wallet');
                }
            });
            provider.on?.('disconnect', () => {
                clear();
                toasts.push('info', t('toast.disconnected'), 'wallet');
            });
        }
    };

    if (typeof window !== 'undefined') {
        window.addEventListener('eip6963:announceProvider', (event) => {
            const detail = (event as CustomEvent<Eip6963Detail>).detail;
            const rdns = detail?.info?.rdns;
            if (typeof rdns !== 'string' || rdns === '' || providers.has(rdns)) {
                return;
            }
            const entry: DiscoveredWallet = {
                rdns,
                name: detail.info?.name ?? rdns,
                icon: detail.info?.icon ?? '',
                brand: BRAND_RDNS[rdns] ?? null
            };
            providers.set(rdns, detail.provider);
            setWallets([...wallets(), entry]);
            // Silent restore: a returning visitor's saved wallet reconnects without a prompt
            // IF it still authorizes this origin - `eth_accounts` never pops UI.
            if ((readSetting(STORAGE_KEY) ?? readSetting(LEGACY_STORAGE_KEY)) === rdns && wallet() === null) {
                detail.provider
                    .request({ method: 'eth_accounts' })
                    .then((accounts) => adopt(entry, detail.provider, accounts))
                    .catch(() => {
                        /* a broken provider is simply not restored */
                    });
            }
        });
        window.dispatchEvent(new Event('eip6963:requestProvider'));
    }

    return {
        connected: () => address() !== '',
        connecting,
        wallets,
        wallet,
        address,
        provider: () => {
            const rdns = connectedRdns();
            return rdns === null ? null : (providers.get(rdns) ?? null);
        },
        connect: async (rdns) => {
            const provider = providers.get(rdns);
            const entry = wallets().find((candidate) => candidate.rdns === rdns);
            if (provider === undefined || entry === undefined) {
                throw new WalletUnavailableError(rdns);
            }
            setConnecting(rdns);
            try {
                adopt(entry, provider, await provider.request({ method: 'eth_requestAccounts' }));
            } finally {
                setConnecting(null);
            }
        },
        disconnect: clear
    };
});
