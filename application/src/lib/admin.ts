import { formatEther, parseAbiItem, parseEventLogs, type Address, type Hash, type TransactionReceipt } from 'viem';

import { publicClient, walletFor, factoryAbi, marketAbi, poolAbi } from './contracts.ts';
import { chain } from './chain.ts';
import { decodeOutcomeMeta, type Localized, type MarketKindName } from '../api.ts';
import treasuryAbiJson from './abis/prediction-treasury.json' with { type: 'json' };

import type { Eip1193Provider } from '../stores/session.store.ts';

// The admin WRITE seam plus the two trustless reads the console keeps on-chain (the role
// gate and a row's live reserves). Every list/stat/feed read moved to the indexer - the
// factory and treasury addresses arrive from its /chain config, never from a local map.

/** ABI emitted by the contracts repo's `export-abis` script. */
export const treasuryAbi = treasuryAbiJson;

/** The connected wallet a write signs with. */
export interface AdminSigner {
    provider: Eip1193Provider | null;
    account: string;
}

/**
 * A live market detail strip: outcomes with names, prices, and reserves.
 *
 * Both engines report into this one shape. A pool has no reserves and no complete sets, so its
 * stake per outcome stands in for `reserve` and its pot for `totalSets` - both are wei either
 * way, and implied odds are WAD exactly like AMM prices, so the strip renders either unchanged.
 */
export interface AdminMarketDetail {
    outcomes: Array<{ label: Localized & { icon: string }; price: bigint; reserve: bigint }>;
    totalSets: bigint;
    winningOutcome: number | null;
}

/** True when `account` holds ADMIN_ROLE on the factory - the console's gate. */
export async function isAdmin(factory: Address, account: string): Promise<boolean>
{
    if (account === '')
    {
        return false;
    }
    const role = (await publicClient.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: 'ADMIN_ROLE'
    })) as `0x${ string }`;

    return publicClient.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: 'hasRole',
        args: [role, account as Address]
    }) as Promise<boolean>;
}

/**
 * Live per-outcome detail for one market, read from the clone (not the index).
 * @param market The clone address.
 * @param resolved Whether to also read the winning outcome.
 * @param kind Which engine the clone runs. It is REQUIRED because the two share no view
 *        surface: `getReserves` on a pool and `stakedFor` on an AMM both revert, so guessing
 *        leaves the console with a permanent skeleton over a market it cannot resolve.
 */
export async function fetchMarketDetail(
    market: Address,
    resolved: boolean,
    kind: MarketKindName
): Promise<AdminMarketDetail>
{
    const pool = kind === 'pool';
    const abi = pool ? poolAbi : marketAbi;
    const read = <T>(functionName: string, args: unknown[] = []): Promise<T> =>
        publicClient.readContract({ address: market, abi, functionName, args }) as Promise<T>;

    const outcomeCount = Number(await read<bigint>('outcomeCount'));
    const indexes = Array.from({ length: outcomeCount }, (_, i) => BigInt(i));

    const [prices, reserves, totalSets, names] = await Promise.all([
        pool
            ? Promise.all(indexes.map((index) => read<bigint>('impliedOdds', [index])))
            : read<readonly bigint[]>('getPrices'),
        pool
            ? Promise.all(indexes.map((index) => read<bigint>('stakedFor', [index])))
            : read<readonly bigint[]>('getReserves'),
        read<bigint>(pool ? 'totalPool' : 'totalSets'),
        Promise.all(indexes.map((index) => read<string>('outcomeName', [index])))
    ]);

    const winningOutcome = resolved ? Number(await read<bigint>('winningOutcome')) : null;

    return {
        outcomes: names.map((raw, i) => ({
            label: decodeOutcomeMeta(raw),
            price: prices[i] ?? 0n,
            reserve: reserves[i] ?? 0n
        })),
        totalSets,
        winningOutcome
    };
}

/** The factory's resolution multisig: who may confirm, how many must agree, who appoints them. */
export interface ResolutionPolicy {
    /** The appointed signer set, in stored order. */
    signers: Address[];

    /** Distinct confirmations needed on ONE outcome before a market resolves. */
    required: number;

    /** The only account `setResolutionSigners` accepts (the factory owner, not ADMIN_ROLE). */
    owner: Address;

    /** The contract's own cap on the set size, so the editor cannot compose a reverting call. */
    maxSigners: number;
}

