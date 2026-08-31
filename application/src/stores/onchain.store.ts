import { createStore, createSignal, type Getter } from 'azerothjs';
import { parseEther, type Address, type TransactionReceipt } from 'viem';

import { client } from '../api.ts';

import { betOnPool, buyShares, claimAnyWinnings, waitForTransaction, NotConnectedError, WrongChainError } from '../lib/contracts.ts';
import { chain } from '../lib/chain.ts';

import { useSession } from './session.store.ts';
import { useToasts } from './toasts.store.ts';
import { useLocale } from './locale.store.ts';

// The write path to the chain. Every on-chain action funnels through here so the pending ->
// confirmed -> failed toast sequence, the in-flight flag the buttons disable on, and the
// error vocabulary are identical everywhere.

/**
 * Waits until the indexer has ingested `blockNumber`, so a refetch right after a confirmed
 * write always sees it. Gives up quietly after ~20s - the data arrives on the next poll.
 */
async function untilIndexed(blockNumber: bigint): Promise<void>
{
    for (let attempt = 0; attempt < 40; attempt++)
    {
        try
        {
            const config = await client.chain.config();
            if (config.lastBlock >= Number(blockNumber))
            {
                return;
            }
        }
        catch
        {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
}

/** What a write is doing right now. `indexing` is confirmed on-chain but not yet readable. */
export type WritePhase = 'idle' | 'signing' | 'mining' | 'indexing';

/** What the UI needs to know about an in-flight transaction. */
export interface OnchainApi
{
    /**
     * True while ANY write is in flight. Only correct for "is the chain busy at all"; a button
     * should ask {@link busy} about its own key instead, or one pause greys out every control
     * in the app - including the ones on other pages.
     */
    pending: Getter<boolean>;

    /**
     * True while the write identified by `key` is in flight. The key is the caller's choice of
     * identity - `pause:12`, `claim:0xabc` - so two buttons on screen can never be confused for
     * each other.
     */
    busy(key: string): boolean;

    /** What the in-flight write is doing, for callers that want to say so. */
    phase: Getter<WritePhase>;

    /** The last submitted transaction hash, or '' when none. */
    lastHash: Getter<string>;

    /**
     * Runs any write through the shared narration: submit toast, mined receipt, revert or
     * rejection explained. Returns the receipt on success, null otherwise.
     * @param send Produces the transaction hash (signs and submits).
     * @param key Identity for {@link busy}; omit for writes nothing needs to track.
     */
    execute(send: () => Promise<`0x${ string }`>, key?: string): Promise<TransactionReceipt | null>;

    /**
     * Reports a failed wallet interaction through the SAME mapping {@link execute} uses -
     * not connected, wrong network, declined (EIP-1193 4001), or a generic failure. For the
     * writes that are not transactions (a signed request), so a decline reads the same
     * wherever it happens instead of every caller inventing its own wording.
     * @param error The thrown value.
     */
    narrate(error: unknown): void;

    /**
     * Buys outcome shares with native collateral (AMM) or places a parimutuel bet (Pool).
     * @param market The market clone address.
     * @param outcomeIndex On-chain outcome index.
     * @param amount Human-readable amount (e.g. 25 for 25 tokens).
     * @returns True when the transaction confirmed.
     */
    buy(market: Address, outcomeIndex: number, amount: number): Promise<boolean>;

    /**
     * Places a parimutuel bet explicitly (Pool markets).
     */
    bet(market: Address, outcomeIndex: number, amount: number): Promise<boolean>;

    /**
     * Redeems a resolved (or voided) market's payout.
     * @param market The market clone address.
     * @returns True when the transaction confirmed.
     */
    claim(market: Address): Promise<boolean>;
}

export const useOnchain = createStore((): OnchainApi =>
{
    const session = useSession();
    const toasts = useToasts();
    const { t } = useLocale();

    const [pending, setPending] = createSignal(false);
    const [phase, setPhase] = createSignal<WritePhase>('idle');
    const [activeKey, setActiveKey] = createSignal('');
    const [lastHash, setLastHash] = createSignal('');

    /**
     * Runs a write, narrating it through the toast channel. Wallet rejections are reported as
     * information, not failure - the visitor chose to decline.
     */
    const run = async (send: () => Promise<`0x${ string }`>, key = ''): Promise<TransactionReceipt | null> =>
    {
        if (pending())
        {
            // A second click while one write is in flight used to return null in silence -
            // indistinguishable from a failure, and with no toast the button simply appeared
            // dead. Say what is actually happening.
            toasts.push('info', t('chain.alreadyPending'), 'clock');
            return null;
        }
        setPending(true);
        setActiveKey(key);
        setPhase('signing');
        try
        {
            const hash = await send();
            setLastHash(hash);
            setPhase('mining');
            toasts.push('info', t('chain.submitted'), 'clock');

            const receipt = await waitForTransaction(hash);
            if (receipt.status === 'success')
            {
                // The write is real from here, but the indexer has NOT caught up, so the app
                // still cannot show it. Saying "confirmed" and then freezing for twenty seconds
                // read as a hang; the indexing phase is named so the UI can say so.
                setPhase('indexing');
                toasts.push('success', t('chain.confirmed'), 'check');
                await untilIndexed(receipt.blockNumber);
                return receipt;
            }
            toasts.push('error', t('chain.reverted'), 'alert');
            return null;
        }
        catch (error)
        {
            toasts.push(...describe(error));
            return null;
        }
        finally
        {
            setPending(false);
            setActiveKey('');
            setPhase('idle');
        }
    };

    /** Maps a thrown error to the toast that explains it. */
    const describe = (error: unknown): ['error' | 'info', string, 'alert' | 'info'] =>
    {
        if (error instanceof NotConnectedError)
        {
            return ['error', t('chain.notConnected'), 'alert'];
        }
        if (error instanceof WrongChainError)
        {
            return ['error', `${ t('chain.wrongNetwork') } ${ chain.name }`, 'alert'];
        }
        // 4001 = EIP-1193 user rejection. It must be looked for down the CAUSE CHAIN, not just
        // on the thrown object: viem wraps a provider error in its own error class, so a plain
        // MetaMask "Reject" arrived here as an unrecognised failure and was reported to the
        // user as "Transaction failed" - blaming the app for the user's own decision.
        if (declined(error))
        {
            return ['info', t('chain.rejected'), 'info'];
        }
        const reason = revertReason(error);
        return ['error', reason === null ? t('chain.failed') : `${ t('chain.failed') }: ${ reason }`, 'alert'];
    };

    /** True when this error, or anything that caused it, is an EIP-1193 user rejection. */
    const declined = (error: unknown): boolean =>
    {
        for (let current: unknown = error, depth = 0; current !== null && current !== undefined && depth < 8; depth++)
        {
            const node = current as { code?: unknown; name?: unknown; cause?: unknown };
            if (node.code === 4001 || node.name === 'UserRejectedRequestError')
            {
                return true;
            }
            current = node.cause;
        }
        return false;
    };

    /** The contract's own revert string, when the chain gave one - far better than "failed". */
    const revertReason = (error: unknown): string | null =>
    {
        for (let current: unknown = error, depth = 0; current !== null && current !== undefined && depth < 8; depth++)
        {
            const node = current as { shortMessage?: unknown; reason?: unknown; cause?: unknown };
            if (typeof node.reason === 'string' && node.reason !== '')
            {
                return node.reason;
            }
            if (typeof node.shortMessage === 'string' && node.shortMessage !== '')
            {
                return node.shortMessage;
            }
            current = node.cause;
        }
        return null;
    };

    return {
        pending,
        busy: (key) => pending() && activeKey() === key,
        phase,
        lastHash,
        execute: run,
        narrate: (error) => toasts.push(...describe(error)),
        buy: async (market, outcomeIndex, amount) => await run(() => buyShares({
            provider: session.provider(),
            account: session.address(),
            market,
            outcomeIndex,
            value: parseEther(String(amount))
        }), `buy:${ market }`) !== null,
        bet: async (market, outcomeIndex, amount) => await run(() => betOnPool({
            provider: session.provider(),
            account: session.address(),
            market,
            outcomeIndex,
            value: parseEther(String(amount))
        }), `bet:${ market }`) !== null,
        claim: async (market) => await run(() => claimAnyWinnings({
            provider: session.provider(),
            account: session.address(),
            market
        }), `claim:${ market }`) !== null
    };
});
