import {
    createPublicClient,
    createWalletClient,
    custom,
    http,
    type Address,
    type Hash,
    type WalletClient,
    type TransactionReceipt
} from 'viem';

import { chain, chainIdHex, explorerUrl } from './chain.ts';
import factoryAbiJson from './abis/prediction-factory.json' with { type: 'json' };
import marketAbiJson from './abis/prediction-market.json' with { type: 'json' };
import poolAbiJson from './abis/prediction-pool.json' with { type: 'json' };
import treasuryAbiJson from './abis/prediction-treasury.json' with { type: 'json' };

import type { Eip1193Provider } from '../stores/session.store.ts';

// The contract seam. Reads go through a public client over the configured RPC (they work
// signed-out); writes go through a wallet client wrapping the connected wallet's EIP-1193
// provider, so the visitor signs with the wallet they already chose.

/** ABIs emitted by the contracts repo's `export-abis` script. */
export const factoryAbi = factoryAbiJson;
export const marketAbi = marketAbiJson;
export const poolAbi = poolAbiJson;
export const treasuryAbi = treasuryAbiJson;

/** Reads the chain without a wallet. */
export const publicClient = createPublicClient({ chain, transport: http() });

/** Thrown when a write is attempted with no connected wallet. */
export class NotConnectedError extends Error
{
    constructor()
    {
        super('No wallet connected');
    }
}

/** Thrown when the wallet sits on a different chain and the switch was declined. */
export class WrongChainError extends Error
{
    public readonly expected: number;

    constructor(expected: number)
    {
        super(`Wallet is not on chain ${ expected }`);
        this.expected = expected;
    }
}

/**
 * The EIP-3085 descriptor a wallet needs in order to ADD this chain. The explorer is included
 * when the deployment has one: a wallet that knows it links a transaction instead of showing a
 * bare hash.
 */
function addChainParams(): Record<string, unknown>
{
    return {
        chainId: chainIdHex,
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: chain.rpcUrls.default.http,
        ...(explorerUrl === null ? {} : { blockExplorerUrls: [explorerUrl] })
    };
}

/**
 * Asks the wallet to add this chain. Exposed on its own because {@link walletFor} only
 * reaches the same call while a transaction is already being signed - far too late for
 * someone who simply wants the network in their wallet before they fund it.
 * @param provider The connected wallet's EIP-1193 provider.
 */
export async function addChain(provider: Eip1193Provider | null): Promise<void>
{
    if (provider === null)
    {
        throw new NotConnectedError();
    }
    await provider.request({ method: 'wallet_addEthereumChain', params: [addChainParams()] });
}

/**
 * A wallet client bound to the connected provider, after making sure the wallet is on the
 * configured chain (asking it to switch, and to add the chain if it does not know it yet).
 * @param provider The connected wallet's EIP-1193 provider.
 * @param account The connected address.
 */
export async function walletFor(provider: Eip1193Provider | null, account: string): Promise<WalletClient>
{
    if (provider === null || account === '')
    {
        throw new NotConnectedError();
    }

    // OUR session outlives the WALLET's grant. A restarted extension, a revoked permission or
    // an account switched inside the wallet all leave this app holding an address the wallet
    // will no longer sign for, while the header still reads connected - and the first sign of
    // it is a 4100 thrown halfway through a write the visitor has already been promised.
    //
    // `eth_accounts` is the read-only half of the pair and never prompts, so this costs a
    // local round trip and answers honestly. When the grant IS gone, re-asking for it is a
    // prompt the visitor can still say yes to, which is what turns a dead end into a signature.
    const holds = (accounts: unknown): boolean =>
        Array.isArray(accounts) &&
        accounts.some((entry) => typeof entry === 'string' && entry.toLowerCase() === account.toLowerCase());

    if (!holds(await provider.request({ method: 'eth_accounts' })))
    {
        await provider.request({ method: 'eth_requestAccounts' });
        // Still not ours: the wallet answered with somebody else, so the address this app is
        // about to sign as is not one it holds. Nothing to prompt for a second time.
        if (!holds(await provider.request({ method: 'eth_accounts' })))
        {
            throw new NotConnectedError();
        }
    }

    const current = (await provider.request({ method: 'eth_chainId' })) as string;
    if (current.toLowerCase() !== chainIdHex.toLowerCase())
    {
        try
        {
            await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
        }
        catch (error)
        {
            // 4902 = the wallet has never heard of this chain; offer to add it, then retry.
            if ((error as { code?: number }).code === 4902)
            {
                await provider.request({ method: 'wallet_addEthereumChain', params: [addChainParams()] });
            }
            else
            {
                throw new WrongChainError(chain.id);
            }
        }
    }

    return createWalletClient({
        chain,
        account: account as Address,
        transport: custom(provider as { request: (args: never) => Promise<unknown> })
    });
}

