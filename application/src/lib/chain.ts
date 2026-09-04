import { defineChain, type Chain } from 'viem';

// The target Cosmos EVM chain, described once. Values come from the build environment so a
// deployment can be re-pointed without a code change; the defaults match a local Hardhat node
// so `npm run dev` works with no .env at all.

const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? '31337');
const RPC_URL = import.meta.env.VITE_RPC_URL ?? 'http://127.0.0.1:8545';
const NAME = import.meta.env.VITE_CHAIN_NAME ?? 'Local EVM';
const SYMBOL = import.meta.env.VITE_CURRENCY_SYMBOL ?? 'ETH';
const DECIMALS = Number(import.meta.env.VITE_CURRENCY_DECIMALS ?? '18');
const EXPLORER = import.meta.env.VITE_EXPLORER_URL ?? '';

/** The chain every read and write in the app targets. */
export const chain: Chain = defineChain({
    id: CHAIN_ID,
    name: NAME,
    nativeCurrency: { name: SYMBOL, symbol: SYMBOL, decimals: DECIMALS },
    rpcUrls: { default: { http: [RPC_URL] } },
    ...(EXPLORER === '' ? {} : { blockExplorers: { default: { name: 'Explorer', url: EXPLORER } } })
});

/** Hex chain id in the shape `wallet_switchEthereumChain` expects. */
export const chainIdHex = `0x${CHAIN_ID.toString(16)}`;

/** A transaction's URL on the configured explorer, or null when none is configured. */
export function explorerTxUrl(hash: string): string | null {
    return EXPLORER === '' ? null : `${EXPLORER.replace(/\/$/, '')}/tx/${hash}`;
}
