// The referral program's client state: the dashboard for the connected wallet, the code a
// visitor arrived with, and the two signed writes.
//
// Attribution is deliberately a TWO-STEP thing. Opening a `?ref=` link only remembers the
// code in this browser; the wallet is bound to it when the visitor accepts, with a signature.
// Anything less would let one person post another's address against their own campaign and
// take a cut of a stranger's fees, and anything more (auto-signing on connect) would put a
// wallet prompt in front of someone who has not been told what they are agreeing to yet.

import { client, campaignMessage, joinMessage } from '../api.ts';
import type { ReferralDashboard, ReferralInvite } from '../api.ts';
import type { Period } from '../../../server/src/wire.ts';

import { createStore, createSignal, createResource, type Getter, type Resource } from '../lib/reactive.ts';

import { readSetting, writeSetting } from '../lib/storage.ts';
import { walletFor } from '../lib/contracts.ts';

import { useSession } from './session.store.ts';
import { useLocale } from './locale.store.ts';
import { useToasts } from './toasts.store.ts';

import type { Address } from 'viem';

const STORAGE_KEY = 'goman.ref';

/** The query parameter a shared link carries. */
export const REF_PARAM = 'ref';

/**
 * Reads `?ref=CODE` out of the current URL, remembers it, and strips it from the address bar
 * so a reload or a shared screenshot does not carry it further.
 *
 * Called once from `main.tsx` rather than from a component: it has to run before anything
 * renders, and it is a fact about the ENTRY, not about any page.
 */
export function captureRefCode(): void {
    const url = new URL(window.location.href);
    const code = (url.searchParams.get(REF_PARAM) ?? '').trim().toLowerCase();
    if (code === '') {
        return;
    }
    writeSetting(STORAGE_KEY, code);
    url.searchParams.delete(REF_PARAM);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

/** The public link for a code, absolute so it can be pasted anywhere. */
export function referralLink(code: string): string {
    return `${window.location.origin}/?${REF_PARAM}=${encodeURIComponent(code)}`;
}

export interface ReferralsApi {
    /** The connected wallet's program: campaigns, earnings, the people they brought in. */
    dashboard: Resource<ReferralDashboard>;

    /** The window every number on the dashboard is measured over. */
    period: Getter<Period>;
    setPeriod(next: Period): void;

    /** The code this browser arrived with and has not spent yet, or ''. */
    pendingCode: Getter<string>;

    /** Who that pending code belongs to, once the server has been asked. */
    invite: Resource<ReferralInvite>;

    /** Forgets a pending code - the visitor declined, or it turned out to be unusable. */
    dismissInvite(): void;

    /** True while a signed write is in flight; the forms go inert rather than double-post. */
    working: Getter<boolean>;

    /** Creates a campaign for the connected wallet. Returns the new code, or null on failure. */
    createCampaign(name: string): Promise<string | null>;

    /** Binds the connected wallet to the pending code. Returns true when it stuck. */
    join(): Promise<boolean>;
}

export const useReferrals = createStore((): ReferralsApi => {
    const session = useSession();
    const toasts = useToasts();
    const { t } = useLocale();

    const [period, setPeriod] = createSignal<Period>('all');
    const [pendingCode, setPendingCode] = createSignal(readSetting(STORAGE_KEY) ?? '');
    const [working, setWorking] = createSignal(false);
    const [version, setVersion] = createSignal(0);

    const dashboard = createResource(
        () => (session.connected() ? `${session.address()}|${period()}|${version()}` : false),
        () => client.referrals.dashboard({ query: { address: session.address(), period: period() } }),
        { name: 'referrals' }
    );

    // Looked up whether or not a wallet is connected: the point of the card this feeds is to
    // say who invited you BEFORE you decide to connect one.
    const invite = createResource(
        () => (pendingCode() === '' ? false : pendingCode()),
        (code: string) => client.referrals.invite({ params: { code } }),
        { name: 'referral-invite' }
    );

    const forget = (): void => {
        writeSetting(STORAGE_KEY, '');
        setPendingCode('');
    };

    // The timestamp is the caller's, not this helper's: it is INSIDE the message being
    // signed, so generating a second one here would sign one string and send another.
    const signWith = async (message: string): Promise<{ address: string; signature: string }> => {
        const address = session.address();
        const wallet = await walletFor(session.provider(), address);
        const signature = await wallet.signMessage({ account: address as Address, message });
        return { address, signature };
    };

    return {
        dashboard,
        period,
        setPeriod,
        pendingCode,
        invite,
        dismissInvite: forget,
        working,

        createCampaign: async (name) => {
            const trimmed = name.trim();
            if (trimmed === '' || working()) {
                return null;
            }
            setWorking(true);
            try {
                const issuedAt = new Date().toISOString();
                const signed = await signWith(campaignMessage(trimmed, issuedAt));
                const campaign = await client.referrals.createCampaign({
                    input: { name: trimmed, issuedAt, ...signed }
                });
                setVersion(version() + 1);
                toasts.push('success', t('referral.created'), 'check');
                return campaign.code;
            } catch (error) {
                toasts.push('error', error instanceof Error ? error.message : t('referral.failed'), 'alert');
                return null;
            } finally {
                setWorking(false);
            }
        },

        join: async () => {
            const code = pendingCode();
            if (code === '' || working()) {
                return false;
            }
            setWorking(true);
            try {
                const issuedAt = new Date().toISOString();
                const signed = await signWith(joinMessage(code, issuedAt));
                await client.referrals.join({ input: { code, issuedAt, ...signed } });
                // Spent, not merely used: a code that has bound this wallet must never bind
                // another one on the same browser.
                forget();
                setVersion(version() + 1);
                toasts.push('success', t('referral.joined'), 'check');
                return true;
            } catch (error) {
                toasts.push('error', error instanceof Error ? error.message : t('referral.failed'), 'alert');
                return false;
            } finally {
                setWorking(false);
            }
        }
    };
});
