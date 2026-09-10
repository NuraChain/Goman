// What the connect sheet TELLS the visitor when a wallet refuses. The mapping matters more
// than it looks: every unmapped rejection collapses into one generic line, and a rejection
// that opens no approval window leaves the visitor with a dead button and no reason for it.
//
// 4100 is the case that actually shipped broken. Nura Wallet answers `eth_requestAccounts`
// with EIP-1193 4100 the instant its vault is locked - no prompt is ever shown - so the
// chain's own wallet looked simply broken until this branch existed.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import { AppFrame } from '../src/app.tsx';
import { en } from '../src/i18n/en.ts';
import { useToasts } from '../src/stores/toasts.store.ts';

// The stores are app singletons that outlive `cleanup()`, and discovery keeps the FIRST
// provider announced under an rdns - so each case has to announce a wallet of its own.
let seq = 0;

function mount(): ReturnType<typeof render> {
    return render(
        <MemoryRouter initialEntries={['/']}>
            <AppFrame />
        </MemoryRouter>
    );
}

function byText(container: Element, selector: string, text: string): HTMLElement {
    const match = [...container.querySelectorAll<HTMLElement>(selector)].find((node) =>
        node.textContent?.includes(text)
    );
    if (match === undefined) {
        throw new Error(`no ${selector} containing "${text}"`);
    }
    return match;
}

/**
 * Announces a wallet that fails with `code`, then connects to it the way a visitor does -
 * the header button, then the row in the sheet. Resolves once the rejection has been handled.
 */
async function connectFailing(container: Element, code: number): Promise<void> {
    seq += 1;
    const name = `Wallet ${seq}`;
    const provider = {
        request: () => Promise.reject(Object.assign(new Error('refused'), { code })),
        on: () => undefined
    };
    act(() => {
        window.dispatchEvent(
            new CustomEvent('eip6963:announceProvider', {
                detail: { info: { rdns: `test.wallet.${seq}`, name, icon: '' }, provider }
            })
        );
    });

    fireEvent.click(byText(container, 'header button', en.nav.connect));
    const row = await waitFor(() => byText(container, '[role="dialog"] button', name));
    await act(async () => {
        fireEvent.click(row);
    });
}

/** The messages currently on screen, newest last. */
function toasts(): string[] {
    return useToasts
        .peek()
        .items()
        .map((entry) => entry.message);
}

beforeEach(() => {
    const store = useToasts.peek();
    for (const entry of [...store.items()]) {
        store.dismiss(entry.id);
    }
});

describe('connect sheet failures', () => {
    it('tells the visitor to UNLOCK when the wallet rejects with 4100', async () => {
        const { container } = mount();
        await connectFailing(container, 4100);

        // The old behaviour: a connect that never sent anything reported a failed transaction.
        expect(toasts()).toEqual([en.auth.locked]);
        // Unlocking and pressing the same row again is the fix, so the sheet must survive.
        expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    });

    it('names an unreachable wallet bridge rather than blaming a transaction', async () => {
        const { container } = mount();
        await connectFailing(container, 4900);

        expect(toasts()).toEqual([en.auth.offline]);
    });

    it('falls back to connect copy, never transaction copy, on an unknown code', async () => {
        const { container } = mount();
        await connectFailing(container, -32603);

        expect(toasts()).toEqual([en.auth.failed]);
        expect(en.auth.failed).not.toBe(en.chain.failed);
    });

    it('still reports a decline as a decline, and a queued prompt as pending', async () => {
        const { container } = mount();
        await connectFailing(container, 4001);
        await connectFailing(container, -32002);

        expect(toasts()).toEqual([en.auth.rejected, en.auth.pending]);
    });
});