/** Reads the factory's resolution policy. */
export async function resolutionPolicy(factory: Address): Promise<ResolutionPolicy>
{
    const read = <T>(functionName: string): Promise<T> =>
        publicClient.readContract({ address: factory, abi: factoryAbi, functionName }) as Promise<T>;

    const [signers, required, owner, maxSigners] = await Promise.all([
        read<readonly Address[]>('resolutionSigners'),
        read<bigint>('requiredConfirmations'),
        read<Address>('owner'),
        read<bigint>('MAX_SIGNERS')
    ]);

    return { signers: [...signers], required: Number(required), owner, maxSigners: Number(maxSigners) };
}

/** Where one market's resolution vote stands right now. */
export interface ResolutionVotes {
    /** Distinct confirmations per outcome index. */
    counts: number[];

    /** The outcome this account has already confirmed, or null when it has not voted. */
    mine: number | null;

    /** True when this account may confirm at all - `confirmResolution` is signer-gated. */
    isSigner: boolean;
}

/** The sentinel `confirmationOf` returns for a signer that has not voted on a market. */
const NO_VOTE = (1n << 256n) - 1n;

/**
 * Reads the live confirmation tally for a market.
 * @param factory Factory address.
 * @param marketId Registry id.
 * @param outcomeCount How many outcomes to tally.
 * @param account The wallet whose own vote is reported.
 */
export async function resolutionVotes(
    factory: Address,
    marketId: number,
    outcomeCount: number,
    account: string
): Promise<ResolutionVotes>
{
    const read = <T>(functionName: string, args: unknown[]): Promise<T> =>
        publicClient.readContract({ address: factory, abi: factoryAbi, functionName, args }) as Promise<T>;

    const [counts, mine, isSigner] = await Promise.all([
        Promise.all(
            Array.from({ length: outcomeCount }, (_, i) =>
                read<bigint>('confirmationCount', [BigInt(marketId), BigInt(i)])
            )
        ),
        account === '' ? Promise.resolve(NO_VOTE) : read<bigint>('confirmationOf', [BigInt(marketId), account]),
        account === '' ? Promise.resolve(false) : read<boolean>('isResolutionSigner', [account])
    ]);

    return {
        counts: counts.map((count) => Number(count)),
        mine: mine === NO_VOTE ? null : Number(mine),
        isSigner
    };
}

// The claim window is feature-detected rather than assumed: a clone deployed before it has no
// claimDeadline() at all, {@link claimWindowOf} reports null for that one, and nothing about
// sweeping is offered.

/**
 * When a settled market stops paying claims, in unix seconds. Null means the clone predates
 * the claim window (nothing expires, nothing sweeps) or has not settled yet.
 * @param market The clone address.
 */
export async function claimWindowOf(market: Address): Promise<number | null>
{
    try
    {
        const deadline = (await publicClient.readContract({
            address: market,
            abi: marketAbi,
            functionName: 'claimDeadline'
        })) as bigint;
        return deadline === 0n ? null : Number(deadline);
    }
    catch
    {
        return null;
    }
}

/**
 * Moves a settled market's unclaimed remainder to the treasury. The market enforces the timing
 * itself - it reverts while the claim window is open - so this can never outrun a winner.
 */
export async function sweepUnclaimed(factory: Address, signer: AdminSigner, marketId: number): Promise<Hash>
{
    const wallet = await walletFor(signer.provider, signer.account);
    return wallet.writeContract({
        address: factory,
        abi: factoryAbi,
        functionName: 'sweepUnclaimed',
        args: [BigInt(marketId)],
        chain,
        account: signer.account as Address
    });
}

const CREATED_EVENT = parseAbiItem(
    'event MarketCreated(uint256 indexed marketId, address indexed market, address indexed creator, uint32 categoryId, uint256 outcomeCount, uint256 initialFunding)'
);

/** Everything the create-market form submits (title/description already envelope-encoded). */
export interface CreateMarketInput {
    title: string;
    description: string;

    /** The registry id this market is filed under. The factory rejects one it does not know,
     *  or one that has been retired - the name a reader sees lives in the registry, per
     *  language, and is never carried by the market itself. */
    categoryId: number;
    imageURI: string;
    lockTime: number;
    resolveTime: number;
    feeBps: number;
    outcomeNames: string[];
    initialLiquidity: bigint;
}

/** A factory write shared by every lifecycle action. */
async function factoryWrite(
    factory: Address,
    signer: AdminSigner,
    functionName: string,
    args: unknown[],
    value?: bigint
): Promise<Hash>
{
    const wallet = await walletFor(signer.provider, signer.account);
    return wallet.writeContract({
        address: factory,
        abi: factoryAbi,
        functionName,
        args,
        chain,
        account: signer.account as Address,
        ...(value === undefined ? {} : { value })
    });
}

