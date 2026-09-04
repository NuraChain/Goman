// Admin access: one signature, one cookie.
//
// The credential is the wallet that holds the on-chain admin role - there is no password
// here and no second factor. Signing in proves two things once: that the caller controls
// the address (a signature over a timestamped nonce), and that the address IS an admin
// on-chain. After that the browser holds an opaque session id, so the console can READ
// admin data without a wallet prompt on every page load.
//
// What the shape buys, spelled out:
//   - the session id is opaque and HttpOnly, so no script on the page can read it and no
//     history entry or log line contains a credential;
//   - a stolen id expires on its own, and `signOutAll` ends every session at once (used
//     when an address loses its role);
//   - sign-in attempts are locked out per IP, so a stolen signature cannot be replayed
//     indefinitely against the nonce window.
//
// Mutations keep their own fresh per-request signature ON TOP of the session: reading the
// console is a session-level act, changing the market is a wallet-level one.
import { fastifyCookie } from '@fastify/cookie';

// The plugin's own cookie serialiser, so the Set-Cookie this module writes is spelled exactly
// the way the one @fastify/cookie parses on the way back in.
const serializeCookie = fastifyCookie.serialize;

import { TooManyRequestsError, UnauthorizedError } from './http-errors.ts';

/**
 * The only two things this module needs off a request. Declared structurally rather than as
 * `FastifyRequest` so the session store stays testable with a plain object literal - and so
 * the cookie/IP plumbing is the ONLY coupling to the web framework in here.
 */
export interface SessionRequest {
    ip: string;
    cookies: Record<string, string | undefined>;
}

const COOKIE = 'ah_admin';
const SESSION_MS = 8 * 60 * 60 * 1000;
const ATTEMPT_LIMIT = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

export interface AdminSessionOptions {
    /**
     * Proves the signed nonce came from an address that holds the on-chain admin role.
     * Owned by the app, which already knows how to verify a signature and read the role,
     * so this file never touches the chain or a key.
     */
    verify(address: string, message: string, signature: string): Promise<boolean>;

    /** Adds `Secure` to the session cookie; on in production, off on a local http origin. */
    secureCookie: boolean;
}

export interface AdminSession {
    /** Verifies the signature and returns a `Set-Cookie` value, or throws. */
    signIn(request: SessionRequest, address: string, message: string, signature: string): Promise<string>;

    /** Invalidates the caller's session and returns the cookie that clears it. */
    signOut(request: SessionRequest): string;

    /** Ends EVERY session - an address that lost its role must not stay signed in. */
    signOutAll(): void;

    /** Throws {@link UnauthorizedError} unless the request carries a live session. */
    require(request: SessionRequest): { adminAddress: string };
}

/**
 * @internal The lockout bucket, keyed WITHOUT trustProxy: a forwarding header is
 * attacker-controlled, and honouring one would let a single machine reset its own counter.
 */
function attemptKey(request: SessionRequest): string {
    return request.ip;
}

/** Builds the session store. In-memory by design: a restart signs everyone out. */
export function createAdminSession(options: AdminSessionOptions): AdminSession {
    const sessions = new Map<string, { address: string; expiresAt: number }>();
    const attempts = new Map<string, { count: number; until: number }>();
    let nextSweep = 0;

    // Expiry is swept lazily rather than on a timer: a server with no admin traffic
    // should not hold a process-keeping interval open.
    function sweep(now: number): void {
        if (now < nextSweep) {
            return;
        }
        nextSweep = now + SWEEP_INTERVAL_MS;
        for (const [id, session] of sessions) {
            if (session.expiresAt <= now) {
                sessions.delete(id);
            }
        }
        for (const [bucket, record] of attempts) {
            if (record.until <= now) {
                attempts.delete(bucket);
            }
        }
    }

    return {
        async signIn(request, address, message, signature) {
            const now = Date.now();
            const bucketKey = attemptKey(request);
            const bucket = attempts.get(bucketKey);
            if (bucket !== undefined && bucket.until > now && bucket.count >= ATTEMPT_LIMIT) {
                throw new TooManyRequestsError(Math.ceil((bucket.until - now) / 1000));
            }

            sweep(now);

            if (!(await options.verify(address, message, signature))) {
                const next =
                    bucket !== undefined && bucket.until > now
                        ? { count: bucket.count + 1, until: bucket.until }
                        : { count: 1, until: now + ATTEMPT_WINDOW_MS };
                attempts.set(bucketKey, next);
                // One message for every failure. Naming which half was wrong - the
                // signature or the role - tells an attacker which address to hunt.
                throw new UnauthorizedError('Not an admin');
            }

            attempts.delete(bucketKey);

            const id = crypto.randomUUID();
            sessions.set(id, { address: address.toLowerCase(), expiresAt: now + SESSION_MS });
            return serializeCookie(COOKIE, id, {
                httpOnly: true,
                sameSite: 'strict',
                secure: options.secureCookie,
                path: '/',
                maxAge: Math.floor(SESSION_MS / 1000)
            });
        },

        signOut(request) {
            const id = request.cookies[COOKIE];
            if (id !== undefined) {
                sessions.delete(id);
            }
            return serializeCookie(COOKIE, '', {
                path: '/',
                secure: options.secureCookie,
                httpOnly: true,
                sameSite: 'strict',
                expires: new Date(0),
                maxAge: 0
            });
        },

        signOutAll() {
            sessions.clear();
        },

        require(request) {
            const now = Date.now();
            sweep(now);
            const id = request.cookies[COOKIE];
            const session = id === undefined ? undefined : sessions.get(id);
            if (session === undefined || session.expiresAt <= now) {
                throw new UnauthorizedError('Admin session required');
            }
            return { adminAddress: session.address };
        }
    };
}
