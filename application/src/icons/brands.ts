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

// Order is the order the fallback grid suggests them in: the chain's own wallet first.
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
    walletconnect: '/wallets/wallet-connect.svg',
    coinbase: '/wallets/coinbase.svg',
    phantom: '/wallets/phantom.svg',
    trust: '/wallets/trust.svg',
    rabby: '/wallets/rabby.svg'
};