/** Deploys a new CPMM market through the factory, seeding it with `initialLiquidity`. */
export async function createMarket(factory: Address, signer: AdminSigner, input: CreateMarketInput): Promise<Hash>
{
    const params = {
        title: input.title,
        description: input.description,
        categoryId: input.categoryId,
        imageURI: input.imageURI,
        creator: signer.account as Address,
        lockTime: BigInt(input.lockTime),
        resolveTime: BigInt(input.resolveTime),
        feeBps: input.feeBps,
        outcomeNames: input.outcomeNames
    };
    return factoryWrite(factory, signer, 'createMarket', [params], input.initialLiquidity);
}

/** Deploys a new parimutuel pool market (no seed liquidity, not payable). */
export async function createMarket2(
    factory: Address,
    signer: AdminSigner,
    input: Omit<CreateMarketInput, 'initialLiquidity'>
): Promise<Hash>
{
    const params = {
        title: input.title,
        description: input.description,
        categoryId: input.categoryId,
        imageURI: input.imageURI,
        creator: signer.account as Address,
        lockTime: BigInt(input.lockTime),
        resolveTime: BigInt(input.resolveTime),
        feeBps: input.feeBps,
        outcomeNames: input.outcomeNames
    };
    return factoryWrite(factory, signer, 'createMarket2', [params]);
}

/** The new market's registry id and address, read from the receipt's MarketCreated log. */
export function createdMarket(receipt: TransactionReceipt): { marketId: number; address: Address } | null
{
    const [log] = parseEventLogs({ abi: [CREATED_EVENT], logs: receipt.logs });
    return log === undefined ? null : { marketId: Number(log.args.marketId), address: log.args.market };
}

/** Pauses a market (reversible). */
export function pauseMarket(factory: Address, signer: AdminSigner, marketId: number): Promise<Hash>
{
    return factoryWrite(factory, signer, 'pauseMarket', [BigInt(marketId)]);
}

/** Resumes a paused market. */
export function unpauseMarket(factory: Address, signer: AdminSigner, marketId: number): Promise<Hash>
{
    return factoryWrite(factory, signer, 'unpauseMarket', [BigInt(marketId)]);
}

/** Permanently closes a market ahead of resolution. */
export function closeMarket(factory: Address, signer: AdminSigner, marketId: number): Promise<Hash>
{
    return factoryWrite(factory, signer, 'closeMarket', [BigInt(marketId)]);
}

/** Resolves a market to `winningOutcome` via the multisig signer set (N-of-M confirmations). */
export function resolveMarket(
    factory: Address,
    signer: AdminSigner,
    marketId: number,
    winningOutcome: number
): Promise<Hash>
{
    // Factory 0.8.24 replaces the former `resolveMarket` with `confirmResolution` (multisig):
    // a signer votes for an outcome, and the last required vote executes resolution in same tx.
    return factoryWrite(factory, signer, 'confirmResolution', [BigInt(marketId), BigInt(winningOutcome)]);
}

/** Voids a market for equal refunds. */
export function voidMarket(factory: Address, signer: AdminSigner, marketId: number): Promise<Hash>
{
    return factoryWrite(factory, signer, 'voidMarket', [BigInt(marketId)]);
}

/**
 * Replaces the resolution signer set and the quorum in one transaction (factory OWNER only -
 * ADMIN_ROLE is not enough). Both halves move together because the contract rejects a quorum
 * larger than the set, so changing them in two calls has an order that always reverts.
 */
export function setResolutionSigners(
    factory: Address,
    signer: AdminSigner,
    signers: Address[],
    required: number
): Promise<Hash>
{
    return factoryWrite(factory, signer, 'setResolutionSigners', [signers, BigInt(required)]);
}

/** A language tag as the factory stores it: the text, left-aligned in bytes8. */
function langTag(lang: string): `0x${ string }`
{
    let hex = '';
    for (const char of lang.slice(0, 8))
    {
        hex += char.charCodeAt(0).toString(16).padStart(2, '0');
    }
    return `0x${ hex.padEnd(16, '0') }`;
}

/** What a category is called, in each language it has been named in. */
export interface CategoryMeanings {
    id: number;
    names: Array<{ lang: string; meaning: string }>;
}

/**
 * Registers a category id with its names. The factory requires the default language (English)
 * and will not take an id twice - the id is permanent, the names are not.
 */
export function addCategory(
    factory: Address,
    signer: AdminSigner,
    id: number,
    names: Array<{ lang: string; meaning: string }>
): Promise<Hash>
{
    return factoryWrite(factory, signer, 'addCategory', [
        id,
        names.map((entry) => langTag(entry.lang)),
        names.map((entry) => entry.meaning)
    ]);
}

