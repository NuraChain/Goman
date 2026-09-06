// Wallet brand identity: labels plus the self-hosted OFFICIAL vector assets (extracted
// once from @web3icons/core's branded set into public/wallets - no CDN, no runtime icon
// dependency). Brand colors live in the assets; theme never tints them.

export type WalletBrand =
    | 'nura'
    | 'metamask'
    | 'trust'
    | 'binance'
    | 'walletconnect'
    | 'coinbase'
    | 'phantom'
    | 'rabby';

export const WALLET_LABEL: Record<WalletBrand, string> = {
    nura: 'Nura Wallet',
    metamask: 'MetaMask',
    binance: 'Binance Wallet',
    walletconnect: 'WalletConnect',
    coinbase: 'Coinbase Wallet',
    phantom: 'Phantom',
    trust: 'Trust Wallet',
    rabby: 'Rabby'
};

// PARTIAL on purpose: a wallet we can name but have no official vector for falls back to the
// generic wallet glyph in BrandIcon. A drawn-from-memory brand mark is worse than none.
export const BRAND_SRC: Partial<Record<WalletBrand, string>> = {
    nura: '/wallets/nura.png',
    metamask: '/wallets/metamask.svg',
    binance: '/wallets/binance.svg',
    walletconnect: '/wallets/wallet-connect.svg',
    coinbase: '/wallets/coinbase.svg',
    phantom: '/wallets/phantom.svg',
    trust: '/wallets/trust.svg',
    rabby: '/wallets/rabby.svg'
};

/** A wallet the connect sheet can name before the browser has announced anything. */
export interface WalletOffer {
    brand: WalletBrand;

    /** What it announces over EIP-6963 - the join between an offer and a live provider. */
    rdns: string;

    /** Where to get it. Only ever opened for an offer that did NOT announce itself. */
    install: string;
}

// Order is the order the sheet lists them in: the chain's own wallet first. WalletConnect is
// absent on purpose - it is an SDK plus a relay, not an extension, so there is nothing to
// install and nothing will ever announce it.
export const WALLET_OFFERS: WalletOffer[] = [
    { brand: 'nura', rdns: 'net.nurachain.wallet', install: 'https://github.com/NuraChain/Wallet/releases' },
    { brand: 'metamask', rdns: 'io.metamask', install: 'https://metamask.io/download/' },
    { brand: 'trust', rdns: 'com.trustwallet.app', install: 'https://trustwallet.com/browser-extension' },
    { brand: 'binance', rdns: 'com.binance.wallet', install: 'https://www.binance.com/en/web3wallet' },
    { brand: 'coinbase', rdns: 'com.coinbase.wallet', install: 'https://www.coinbase.com/wallet/downloads' },
    { brand: 'phantom', rdns: 'app.phantom', install: 'https://phantom.com/download' },
    { brand: 'rabby', rdns: 'io.rabby', install: 'https://rabby.io/' }
];

/** rdns -> brand, DERIVED so an offer and the vector its announcement resolves to cannot
 *  drift apart. An announced wallet that is not an offer keeps its own announced icon. */
export const BRAND_RDNS: Record<string, WalletBrand> = Object.fromEntries(
    WALLET_OFFERS.map((offer) => [offer.rdns, offer.brand])
);
