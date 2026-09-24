import { createStore, createSignal, createResource, type Getter, type Resource } from 'azerothjs';
import type { Address, Hash } from 'viem';

import {
    client,
    categoryMessage,
    categoryDeleteMessage,
    featureMessage,
    marketEditMessage,
    marketRevertMessage,
    creatorMessage,
    creatorRemoveMessage,
    proposalMessage,
    proposalDecideMessage,
    proposalTitle,
    telegramSettingsMessage,
    sessionMessage,
    type ActivityPage,
    type AdminMarketPage,
    type AdminStats,
    type Localized,
    type CreatorAccess,
    type MarketCreator,
    type Proposal,
    type TelegramState,
    type MarketEditOutcome,
    type MarketKindName,
    type MarketSort,
    type MarketStatusName
} from '../api.ts';

import {
    isAdmin,
    createMarket,
    createMarket2,
    createdMarket,
    resolveMarket,
    cancelMarket,
    setDefaultFees,
    setTreasury,
    repointTreasury,
    sweepUnclaimed,
    addCategory,
    setCategoryMeanings,
    setCategoryEnabled,
    setResolutionSigners,
    withdrawFees,
    setFeeRecipient,
    treasuryState,
    factoryConfig,
    resolutionPolicy,
    type AdminSigner,
    type CreateMarketInput,
    type FactoryConfig,
    type ResolutionPolicy
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

    /**
     * Whether this wallet is on the console's ALLOWLIST - invited to prepare markets without
     * being promoted. Asked of the one public creator route, because the wallet asking is by
     * definition not an admin and cannot read a list only admins may read.
     *
     * It lives here rather than in the console page because it is not the page's question: the
     * header has to know too, and a gate computed in two places is a gate that disagrees with
     * itself.
     */
    invited: Resource<CreatorAccess>;

    /** True when /admin has ANYTHING to show this wallet - the whole console for an admin, the
     *  create form for an invited contributor. What every link to it is gated on. */
    canOpenConsole: Getter<boolean>;

    /** Aggregate tiles. */
    stats: Resource<AdminStats>;

    /** The current page of the registry under the active filters. */
    rows: Resource<AdminMarketPage>;

    /** A page of recent trades across every market. */
    activity: Resource<ActivityPage>;

    /** The feed's current page. */
    feedPage: Getter<number>;
    setFeedPage(next: number): void;

    /** The factory's on-chain defaults, re-read after every write that changes them. */
    defaults: Resource<FactoryConfig>;

    /** On-chain treasury state (owner, recipient, lifetime take). */
    treasury: Resource<{ totalCollected: bigint; feeRecipient: Address; owner: Address }>;

    /** The factory's resolution multisig: the signer set, the quorum, and who appoints them. */
    policy: Resource<ResolutionPolicy>;

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
        input: CreateMarketInput,
        kind?: MarketKindName
    ): Promise<{ hash: Hash; market: { marketId: number; address: Address } | null } | null>;
    resolve(marketId: number, winningOutcome: number): Promise<boolean>;
    cancel(marketId: number): Promise<boolean>;
    saveFees(feeBps: number): Promise<boolean>;
    pointTreasury(treasury: Address): Promise<boolean>;

    /**
     * Points ONE already-deployed market at the factory's current treasury. Changing the
     * factory's treasury only redirects markets created afterwards - every existing clone keeps
     * paying the address it was born with until this runs against it.
     */
    repoint(marketId: number): Promise<boolean>;

    /**
     * Moves a settled market's unclaimed remainder to the treasury. The clone enforces its own
     * claim window, so this reverts until that window has run out.
     */
    sweep(marketId: number): Promise<boolean>;

    /**
     * Registers a category id ON CHAIN with what it means in each language written. The id is
     * permanent and the factory refuses a market filed under one it does not know; the names
     * are what every reader is shown, and English is the floor the factory insists on.
     */
    addCategory(id: number, names: Localized): Promise<boolean>;

    /** Replaces what a registered category means in the languages given. */
    setCategoryNames(id: number, names: Localized): Promise<boolean>;

    /** Opens or retires a category for NEW markets; the ones already filed keep it. */
    setCategoryOpen(id: number, enabled: boolean): Promise<boolean>;

    /**
     * Replaces the resolution signer set and the quorum. Factory OWNER only - ADMIN_ROLE cannot
     * do this, which is the point of the multisig.
     */
    saveSigners(signers: Address[], required: number): Promise<boolean>;
    withdraw(amount: bigint): Promise<boolean>;
    changeRecipient(recipient: Address): Promise<boolean>;

    /**
     * Writes a category's presentation metadata (label, image, order, retired) through the
     * signed indexer endpoint. The id is the on-chain string and is never editable.
     */
    saveCategory(entry: { id: string; label: Localized; sortOrder: number; retired: boolean }): Promise<boolean>;

    /**
     * Removes a category's presentation row. The id itself is on-chain inside every market
     * that carries it, so those keep listing - under the raw id, until it is registered again.
     */
    deleteCategory(id: string): Promise<boolean>;

    /** Toggles a market's curated featured flag through the signed indexer endpoint. */
    feature(marketId: string, featured: boolean): Promise<boolean>;

    /**
     * Corrects a market that is ALREADY DEPLOYED. The contracts write the title, rules, image,
     * category and outcome names once and expose no setter for any of them, so this changes
     * what the site shows and nothing the chain knows - which is why the dialog keeps the
     * on-chain text in view and {@link revertMarket} can always put it back.
     */
    editMarket(input: {
        marketId: string;
        title: Localized;
        emoji: string;
        rules: Localized;
        image: string;
        category: string;
        tags: string[];
        outcomes: MarketEditOutcome[];
    }): Promise<boolean>;

    /** Drops a correction; the market reads exactly as it was deployed again. */
    revertMarket(marketId: string): Promise<boolean>;

    // ----------------------------------------------------------------------------------
    // The Telegram bot, and the market suggestions that arrive over it.

    /**
     * Wallets invited to prepare a market. An APP permission only - the factory still refuses
     * a deploy from them, so an invited wallet fills the create form in and hands the draft
     * back as a link. Nothing here is a transaction.
     */
    creators: Resource<MarketCreator[]>;

    /** Invites a wallet. The label is a name for the list; the address is the identity. */
    addCreator(wallet: string, label: string): Promise<boolean>;

    removeCreator(wallet: string): Promise<boolean>;

    /** The proposal queue: markets written by someone who cannot deploy one. Waiting first. */
    proposals: Resource<Proposal[]>;

    /**
     * Files the open draft as a proposal. NOT an admin action and not gated on the console
     * session - the wallet that calls this is usually a contributor who will never have one.
     * The draft is passed already encoded, so this store stays ignorant of a market's fields.
     */
    submitProposal(draft: string): Promise<number | null>;

    /** Accepts or declines one. Accepting deploys NOTHING: it records the verdict, and the
     *  deploy is the ordinary signed transaction the create form has always sent. */
    decideProposal(id: number, accept: boolean, note: string): Promise<boolean>;

    /** The bot's settings and its allowlist - one read for the whole tab. */
    telegram: Resource<TelegramState>;

    /** Backup period and the event feed switch. Applied to the running bot, not just saved. */
    saveTelegramSettings(settings: { backupMinutes: number; events: boolean }): Promise<boolean>;
}