/** A trade's slippage tolerance in basis points (1% of the quote). */
const SLIPPAGE_BPS = 100n;

/** Seconds a submitted trade stays valid on-chain (the Uniswap-conventional 30 minutes). */
const DEADLINE_SECONDS = 1800n;

/**
 * A trade deadline anchored to the CHAIN's clock, not the browser's: block timestamps may
 * run ahead of wall time (bursty local mining, miner drift), and a wall-anchored deadline
 * is then already expired in the very block that includes it.
 */
async function tradeDeadline(): Promise<bigint>
{
    const wall = BigInt(Math.floor(Date.now() / 1000));
    const latest = await publicClient
        .getBlock()
        .then((block) => block.timestamp)
        .catch(() => wall);
    return (latest > wall ? latest : wall) + DEADLINE_SECONDS;
}

/**
 * Quotes the shares a buy would mint, straight from the market's own math.
 * @param market Market address.
 * @param outcomeIndex On-chain outcome index.
 * @param value Gross collateral in wei.
 */
export async function quoteBuy(market: Address, outcomeIndex: number, value: bigint): Promise<bigint>
{
    return publicClient.readContract({
        address: market,
        abi: marketAbi,
        functionName: 'calcBuy',
        args: [BigInt(outcomeIndex), value]
    }) as Promise<bigint>;
}

const BPS = 10_000n;

/** `value / divisor` rounded up - the `Math.Rounding.Ceil` the contract's own math uses. */
function ceilDiv(value: bigint, divisor: bigint): bigint
{
    return (value + divisor - 1n) / divisor;
}

/**
 * The shares a sell must burn for the seller to net `net` wei: `FeeMath.grossFromNet`, then
 * `MarketMath.calcSellShares`, rounded exactly as the contract rounds them. Null when the pool
 * cannot pay that much out at all - the contract's `InsufficientLiquidity`.
 */
export function sellCost(reserves: readonly bigint[], outcomeIndex: number, net: bigint, feeBps: bigint): bigint | null
{
    const gross = ceilDiv(net * BPS, BPS - feeBps);
    const own = reserves[outcomeIndex] ?? 0n;
    let end = own;
    for (const [index, reserve] of reserves.entries())
    {
        if (index === outcomeIndex)
        {
            continue;
        }
        if (reserve <= gross)
        {
            return null;
        }
        end = ceilDiv(end * reserve, reserve - gross);
    }
    return end + gross - own;
}

/**
 * The most a sell of `shares` can net. The contract takes the AMOUNT and burns whatever it
 * costs, while a seller thinks in shares; the cost only grows with the amount, so the largest
 * amount that still fits inside the shares is found by bisection over {@link sellCost}.
 */
export function sellReturn(reserves: readonly bigint[], outcomeIndex: number, shares: bigint, feeBps: bigint): bigint
{
    let low = 0n;
    // The gross has to stay under every OTHER reserve, and the net is below the gross.
    let high = reserves.reduce<bigint>(
        (least, reserve, index) => (index !== outcomeIndex && (least < 0n || reserve < least) ? reserve : least),
        -1n
    );
    while (low < high)
    {
        const mid = (low + high + 1n) / 2n;
        const cost = sellCost(reserves, outcomeIndex, mid, feeBps);
        if (cost !== null && cost <= shares)
        {
            low = mid;
        }
        else
        {
            high = mid - 1n;
        }
    }
    return low;
}

/** What a sell is priced from: the pool as it stands, the market's fee, and the seller's shares. */
export async function sellState(
    market: Address,
    outcomeIndex: number,
    account: string
): Promise<{ reserves: bigint[]; feeBps: bigint; held: bigint }>
{
    const read = (functionName: string, args: unknown[] = []): Promise<unknown> =>
        publicClient.readContract({ address: market, abi: marketAbi, functionName, args });
    const [reserves, feeBps, held] = await Promise.all([
        read('getReserves'),
        read('feeBps'),
        read('balanceOf', [account, BigInt(outcomeIndex)])
    ]);
    return { reserves: [...(reserves as bigint[])], feeBps: BigInt(feeBps as number), held: held as bigint };
}

/**
 * Sells outcome shares back to the pool for native collateral. Priced again from a fresh read
 * rather than from what the ticket last showed. The contract's only guard is a share CEILING,
 * so the amount asked for is exact and a price that moved against the seller may burn up to
 * 1% more shares - never more than they hold.
 * @returns The transaction hash.
 */
