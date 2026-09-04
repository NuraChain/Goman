/// <reference types="vite/client" />

/** Build-time chain configuration; see application/.env.example. */
interface ImportMetaEnv {
    /** JSON-RPC endpoint of the target Cosmos EVM chain. */
    readonly VITE_RPC_URL?: string;

    /** EVM chain id. */
    readonly VITE_CHAIN_ID?: string;

    /** Human-readable chain name shown when a wallet is asked to add the network. */
    readonly VITE_CHAIN_NAME?: string;

    /** Native currency symbol. */
    readonly VITE_CURRENCY_SYMBOL?: string;

    /** Native currency decimals. */
    readonly VITE_CURRENCY_DECIMALS?: string;

    /** Block-explorer base URL; empty disables transaction links. */
    readonly VITE_EXPLORER_URL?: string;

    /** First block the admin activity scan reads from (the factory's deploy block). */
    readonly VITE_DEPLOY_BLOCK?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