// The ONE wallet the console opens for. This NARROWS the on-chain role check rather than
// replacing it: the factory still has to say the address holds ADMIN_ROLE, and a second
// address granted that role on-chain no longer gets the UI. Client-side gating hides the
// screen, it does not protect the writes - every one of those is still a signed transaction
// or a signed request the server re-verifies.
const ADMIN_ADDRESS = (
    import.meta.env.VITE_ADMIN_ADDRESS ?? '0x4ac0d9300422b408bA2AbF47995C87cF32763712'
).toLowerCase();

export const useAdmin = createStore((): AdminApi =>
{
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
        () => (session.address() === '' || factory() === null ? false : `${ session.address() }|${ factory() }`),
        (key: string) =>
        {
            const [address, factoryAddr] = key.split('|');
            return isAdmin(factoryAddr as Address, address);
        },
        { name: 'admin-role' }
    );

    const admitted = (): boolean => role.data() === true && session.address().toLowerCase() === ADMIN_ADDRESS;

    const checking = (): boolean => session.address() !== '' && factory() !== null && role.loading();

    // Asked ONLY once the role check has settled and come back no: an actual admin never has to
    // ask, and asking before the role is known would ask for every wallet that connects.
    const invited = createResource(
        () => (!checking() && !admitted() && session.address() !== '' ? session.address() : false),
        (address: string) => client.creators.check({ params: { address } }),
        { name: 'admin-invited' }
    );

    // One signature per session, not per request: the console reads a lot and a wallet
    // prompt on every poll would be unusable. The cookie is HttpOnly, so nothing on the
    // page can read it back.
    // Keyed by address: connecting a different admin wallet opens a new session rather
    // than reusing the previous one's cookie.
    const adminSession = createResource(
        () => (admitted() ? session.address() : false),
        async (address: string) =>
        {
            const wallet = await walletFor(session.provider(), address);
            const issuedAt = new Date().toISOString();
            const signature = await wallet.signMessage({
                account: address as Address,
                message: sessionMessage(issuedAt)
            });
            await client.session.signIn({ input: { address, issuedAt, signature } });
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
        () => (opened() ? `${ version() }|${ JSON.stringify(filters()) }` : false),
        () =>
        {
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
        () => (opened() ? `${ version() }|${ feedPage() }` : false),
        () => client.admin.activity({ query: { page: feedPage(), limit: 10 } }),
        { name: 'admin-activity' }
    );

    const telegram = createResource(
        () => (opened() ? `${ version() }` : false),
        () => client.admin.telegram(),
        { name: 'admin-telegram' }
    );

    const creators = createResource(
        () => (opened() ? `${ version() }` : false),
        () => client.admin.creators(),
        { name: 'admin-creators' }
    );

    const proposals = createResource(
        () => (opened() ? `${ version() }` : false),
        () => client.admin.proposals(),
        { name: 'admin-proposals' }
    );

    const treasury = createResource(
        () => (opened() && treasuryAddress() !== null ? `${ version() }|${ treasuryAddress() }` : false),
        (key: string) => treasuryState(key.split('|')[1] as Address),
        { name: 'admin-treasury' }
    );

    const defaults = createResource(
        () => (opened() && factory() !== null ? `${ version() }|${ factory() }` : false),
        (key: string) => factoryConfig(key.split('|')[1] as Address),
        { name: 'admin-defaults' }
    );

    const policy = createResource(
        () => (opened() && factory() !== null ? `${ version() }|${ factory() }` : false),
        (key: string) => resolutionPolicy(key.split('|')[1] as Address),
        { name: 'admin-policy' }
    );

    let generation = 1;
    const refresh = (): void =>
    {
        generation += 1;
        setVersion(generation);
    };

    const [searchInput, setSearchInput] = createSignal('');
    let searchTimer: ReturnType<typeof setTimeout> | null = null;

    const signer = (): AdminSigner => ({ provider: session.provider(), account: session.address() });

    /** A category's names as the factory takes them: one pair per language actually written. */
    const meanings = (names: Localized): Array<{ lang: string; meaning: string }> =>
        Object.entries(names)
            .filter(([, meaning]) => typeof meaning === 'string' && meaning.trim() !== '')
            .map(([lang, meaning]) => ({ lang, meaning: (meaning as string).trim() }));

    /** Deploys through the engine the form asked for: a pool is a different clone, not a flag. */
    const deploy = (factoryAddr: Address, input: CreateMarketInput, kind: MarketKindName): Promise<`0x${ string }`> =>
        kind === 'pool' ? createMarket2(factoryAddr, signer(), input) : createMarket(factoryAddr, signer(), input);

    /** Runs a write through the shared narration and refreshes the read model on success. */
    const act = async (send: (factoryAddr: Address) => Promise<`0x${ string }`>, key: string): Promise<boolean> =>
    {
        const factoryAddr = factory();
        if (factoryAddr === null)
        {
            return false;
        }
        const receipt = await onchain.execute(() => send(factoryAddr), key);
        if (receipt !== null)
        {
            refresh();
        }
        return receipt !== null;
    };

    return {
        isAdmin: admitted,
        checking,
        invited,
        canOpenConsole: () => admitted() || invited.data()?.allowed === true,
        stats,
        rows,
        activity,
        feedPage,
        setFeedPage,
        treasury,
        defaults,
        policy,
        filters,
        searchInput,
        setSearch: (next) =>
        {
            setSearchInput(next);
            if (searchTimer !== null)
            {
                clearTimeout(searchTimer);
            }
            searchTimer = setTimeout(() =>
            {
                setFilters({ ...filters(), search: next, page: 1 });
            }, 300);
        },
        setCategory: (next) => setFilters({ ...filters(), category: next, page: 1 }),
        setStatus: (next) => setFilters({ ...filters(), status: next, page: 1 }),
        setSort: (next) => setFilters({ ...filters(), sort: next, page: 1 }),
        setPage: (next) => setFilters({ ...filters(), page: next }),
        refresh,
        create: async (input, kind = 'amm') =>
        {
            const factoryAddr = factory();
            if (factoryAddr === null)
            {
                return null;
            }
            const receipt = await onchain.execute(() => deploy(factoryAddr, input, kind), 'create');
            if (receipt === null)
            {
                return null;
            }
            refresh();
            return { hash: receipt.transactionHash, market: createdMarket(receipt) };
        },
        resolve: (marketId, winningOutcome) =>
            act((factoryAddr) => resolveMarket(factoryAddr, signer(), marketId, winningOutcome), `resolve:${ marketId }`),
        cancel: (marketId) => act((factoryAddr) => cancelMarket(factoryAddr, signer(), marketId), `cancel:${ marketId }`),
        saveFees: (feeBps) => act((factoryAddr) => setDefaultFees(factoryAddr, signer(), feeBps), 'saveFees'),
        pointTreasury: (next) => act((factoryAddr) => setTreasury(factoryAddr, signer(), next), 'pointTreasury'),
        repoint: (marketId) =>
            act((factoryAddr) => repointTreasury(factoryAddr, signer(), marketId), `repoint:${ marketId }`),
        sweep: (marketId) => act((factoryAddr) => sweepUnclaimed(factoryAddr, signer(), marketId), `sweep:${ marketId }`),
        addCategory: (id, names) =>
            act((factoryAddr) => addCategory(factoryAddr, signer(), id, meanings(names)), `category:${ id }`),
        setCategoryNames: (id, names) =>
            act((factoryAddr) => setCategoryMeanings(factoryAddr, signer(), id, meanings(names)), `category:${ id }`),
        setCategoryOpen: (id, enabled) =>
            act((factoryAddr) => setCategoryEnabled(factoryAddr, signer(), id, enabled), `category:${ id }`),
        saveSigners: (signers, required) =>
            act((factoryAddr) => setResolutionSigners(factoryAddr, signer(), signers, required), 'signers'),
        withdraw: async (amount) =>
        {
            const target = treasuryAddress();
            if (target === null)
            {
                return false;
            }
            const receipt = await onchain.execute(() => withdrawFees(target, signer(), amount), 'withdraw');
            if (receipt !== null)
            {
                refresh();
            }
            return receipt !== null;
        },
        changeRecipient: async (recipient) =>
        {
            const target = treasuryAddress();
            if (target === null)
            {
                return false;
            }
            const receipt = await onchain.execute(() => setFeeRecipient(target, signer(), recipient), 'recipient');
            if (receipt !== null)
            {
                refresh();
            }
            return receipt !== null;
        },
        // The two admin writes that are SIGNED REQUESTS rather than transactions, so they do
        // not pass through onchain.execute's narration. They borrow the same error mapping
        // instead of swallowing the failure: declining the signature, a rejected request, or
        // the wrong network used to leave the star unchanged with nothing said at all.
        saveCategory: async (entry) =>
        {
            try
            {
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
            }
            catch (error)
            {
                onchain.narrate(error);
                return false;
            }
        },
        deleteCategory: async (id) =>
        {
            try
            {
                const wallet = await walletFor(session.provider(), session.address());
                const issuedAt = new Date().toISOString();
                const key = id.trim().toLowerCase();
                const signature = await wallet.signMessage({
                    account: session.address() as Address,
                    message: categoryDeleteMessage(key, issuedAt)
                });
                await client.categories.remove({
                    input: { id: key, address: session.address(), issuedAt, signature }
                });
                categories.refresh();
                refresh();
                return true;
            }
            catch (error)
            {
                onchain.narrate(error);
                return false;
            }
        },
        editMarket: async (input) =>
        {
            try
            {
                const wallet = await walletFor(session.provider(), session.address());
                const issuedAt = new Date().toISOString();
                const signature = await wallet.signMessage({
                    account: session.address() as Address,
                    message: marketEditMessage(input.marketId, issuedAt)
                });
                await client.admin.editMarket({
                    input: { ...input, address: session.address(), issuedAt, signature }
                });
                // The category may be new to the registry, and the listing reads the same rows
                // the correction just rewrote - both have to be re-pulled, not just the table.
                categories.refresh();
                refresh();
                return true;
            }
            catch (error)
            {
                onchain.narrate(error);
                return false;
            }
        },

        revertMarket: async (marketId) =>
        {
            try
            {
                const wallet = await walletFor(session.provider(), session.address());
                const issuedAt = new Date().toISOString();
                const signature = await wallet.signMessage({
                    account: session.address() as Address,
                    message: marketRevertMessage(marketId, issuedAt)
                });
                await client.admin.revertMarket({
                    input: { marketId, address: session.address(), issuedAt, signature }
                });
                categories.refresh();
                refresh();
                return true;
            }
            catch (error)
            {
                onchain.narrate(error);
                return false;
            }
        },

        telegram,
        // The bot writes, like the category ones above, are SIGNED REQUESTS rather than
        // transactions, so they borrow onchain.narrate's error mapping instead of swallowing
        // a declined signature and leaving the form looking like it saved.
        saveTelegramSettings: async (settings) =>
        {
            try
            {
                const wallet = await walletFor(session.provider(), session.address());
                const issuedAt = new Date().toISOString();
                const signature = await wallet.signMessage({
                    account: session.address() as Address,
                    message: telegramSettingsMessage(settings.backupMinutes, settings.events, issuedAt)
                });
                await client.admin.saveTelegram({
                    input: { ...settings, address: session.address(), issuedAt, signature }
                });
                telegram.refetch();
                return true;
            }
            catch (error)
            {
                onchain.narrate(error);
                return false;
            }
        },

        creators,

        addCreator: async (wallet, label) =>
        {
            try
            {
                const signing = await walletFor(session.provider(), session.address());
                const issuedAt = new Date().toISOString();
                const key = wallet.trim();
                const signature = await signing.signMessage({
                    account: session.address() as Address,
                    message: creatorMessage(key, issuedAt)
                });
                await client.admin.addCreator({
                    input: { wallet: key, label: label.trim(), address: session.address(), issuedAt, signature }
                });
                creators.refetch();
                return true;
            }
            catch (error)
            {
                onchain.narrate(error);
                return false;
            }
        },

        removeCreator: async (wallet) =>
        {
            try
            {
                const signing = await walletFor(session.provider(), session.address());
                const issuedAt = new Date().toISOString();
                const key = wallet.trim();
                const signature = await signing.signMessage({
                    account: session.address() as Address,
                    message: creatorRemoveMessage(key, issuedAt)
                });
                await client.admin.removeCreator({
                    input: { wallet: key, address: session.address(), issuedAt, signature }
                });
                creators.refetch();
                return true;
            }
            catch (error)
            {
                onchain.narrate(error);
                return false;
            }
        },

        proposals,

        submitProposal: async (draft) =>
        {
            try
            {
                const signing = await walletFor(session.provider(), session.address());
                const issuedAt = new Date().toISOString();
                // The title is read back OUT of the draft rather than passed beside it, so
                // both halves sign the same sentence about the same question.
                const signature = await signing.signMessage({
                    account: session.address() as Address,
                    message: proposalMessage(proposalTitle(draft), issuedAt)
                });
                const filed = await client.proposals.submit({
                    input: { draft, address: session.address(), issuedAt, signature }
                });
                proposals.refetch();
                return filed.id;
            }
            catch (error)
            {
                onchain.narrate(error);
                return null;
            }
        },

        decideProposal: async (id, accept, note) =>
        {
            try
            {
                const signing = await walletFor(session.provider(), session.address());
                const issuedAt = new Date().toISOString();
                const signature = await signing.signMessage({
                    account: session.address() as Address,
                    message: proposalDecideMessage(id, accept, issuedAt)
                });
                await client.admin.decideProposal({
                    input: { id, accept, note: note.trim(), address: session.address(), issuedAt, signature }
                });
                proposals.refetch();
                return true;
            }
            catch (error)
            {
                onchain.narrate(error);
                return false;
            }
        },

        feature: async (marketId, featured) =>
        {
            try
            {
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
            }
            catch (error)
            {
                onchain.narrate(error);
                return false;
            }
        }
    };
});
