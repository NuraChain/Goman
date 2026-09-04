import { formatEther, parseAbiItem, parseEventLogs, type Address, type Hash, type TransactionReceipt } from 'viem';

import { publicClient, walletFor, factoryAbi, marketAbi } from './contracts.ts';
import { chain } from './chain.ts';
import { decodeOutcomeMeta, type Localized } from '../api.ts';
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

/** A live market detail strip: outcomes with names, prices, and reserves. */
export interface AdminMarketDetail {
    outcomes: Array<{ label: Localized & { icon: string }; price: bigint; reserve: bigint }>;
    totalSets: bigint;
    winningOutcome: number | null;
}

/** True when `account` holds ADMIN_ROLE on the factory - the console's gate. */
export async function isAdmin(factory: Address, account: string): Promise<boolean> {
    if (account === '') {
        return false;
    }
    const role = (await publicClient.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: 'ADMIN_ROLE'
    })) as `0x${string}`;

    return publicClient.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: 'hasRole',
        args: [role, account as Address]
    }) as Promise<boolean>;
}

/** Live per-outcome detail for one market, read from the clone (not the index). */
export async function fetchMarketDetail(market: Address, resolved: boolean): Promise<AdminMarketDetail> {
    const read = <T>(functionName: string, args: unknown[] = []): Promise<T> =>
        publicClient.readContract({ address: market, abi: marketAbi, functionName, args }) as Promise<T>;

    const [reserves, prices, totalSets, outcomeCount] = await Promise.all([
        read<readonly bigint[]>('getReserves'),
        read<readonly bigint[]>('getPrices'),
        read<bigint>('totalSets'),
        read<bigint>('outcomeCount')
    ]);

    const names = await Promise.all(
        Array.from({ length: Number(outcomeCount) }, (_, i) => read<string>('outcomeName', [BigInt(i)]))
    );

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

const CREATED_EVENT = parseAbiItem(
    'event MarketCreated(uint256 indexed marketId, address indexed market, address indexed creator, string category, uint256 outcomeCount, uint256 initialFunding)'
);

/** Everything the create-market form submits (title/description already envelope-encoded). */
export interface CreateMarketInput {
    title: string;
    description: string;
    category: string;
    imageURI: string;
    lockTime: number;
    resolveTime: number;
    feeBps: number;
    protocolFeeShareBps: number;
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
): Promise<Hash> {
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
export async function createMarket(factory: Address, signer: AdminSigner, input: CreateMarketInput): Promise<Hash> {
    const params = {
        title: input.title,
        description: input.description,
        category: input.category,
        imageURI: input.imageURI,
        creator: signer.account as Address,
        lockTime: BigInt(input.lockTime),
        resolveTime: BigInt(input.resolveTime),
        feeBps: input.feeBps,
        protocolFeeShareBps: input.protocolFeeShareBps,
        outcomeNames: input.outcomeNames
    };
    return factoryWrite(factory, signer, 'createMarket', [params], input.initialLiquidity);
}

/** Deploys a new parimutuel pool market (no seed liquidity, not payable). */
export async function createMarket2(
    factory: Address,
    signer: AdminSigner,
    input: Omit<CreateMarketInput, 'initialLiquidity'>
): Promise<Hash> {
    const params = {
        title: input.title,
        description: input.description,
        category: input.category,
        imageURI: input.imageURI,
        creator: signer.account as Address,
        lockTime: BigInt(input.lockTime),
        resolveTime: BigInt(input.resolveTime),
        feeBps: input.feeBps,
        protocolFeeShareBps: input.protocolFeeShareBps,
        outcomeNames: input.outcomeNames
    };
    return factoryWrite(factory, signer, 'createMarket2', [params]);
}

/** The new market's registry id and address, read from the receipt's MarketCreated log. */
export function createdMarket(receipt: TransactionReceipt): { marketId: number; address: Address } | null {
    const [log] = parseEventLogs({ abi: [CREATED_EVENT], logs: receipt.logs });
    return log === undefined ? null : { marketId: Number(log.args.marketId), address: log.args.market };
}

/** Pauses a market (reversible). */
export function pauseMarket(factory: Address, signer: AdminSigner, marketId: number): Promise<Hash> {
    return factoryWrite(factory, signer, 'pauseMarket', [BigInt(marketId)]);
}

/** Resumes a paused market. */
export function unpauseMarket(factory: Address, signer: AdminSigner, marketId: number): Promise<Hash> {
    return factoryWrite(factory, signer, 'unpauseMarket', [BigInt(marketId)]);
}

/** Permanently closes a market ahead of resolution. */
export function closeMarket(factory: Address, signer: AdminSigner, marketId: number): Promise<Hash> {
    return factoryWrite(factory, signer, 'closeMarket', [BigInt(marketId)]);
}

/** Resolves a market to `winningOutcome` via the multisig signer set (N-of-M confirmations). */
export function resolveMarket(
    factory: Address,
    signer: AdminSigner,
    marketId: number,
    winningOutcome: number
): Promise<Hash> {
    // Factory 0.8.24 replaces the former `resolveMarket` with `confirmResolution` (multisig):
    // a signer votes for an outcome, and the last required vote executes resolution in same tx.
    return factoryWrite(factory, signer, 'confirmResolution', [BigInt(marketId), BigInt(winningOutcome)]);
}

/** Voids a market for equal refunds. */
export function voidMarket(factory: Address, signer: AdminSigner, marketId: number): Promise<Hash> {
    return factoryWrite(factory, signer, 'voidMarket', [BigInt(marketId)]);
}

/** Updates the default fees applied to newly created markets. */
export function setDefaultFees(
    factory: Address,
    signer: AdminSigner,
    feeBps: number,
    protocolFeeShareBps: number
): Promise<Hash> {
    return factoryWrite(factory, signer, 'setDefaultFees', [feeBps, protocolFeeShareBps]);
}

/** Points newly created markets at a different treasury. */
export function setTreasury(factory: Address, signer: AdminSigner, treasury: Address): Promise<Hash> {
    return factoryWrite(factory, signer, 'setTreasury', [treasury]);
}

/** Re-points one existing market at the factory's current treasury. */
export function repointTreasury(factory: Address, signer: AdminSigner, marketId: number): Promise<Hash> {
    return factoryWrite(factory, signer, 'repointTreasury', [BigInt(marketId)]);
}

/** A treasury write shared by the owner actions. */
async function treasuryWrite(
    treasury: Address,
    signer: AdminSigner,
    functionName: string,
    args: unknown[]
): Promise<Hash> {
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
export function withdrawFees(treasury: Address, signer: AdminSigner, amount: bigint): Promise<Hash> {
    return treasuryWrite(treasury, signer, 'withdraw', [amount]);
}

/** Changes the treasury's fee recipient (treasury owner only). */
export function setFeeRecipient(treasury: Address, signer: AdminSigner, recipient: Address): Promise<Hash> {
    return treasuryWrite(treasury, signer, 'setFeeRecipient', [recipient]);
}

/** The factory's default fee configuration (applied to markets that request 0). */
export async function factoryConfig(
    factory: Address
): Promise<{ defaultFeeBps: number; defaultProtocolFeeShareBps: number }> {
    const read = <T>(functionName: string): Promise<T> =>
        publicClient.readContract({ address: factory, abi: factoryAbi, functionName }) as Promise<T>;
    const [defaultFeeBps, defaultProtocolFeeShareBps] = await Promise.all([
        read<number>('defaultFeeBps'),
        read<number>('defaultProtocolFeeShareBps')
    ]);
    return { defaultFeeBps, defaultProtocolFeeShareBps };
}

/** The treasury's owner-facing state, read on-chain (the index does not track ownership). */
export async function treasuryState(
    treasury: Address
): Promise<{ totalCollected: bigint; feeRecipient: Address; owner: Address }> {
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
export function shortEther(wei: bigint): string {
    const [whole, frac = ''] = formatEther(wei).split('.');
    const trimmed = frac.slice(0, 4).replace(/0+$/, '');
    return trimmed === '' ? whole : `${whole}.${trimmed}`;
}
