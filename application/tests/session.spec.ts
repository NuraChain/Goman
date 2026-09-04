// The wallet session over EIP-6963/EIP-1193: discovery by announce event, real account
// adoption, honest failure when no provider is injected. The contract pinned here is what
// the chrome, the dashboard gate, and the trade ticket all read.
import { describe, it, expect, vi } from 'vitest';

import { shortAddress, addressGradient } from '../src/lib/wallet.ts';

const ADDRESS = '0x430b4409891c6A821c81e92C960c94A80Ef626dc';

describe('session identity helpers', () => {
    it('shortens an address to the 0x prefix and tail', () => {
        expect(shortAddress(ADDRESS)).toBe('0x430b...26dc');
    });

    it('the identicon gradient is deterministic per address', () => {
        expect(addressGradient(ADDRESS)).toBe(addressGradient(ADDRESS));
        expect(addressGradient(ADDRESS)).toContain('linear-gradient');
        expect(addressGradient('0xAbCd000000000000000000000000000000009999')).not.toBe(addressGradient(ADDRESS));
    });
});

describe('session store', () => {
    it("adopts the announced provider's real account and disconnects clean", async () => {
        // The store's discovery listens on `window`; a bare EventTarget is enough.
        vi.stubGlobal('window', new EventTarget());
        const { useSession } = await import('../src/stores/session.store.ts');

        {
            const session = useSession.peek();
            expect(session.connected()).toBe(false);
            expect(session.address()).toBe('');

            const request = vi.fn(async ({ method }: { method: string }) =>
                method === 'eth_requestAccounts' ? [ADDRESS] : []
            );
            const announce = (info: { rdns: string; name: string; icon: string }): void => {
                window.dispatchEvent(
                    new CustomEvent('eip6963:announceProvider', {
                        detail: { info, provider: { request, on: vi.fn() } }
                    })
                );
            };
            announce({ rdns: 'io.metamask', name: 'MetaMask', icon: 'data:image/svg+xml;base64,AA' });
            // A wallet we ship no vector for is admitted all the same - a fixed brand list is
            // what told someone with Frame or Zerion installed that they had no wallet.
            announce({ rdns: 'sh.frame', name: 'Frame', icon: 'data:image/svg+xml;base64,BB' });

            expect(session.wallets().map((entry) => entry.rdns)).toEqual(['io.metamask', 'sh.frame']);
            expect(session.wallets().find((entry) => entry.rdns === 'sh.frame')?.brand).toBeNull();
            expect(session.wallets().find((entry) => entry.rdns === 'io.metamask')?.brand).toBe('metamask');

            expect(session.provider()).toBeNull();

            await session.connect('io.metamask');
            expect(request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
            expect(session.connected()).toBe(true);
            expect(session.wallet()).toBe('MetaMask');
            expect(session.address()).toBe(ADDRESS);

            // The contract layer transacts through this provider; it must be the announced one.
            expect(session.provider()?.request).toBe(request);

            session.disconnect();
            expect(session.connected()).toBe(false);
            expect(session.address()).toBe('');
            expect(session.provider()).toBeNull();

            await session.connect('sh.frame');
            expect(session.wallet()).toBe('Frame');
            session.disconnect();
        }
        vi.unstubAllGlobals();
    });

    it('a wallet with no injected provider fails loudly, never silently pretends', async () => {
        const { useSession, WalletUnavailableError } = await import('../src/stores/session.store.ts');

        {
            const session = useSession.peek();
            await expect(session.connect('com.example.absent')).rejects.toBeInstanceOf(WalletUnavailableError);
            expect(session.connected()).toBe(false);
        }
    });
});
