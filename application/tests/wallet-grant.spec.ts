// The seam every write and every signed admin request passes through. What is pinned here is
// the case the app used to walk straight into: this store still says connected, the WALLET no
// longer agrees, and the first anybody hears of it is a 4100 thrown mid-signature.
import { describe, it, expect, vi } from 'vitest';

import { walletFor, NotConnectedError } from '../src/lib/contracts.ts';
import { providerCode } from '../src/lib/wallet.ts';
import { chainIdHex } from '../src/lib/chain.ts';

const ACCOUNT = '0x430b4409891c6A821c81e92C960c94A80Ef626dc';

/** A wallet that authorizes `granted` and answers the chain it is on. */
function walletStub(granted: string[])
{
    const request = vi.fn(async ({ method }: { method: string }) =>
    {
        if (method === 'eth_accounts')
        {
            return granted;
        }
        if (method === 'eth_requestAccounts')
        {
            // Approving the prompt is what puts the account back in the list.
            granted = [ACCOUNT];
            return granted;
        }
        if (method === 'eth_chainId')
        {
            return chainIdHex;
        }
        throw new Error(`unexpected ${ method }`);
    });
    return { request, calls: (): string[] => request.mock.calls.map((call) => call[0].method) };
}

describe('walletFor', () =>
{
    it('signs straight through when the wallet still holds the grant', async () =>
    {
        const provider = walletStub([ACCOUNT]);
        await walletFor(provider, ACCOUNT);
        // No prompt: an intact grant must not cost the visitor a dialog on every write.
        expect(provider.calls()).not.toContain('eth_requestAccounts');
    });

    it('re-asks for a grant the wallet has forgotten instead of failing mid-write', async () =>
    {
        // What a restarted extension answers: it knows the site, it holds no account for it.
        const provider = walletStub([]);
        const client = await walletFor(provider, ACCOUNT);

        expect(provider.calls()).toContain('eth_requestAccounts');
        expect(client.account?.address).toBe(ACCOUNT);
    });

    it('matches the grant whatever case the wallet answers in', async () =>
    {
        const provider = walletStub([ACCOUNT.toLowerCase()]);
        await walletFor(provider, ACCOUNT);
        expect(provider.calls()).not.toContain('eth_requestAccounts');
    });

    it('gives up when the wallet comes back holding somebody else', async () =>
    {
        const other = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
        const request = vi.fn(async ({ method }: { method: string }) =>
            (method === 'eth_chainId' ? chainIdHex : [other]));

        await expect(walletFor({ request }, ACCOUNT)).rejects.toBeInstanceOf(NotConnectedError);
    });

    it('refuses a write with no provider or no account at all', async () =>
    {
        await expect(walletFor(null, ACCOUNT)).rejects.toBeInstanceOf(NotConnectedError);
        await expect(walletFor(walletStub([ACCOUNT]), '')).rejects.toBeInstanceOf(NotConnectedError);
    });
});

describe('providerCode', () =>
{
    it('finds the code a wrapper buried', () =>
    {
        // viem's shape: its own error class, the provider's rejection underneath.
        const wrapped = Object.assign(new Error('The requested method and/or account has not been authorized by the user.'), {
            cause: Object.assign(new Error('The wallet is locked'), { code: 4100 })
        });
        expect(providerCode(wrapped)).toBe(4100);
    });

    it('reads a code sitting on the thrown value itself', () =>
    {
        expect(providerCode(Object.assign(new Error('declined'), { code: 4001 }))).toBe(4001);
        expect(providerCode(Object.assign(new Error('already open'), { code: -32002 }))).toBe(-32002);
    });

    it('answers null for what carries no code, and never loops forever', () =>
    {
        expect(providerCode(new Error('plain'))).toBeNull();
        expect(providerCode(null)).toBeNull();
        expect(providerCode('a string')).toBeNull();

        const cycle: { code?: number; cause?: unknown } = {};
        cycle.cause = cycle;
        expect(providerCode(cycle)).toBeNull();
    });
});
