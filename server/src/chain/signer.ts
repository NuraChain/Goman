import {
    createWalletClient,
    defineChain,
    http,
    type Address,
    type Hash,
    type PublicClient,
    type WalletClient
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { factoryAbi, type ChainEnv } from './client.ts';

// The ONLY place this server signs anything. Everywhere else it is a reader: markets are
// deployed, paused and resolved from an admin's own wallet in the browser. One job cannot work
// that way, because it comes due at an hour nobody is watching - a scheduled market has to
// come off pause the moment its start time arrives.
//
// It should be a key of its OWN, not the factory owner's: this one lives in a file on a server
// and needs only ADMIN_ROLE. Losing it costs the scheduled openings, which an admin can do by
// hand; losing the owner key costs the factory and the treasury.

/** Transaction receipts are waited for; beyond this the job gives up and retries next tick. */
const RECEIPT_TIMEOUT_MS = 120_000;

export interface JobSigner {
    readonly account: Address;

    /** Resumes a paused market: what a scheduled start time actually does when it arrives. */
    unpause(marketId: number): Promise<Hash>;
}

/**
 * Serialises every write through one promise chain. Two transactions signed in the same tick
 * would be handed the same nonce - viem reads it from the chain, and the chain does not know
 * about a transaction that has not landed yet.
 */
function serialiser(): (job: () => Promise<unknown>) => Promise<unknown> {
    let tail: Promise<unknown> = Promise.resolve();
    return (job) => {
        const next = tail.then(job, job);
        tail = next.catch(() => undefined);
        return next;
    };
}

/**
 * Builds the job signer.
 * @param env The chain environment the reader already loaded.
 * @param privateKey The job key, `0x`-prefixed.
 * @param client The public client used to wait for receipts.
 */
export function createSigner(env: ChainEnv, privateKey: string, client: PublicClient): JobSigner {
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const chain = defineChain({
        id: env.chainId,
        name: 'chain',
        nativeCurrency: { name: 'Native', symbol: 'NATIVE', decimals: 18 },
        rpcUrls: { default: { http: [env.rpcUrl] } }
    });
    const wallet: WalletClient = createWalletClient({ account, chain, transport: http(env.rpcUrl) });
    const queue = serialiser();

    const write = (functionName: string, args: unknown[]): Promise<Hash> =>
        queue(() =>
            wallet.writeContract({ address: env.factory, abi: factoryAbi, functionName, args, chain, account })
        ) as Promise<Hash>;

    const settle = async (hash: Hash): Promise<void> => {
        const receipt = await client.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
        if (receipt.status !== 'success') {
            throw new Error(`Transaction ${hash} reverted`);
        }
    };

    return {
        account: account.address,

        unpause: async (marketId) => {
            const hash = await write('unpauseMarket', [BigInt(marketId)]);
            await settle(hash);
            return hash;
        }
    };
}
