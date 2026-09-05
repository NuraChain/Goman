import { createStore, createSignal, createResource, type Getter, type Resource } from '../lib/reactive.ts';
import type { Address, Hash } from 'viem';

import {
    client,
    categoryMessage,
    featureMessage,
    sessionMessage,
    type ActivityPage,
    type AdminMarketPage,
    type AdminStats,
    type DiscoverPage,
    type MarketSort,
    type MarketStatusName
} from '../api.ts';

import {
    isAdmin,
    createMarket,
    createdMarket,
    pauseMarket,
    unpauseMarket,
    closeMarket,
    resolveMarket,
    voidMarket,
    setDefaultFees,
    setTreasury,
    withdrawFees,
    setFeeRecipient,
    treasuryState,
    factoryConfig,
    type AdminSigner,
    type CreateMarketInput
} from '../lib/admin.ts';
import { walletFor } from '../lib/contracts.ts';

import { useSession } from './session.store.ts';
import { useOnchain } from './onchain.store.ts';
import { useConfig } from './config.store.ts';
import { useCategories } from './categories.store.ts';

// The admin console's state. Lists and stats come from the indexer (server-side search,
// filter, sort, pagination - built for a 100k-market registry); the role gate and every
// write stay directly on-chain. One refresh() re-pulls everything after a confirmed write.

/** The console's list controls; one object so the table, chips, and pager stay in sync. */
export interface AdminFilters {
    search: string;
    category: string | 'all';
    status: MarketStatusName | 'all';
    sort: MarketSort;
    page: number;
}

export interface AdminApi {
    /** True when the connected wallet holds ADMIN_ROLE on the factory. */
    isAdmin: Getter<boolean>;

    /** True while the role check for the current wallet is in flight. */
    checking: Getter<boolean>;

    /** Aggregate tiles. */
    stats: Resource<AdminStats>;

    /** The current page of the registry under the active filters. */
    rows: Resource<AdminMarketPage>;

    /** A page of recent trades across every market. */
    activity: Resource<ActivityPage>;

    /** Live markets on an external venue, matched against this registry. */
    discovery: Resource<DiscoverPage>;

    /** The discovery list's controls. */
    discoverFilters: Getter<{ search: string; missingOnly: boolean }>;
    setDiscoverSearch(next: string): void;
    setDiscoverMissingOnly(next: boolean): void;

    /** Re-crawls the venue instead of reading the server's cached crawl. */
    refreshDiscovery(): void;

    /** The feed's current page. */
    feedPage: Getter<number>;
    setFeedPage(next: number): void;

    /** The factory's on-chain defaults, re-read after every write that changes them. */
    defaults: Resource<{ defaultFeeBps: number; defaultProtocolFeeShareBps: number }>;

    /** On-chain treasury state (owner, recipient, lifetime take). */
    treasury: Resource<{ totalCollected: bigint; feeRecipient: Address; owner: Address }>;

    /** The active list controls. */
    filters: Getter<AdminFilters>;

    /**
     * The RAW text in the search box, kept here rather than in the table component: the
     * applied filter already lived in this store, so a component-local input meant leaving
     * the section and coming back showed an empty box over a still-filtered list.
     */
    searchInput: Getter<string>;

    /** Debounced search input (300ms before it hits the server). */
    setSearch(next: string): void;
    setCategory(next: string | 'all'): void;
    setStatus(next: MarketStatusName | 'all'): void;
    setSort(next: MarketSort): void;
    setPage(next: number): void;

    /** Re-pulls stats, rows, activity, and treasury. */
    refresh(): void;

    /**
     * null means NO transaction landed and nothing was spent. A result with a null `market`
     * means the deploy DID land but its MarketCreated log could not be read - the market
     * exists, and re-submitting the form would deploy a second one.
     */
    create(
        input: CreateMarketInput
    ): Promise<{ hash: Hash; market: { marketId: number; address: Address } | null } | null>;
    pause(marketId: number): Promise<boolean>;
    unpause(marketId: number): Promise<boolean>;
    close(marketId: number): Promise<boolean>;
    resolve(marketId: number, winningOutcome: number): Promise<boolean>;
    voidOut(marketId: number): Promise<boolean>;
    saveFees(feeBps: number, protocolFeeShareBps: number): Promise<boolean>;
    pointTreasury(treasury: Address): Promise<boolean>;
    withdraw(amount: bigint): Promise<boolean>;
    changeRecipient(recipient: Address): Promise<boolean>;

    /**
     * Writes a category's presentation metadata (label, image, order, retired) through the
     * signed indexer endpoint. The id is the on-chain string and is never editable.
     */
    saveCategory(entry: {
        id: string;
        labelEn: string;
        labelFa: string;
        image: string;
        sortOrder: number;
        retired: boolean;
    }): Promise<boolean>;

    /** Toggles a market's curated featured flag through the signed indexer endpoint. */
    feature(marketId: string, featured: boolean): Promise<boolean>;
}