/** Replaces what a registered category means in the given languages. */
export function setCategoryMeanings(
    factory: Address,
    signer: AdminSigner,
    id: number,
    names: Array<{ lang: string; meaning: string }>
): Promise<Hash>
{
    return factoryWrite(factory, signer, 'setCategoryMeanings', [
        id,
        names.map((entry) => langTag(entry.lang)),
        names.map((entry) => entry.meaning)
    ]);
}

/**
 * Opens or retires a category for NEW markets. Retiring never touches the markets already
 * filed under it - they keep their category and their name.
 */
export function setCategoryEnabled(factory: Address, signer: AdminSigner, id: number, enabled: boolean): Promise<Hash>
{
    return factoryWrite(factory, signer, 'setCategoryEnabled', [id, enabled]);
}

/** Updates the default trade fee applied to newly created markets. */
export function setDefaultFees(factory: Address, signer: AdminSigner, feeBps: number): Promise<Hash>
{
    return factoryWrite(factory, signer, 'setDefaultFees', [feeBps]);
}

/** Points newly created markets at a different treasury. */
export function setTreasury(factory: Address, signer: AdminSigner, treasury: Address): Promise<Hash>
{
    return factoryWrite(factory, signer, 'setTreasury', [treasury]);
}

/** Re-points one existing market at the factory's current treasury. */
export function repointTreasury(factory: Address, signer: AdminSigner, marketId: number): Promise<Hash>
{
    return factoryWrite(factory, signer, 'repointTreasury', [BigInt(marketId)]);
}

/** A treasury write shared by the owner actions. */
async function treasuryWrite(
    treasury: Address,
    signer: AdminSigner,
    functionName: string,
    args: unknown[]
): Promise<Hash>
{
    const wallet = await walletFor(signer.provider, signer.account);
    return wallet.writeContract({
        address: treasury,
        abi: treasuryAbi,
        functionName,
        args,
        chain,
        account: signer.account as Address
    });
}

/** Withdraws `amount` collected fees to the fee recipient (treasury owner only). */
export function withdrawFees(treasury: Address, signer: AdminSigner, amount: bigint): Promise<Hash>
{
    return treasuryWrite(treasury, signer, 'withdraw', [amount]);
}

/** Changes the treasury's fee recipient (treasury owner only). */
export function setFeeRecipient(treasury: Address, signer: AdminSigner, recipient: Address): Promise<Hash>
{
    return treasuryWrite(treasury, signer, 'setFeeRecipient', [recipient]);
}

/** The factory's default fee configuration (applied to markets that request 0). */
export interface FactoryConfig {
    defaultFeeBps: number;

    /** The clones every new market and pool is cut from. Read from the factory rather than
     *  configured: what an operator needs to know is what the LIVE factory points at, which is
     *  exactly what a mis-set deployment gets wrong. */
    marketImplementation: Address;
    poolImplementation: Address;
}

/** The factory's defaults and the clones it cuts markets from. */
export async function factoryConfig(factory: Address): Promise<FactoryConfig>
{
    const read = <T>(functionName: string): Promise<T> =>
        publicClient.readContract({ address: factory, abi: factoryAbi, functionName }) as Promise<T>;
    const [defaultFeeBps, marketImplementation, poolImplementation] = await Promise.all([
        read<number>('defaultFeeBps'),
        read<Address>('marketImplementation'),
        read<Address>('poolImplementation')
    ]);
    return { defaultFeeBps, marketImplementation, poolImplementation };
}

/** The treasury's owner-facing state, read on-chain (the index does not track ownership). */
export async function treasuryState(
    treasury: Address
): Promise<{ totalCollected: bigint; feeRecipient: Address; owner: Address }>
{
    const read = <T>(functionName: string): Promise<T> =>
        publicClient.readContract({ address: treasury, abi: treasuryAbi, functionName }) as Promise<T>;
    const [totalCollected, feeRecipient, owner] = await Promise.all([
        read<bigint>('totalCollected'),
        read<Address>('feeRecipient'),
        read<Address>('owner')
    ]);
    return { totalCollected, feeRecipient, owner };
}

/** A wei amount for display: ether trimmed to 4 decimals, Latin digits in both locales. */
export function shortEther(wei: bigint): string
{
    const [whole, frac = ''] = formatEther(wei).split('.');
    const trimmed = frac.slice(0, 4).replace(/0+$/, '');
    return trimmed === '' ? whole : `${ whole }.${ trimmed }`;
}