export async function sellShares(options: {
    provider: Eip1193Provider | null;
    account: string;
    market: Address;
    outcomeIndex: number;
    shares: bigint;
}): Promise<Hash>
{
    const wallet = await walletFor(options.provider, options.account);
    const state = await sellState(options.market, options.outcomeIndex, options.account);
    const shares = options.shares > state.held ? state.held : options.shares;
    const net = sellReturn(state.reserves, options.outcomeIndex, shares, state.feeBps);
    const slack = shares + (shares * SLIPPAGE_BPS) / 10_000n;
    const deadline = await tradeDeadline();

    return wallet.writeContract({
        address: options.market,
        abi: marketAbi,
        functionName: 'sell',
        args: [BigInt(options.outcomeIndex), net, slack > state.held ? state.held : slack, deadline],
        chain,
        account: options.account as Address
    });
}

/**
 * Buys outcome shares with native collateral, guarded by a slippage floor and a deadline.
 * @returns The transaction hash.
 */
export async function buyShares(options: {
    provider: Eip1193Provider | null;
    account: string;
    market: Address;
    outcomeIndex: number;
    value: bigint;
}): Promise<Hash>
{
    const wallet = await walletFor(options.provider, options.account);
    const quoted = await quoteBuy(options.market, options.outcomeIndex, options.value);
    const minShares = quoted - (quoted * SLIPPAGE_BPS) / 10_000n;
    const deadline = await tradeDeadline();

    return wallet.writeContract({
        address: options.market,
        abi: marketAbi,
        functionName: 'buy',
        args: [BigInt(options.outcomeIndex), minShares, deadline],
        value: options.value,
        chain,
        account: options.account as Address
    });
}

/**
 * Claims a resolved (or cancelled) CPMM market's payout for the connected account.
 * @returns The transaction hash.
 */
export async function claimWinnings(options: {
    provider: Eip1193Provider | null;
    account: string;
    market: Address;
}): Promise<Hash>
{
    const wallet = await walletFor(options.provider, options.account);
    return wallet.writeContract({
        address: options.market,
        abi: marketAbi,
        functionName: 'redeem',
        args: [],
        chain,
        account: options.account as Address
    });
}

/**
 * Places a parimutuel bet (pool market) with native collateral.
 * @returns The transaction hash.
 */
export async function betOnPool(options: {
    provider: Eip1193Provider | null;
    account: string;
    market: Address;
    outcomeIndex: number;
    value: bigint;
}): Promise<Hash>
{
    const wallet = await walletFor(options.provider, options.account);
    return wallet.writeContract({
        address: options.market,
        abi: poolAbi,
        functionName: 'bet',
        args: [BigInt(options.outcomeIndex)],
        value: options.value,
        chain,
        account: options.account as Address
    });
}

/**
 * Claims a resolved pool market's payout (pro-rata prize). Cancelled pools refund stake.
 * @returns The transaction hash.
 */
export async function claimPoolWinnings(options: {
    provider: Eip1193Provider | null;
    account: string;
    market: Address;
}): Promise<Hash>
{
    const wallet = await walletFor(options.provider, options.account);
    return wallet.writeContract({
        address: options.market,
        abi: poolAbi,
        functionName: 'claim',
        args: [],
        chain,
        account: options.account as Address
    });
}

/** Tries CPMM redeem, falls back to pool claim – for callers that don't know the kind. */
export async function claimAnyWinnings(options: {
    provider: Eip1193Provider | null;
    account: string;
    market: Address;
}): Promise<Hash>
{
    try
    {
        return await claimWinnings(options);
    }
    catch
    {
        return claimPoolWinnings(options);
    }
}

/** A market's lifecycle status as the contract reports it. */
export const MarketStatus = {
    Open: 0,
    Resolved: 1,
    Cancelled: 2
} as const;

/**
 * Reads the on-chain claim position for an account: the market's status, the winning outcome,
 * and how many winning shares the account holds.
 * @param market Market address.
 * @param account The account to inspect.
 */
export async function claimPosition(
    market: Address,
    account: string
): Promise<{
    status: number;
    winningOutcome: number | null;
    shares: bigint;
}>
{
    const status = Number(
        await publicClient.readContract({
            address: market,
            abi: marketAbi,
            functionName: 'status'
        })
    );

    if (status !== MarketStatus.Resolved || account === '')
    {
        return { status, winningOutcome: null, shares: 0n };
    }

    const winningOutcome = Number(
        await publicClient.readContract({
            address: market,
            abi: marketAbi,
            functionName: 'winningOutcome'
        })
    );

    const shares = (await publicClient.readContract({
        address: market,
        abi: marketAbi,
        functionName: 'balanceOf',
        args: [account as Address, BigInt(winningOutcome)]
    })) as bigint;

    return { status, winningOutcome, shares };
}

/**
 * Waits for a transaction to be mined.
 * @param hash The transaction hash.
 */
export async function waitForTransaction(hash: Hash): Promise<TransactionReceipt>
{
    return publicClient.waitForTransactionReceipt({ hash });
}