// The ONE wallet the console opens for. This NARROWS the on-chain role check rather than
// replacing it: the factory still has to say the address holds ADMIN_ROLE, and a second
// address granted that role on-chain no longer gets the UI. Client-side gating hides the
// screen, it does not protect the writes - every one of those is still a signed transaction
// or a signed request the server re-verifies.
const ADMIN_ADDRESS = (
    import.meta.env.VITE_ADMIN_ADDRESS ?? '0x4ac0d9300422b408bA2AbF47995C87cF32763712'
).toLowerCase();

export const useAdmin = createStore((): AdminApi => {
    const session = useSession();
    const onchain = useOnchain();
    const config = useConfig();
    const categories = useCategories();

    const [version, setVersion] = createSignal(1);
    const [filters, setFilters] = createSignal<AdminFilters>({
        search: '',
        category: 'all',
        status: 'all',
        sort: 'newest',
        page: 1
    });

    const factory = (): Address | null => (config.data()?.factory ?? null) as Address | null;
    const treasuryAddress = (): Address | null => (config.data()?.treasury ?? null) as Address | null;

    const role = createResource(
        () => (session.address() === '' || factory() === null ? false : `${session.address()}|${factory()}`),
        (key: string) => {
            const [address, factoryAddr] = key.split('|');
            return isAdmin(factoryAddr as Address, address);
        },
        { name: 'admin-role' }
    );

    const admitted = (): boolean => role.data() === true && session.address().toLowerCase() === ADMIN_ADDRESS;

    // One signature per session, not per request: the console reads a lot and a wallet
    // prompt on every poll would be unusable. The cookie is HttpOnly, so nothing on the
    // page can read it back.
    // Keyed by address: connecting a different admin wallet opens a new session rather
    // than reusing the previous one's cookie.
    const adminSession = createResource(
        () => (admitted() ? session.address() : false),
        async (address: string) => {
            const wallet = await walletFor(session.provider(), address);
            const issuedAt = new Date().toISOString();
            const signature = await wallet.signMessage({
                account: address as Address,
                message: sessionMessage(issuedAt)
            });
            await client.admin.signIn({ input: { address, issuedAt, signature } });
            return true;
        },
        { name: 'admin-session' }
    );

    const opened = (): boolean => admitted() && adminSession.data() === true;

    const stats = createResource(
        () => (opened() ? version() : false),
        () => client.admin.stats(),
        { name: 'admin-stats' }
    );

    const rows = createResource(
        () => (opened() ? `${version()}|${JSON.stringify(filters())}` : false),
        () => {
            const active = filters();
            return client.admin.markets({
                query: {
                    ...(active.search.trim() === '' ? {} : { search: active.search.trim() }),
                    ...(active.category === 'all' ? {} : { category: active.category }),
                    ...(active.status === 'all' ? {} : { status: active.status }),
                    sort: active.sort,
                    page: active.page,
                    limit: 10
                }
            });
        },
        { name: 'admin-rows' }
    );

    const [feedPage, setFeedPage] = createSignal(1);

    const activity = createResource(
        () => (opened() ? `${version()}|${feedPage()}` : false),
        () => client.admin.activity({ query: { page: feedPage(), limit: 10 } }),
        { name: 'admin-activity' }
    );

    const [discoverFilters, setDiscoverFilters] = createSignal({ search: '', missingOnly: true });
    const [discoverNonce, setDiscoverNonce] = createSignal(0);

    // Set by the refresh button and consumed by the next fetch, so a filter change reads the
    // server's cached crawl (instant) while the button forces a new one (seconds).
    let forceCrawl = false;

    const discovery = createResource(
        () => (opened() ? `${JSON.stringify(discoverFilters())}|${discoverNonce()}` : false),
        () => {
            const force = forceCrawl;
            forceCrawl = false;
            const active = discoverFilters();
            return client.admin.discover({
                query: {
                    ...(active.search.trim() === '' ? {} : { search: active.search.trim() }),
                    ...(active.missingOnly ? { missingOnly: true } : {}),
                    ...(force ? { refresh: true } : {}),
                    limit: 100
                }
            });
        },
        { name: 'admin-discover' }
    );

    let discoverTimer: ReturnType<typeof setTimeout> | null = null;

    const treasury = createResource(
        () => (opened() && treasuryAddress() !== null ? `${version()}|${treasuryAddress()}` : false),
        (key: string) => treasuryState(key.split('|')[1] as Address),
        { name: 'admin-treasury' }
    );

    const defaults = createResource(
        () => (opened() && factory() !== null ? `${version()}|${factory()}` : false),
        (key: string) => factoryConfig(key.split('|')[1] as Address),
        { name: 'admin-defaults' }
    );

    let generation = 1;
    const refresh = (): void => {
        generation += 1;
        setVersion(generation);
    };

    const [searchInput, setSearchInput] = createSignal('');
    let searchTimer: ReturnType<typeof setTimeout> | null = null;

    const signer = (): AdminSigner => ({ provider: session.provider(), account: session.address() });

    /** Runs a write through the shared narration and refreshes the read model on success. */
    const act = async (send: (factoryAddr: Address) => Promise<`0x${string}`>, key: string): Promise<boolean> => {
        const factoryAddr = factory();
        if (factoryAddr === null) {
            return false;
        }
        const receipt = await onchain.execute(() => send(factoryAddr), key);
        if (receipt !== null) {
            refresh();
        }
        return receipt !== null;
    };

    return {
        isAdmin: admitted,
        checking: () => session.address() !== '' && factory() !== null && role.loading(),
        stats,
        rows,
        activity,
        discovery,
        discoverFilters,
        setDiscoverSearch: (next) => {
            if (discoverTimer !== null) {
                clearTimeout(discoverTimer);
            }
            discoverTimer = setTimeout(() => {
                setDiscoverFilters({ ...discoverFilters(), search: next });
            }, 300);
        },
        setDiscoverMissingOnly: (next) => setDiscoverFilters({ ...discoverFilters(), missingOnly: next }),
        refreshDiscovery: () => {
            forceCrawl = true;
            setDiscoverNonce(discoverNonce() + 1);
        },
        feedPage,
        setFeedPage,
        treasury,
        defaults,
        filters,
        searchInput,
        setSearch: (next) => {
            setSearchInput(next);
            if (searchTimer !== null) {
                clearTimeout(searchTimer);
            }
            searchTimer = setTimeout(() => {
                setFilters({ ...filters(), search: next, page: 1 });
            }, 300);
        },
        setCategory: (next) => setFilters({ ...filters(), category: next, page: 1 }),
        setStatus: (next) => setFilters({ ...filters(), status: next, page: 1 }),
        setSort: (next) => setFilters({ ...filters(), sort: next, page: 1 }),
        setPage: (next) => setFilters({ ...filters(), page: next }),
        refresh,
        create: async (input) => {
            const factoryAddr = factory();
            if (factoryAddr === null) {
                return null;
            }
            const receipt = await onchain.execute(() => createMarket(factoryAddr, signer(), input), 'create');
            if (receipt === null) {
                return null;
            }
            refresh();
            return { hash: receipt.transactionHash, market: createdMarket(receipt) };
        },
        pause: (marketId) => act((factoryAddr) => pauseMarket(factoryAddr, signer(), marketId), `pause:${marketId}`),
        unpause: (marketId) =>
            act((factoryAddr) => unpauseMarket(factoryAddr, signer(), marketId), `unpause:${marketId}`),
        close: (marketId) => act((factoryAddr) => closeMarket(factoryAddr, signer(), marketId), `close:${marketId}`),
        resolve: (marketId, winningOutcome) =>
            act((factoryAddr) => resolveMarket(factoryAddr, signer(), marketId, winningOutcome), `resolve:${marketId}`),
        voidOut: (marketId) => act((factoryAddr) => voidMarket(factoryAddr, signer(), marketId), `void:${marketId}`),
        saveFees: (feeBps, protocolFeeShareBps) =>
            act((factoryAddr) => setDefaultFees(factoryAddr, signer(), feeBps, protocolFeeShareBps), 'saveFees'),
        pointTreasury: (next) => act((factoryAddr) => setTreasury(factoryAddr, signer(), next), 'pointTreasury'),
        withdraw: async (amount) => {
            const target = treasuryAddress();
            if (target === null) {
                return false;
            }
            const receipt = await onchain.execute(() => withdrawFees(target, signer(), amount), 'withdraw');
            if (receipt !== null) {
                refresh();
            }
            return receipt !== null;
        },
        changeRecipient: async (recipient) => {
            const target = treasuryAddress();
            if (target === null) {
                return false;
            }
            const receipt = await onchain.execute(() => setFeeRecipient(target, signer(), recipient), 'recipient');
            if (receipt !== null) {
                refresh();
            }
            return receipt !== null;
        },
        // The two admin writes that are SIGNED REQUESTS rather than transactions, so they do
        // not pass through onchain.execute's narration. They borrow the same error mapping
        // instead of swallowing the failure: declining the signature, a rejected request, or
        // the wrong network used to leave the star unchanged with nothing said at all.
        saveCategory: async (entry) => {
            try {
                const wallet = await walletFor(session.provider(), session.address());
                const issuedAt = new Date().toISOString();
                const id = entry.id.trim().toLowerCase();
                const signature = await wallet.signMessage({
                    account: session.address() as Address,
                    message: categoryMessage(id, issuedAt)
                });
                await client.categories.save({
                    input: { ...entry, id, address: session.address(), issuedAt, signature }
                });
                categories.refresh();
                refresh();
                return true;
            } catch (error) {
                onchain.narrate(error);
                return false;
            }
        },
        feature: async (marketId, featured) => {
            try {
                const wallet = await walletFor(session.provider(), session.address());
                const issuedAt = new Date().toISOString();
                const signature = await wallet.signMessage({
                    account: session.address() as Address,
                    message: featureMessage(marketId, featured, issuedAt)
                });
                await client.admin.feature({
                    input: {
                        marketId,
                        featured,
                        address: session.address(),
                        issuedAt,
                        signature
                    }
                });
                refresh();
                return true;
            } catch (error) {
                onchain.narrate(error);
                return false;
            }
        }
    };
});
