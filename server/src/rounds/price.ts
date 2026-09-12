import { createHash, createHmac } from 'node:crypto';
import { decodeAbiParameters, parseAbiParameters } from 'viem';

import type { Logger } from '../logger.ts';
import type { TwapPrice } from '../wire.ts';

// The TWAP the rounds engine settles on: Chainlink's BTC/USD 60-second time-weighted average.
//
// TWO routes to the same number, because they trade off differently and the deployment should
// not have to choose once and live with it:
//
//   Data Streams   the source of record. Reports are signed by the DON, so the price is
//                  verifiable rather than merely received - but it needs credentials, and its
//                  onchain verifier is not deployed on this chain, so the signature is checked
//                  HERE and archived, not on chain.
//   RTDS           Polymarket's public relay of the same Chainlink stream. No credentials, so
//                  it works out of the box - at the cost of trusting the relay's word for it.
//
// Data Streams wins whenever it is configured and fresh; the relay covers its gaps and its
// absence. A settlement never reads a stale observation: `latest()` returns null instead, and
// the engine leaves the round alone rather than answering it from an old price.

/** Beyond this, an observation is history rather than a price. */
const STALE_MS = 30_000;

/** Reconnect backoff for the relay socket, in milliseconds. */
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

/** The relay's application-level heartbeat interval; it drops a socket that stops sending. */
const PING_MS = 5_000;

export interface PriceSource {
    readonly name: string;
    start(): void;
    stop(): void;

    /** The freshest observation, or null when there is none recent enough to settle on. */
    latest(): TwapPrice | null;
}

export interface PriceEnv {
    /** Lowercase, slash-delimited: `btc/usd`. Both routes spell it this way. */
    symbol: string;

    /** The averaging window in seconds. 60 pairs with the stream the engine reads. */
    windowSeconds: number;

    /** Data Streams API key (a UUID). Empty disables that route. */
    apiKey: string;
    apiSecret: string;

    /** The hex feed id from the stream's page on data.chain.link. Empty disables the route. */
    feedId: string;
    apiUrl: string;
    relayUrl: string;
}

/** True while an observation is recent enough to decide a round. */
function fresh(price: TwapPrice | null, now: number): boolean {
    return price !== null && now - Date.parse(price.at) < STALE_MS;
}

// ----------------------------------------------------------------------------------------
// Polymarket RTDS - the credential-free relay
// ----------------------------------------------------------------------------------------

/** The relay's topic per averaging window; anything else has no topic and cannot be read. */
const RELAY_TOPICS: Record<number, string> = {
    30: 'crypto_prices_twap_thirty',
    60: 'crypto_prices_twap_sixty'
};

interface RelayMessage {
    topic?: string;
    payload?: { symbol?: string; value?: number; timestamp?: number; window_s?: number };
}

/**
 * The relay half. One socket, resubscribed on every reconnect, with the heartbeat the relay
 * requires - a socket that stops pinging is dropped, and a dropped socket that nobody notices
 * is a price that silently stops moving.
 */
export function relaySource(env: PriceEnv, log: Logger): PriceSource {
    const topic = RELAY_TOPICS[env.windowSeconds];
    let socket: WebSocket | null = null;
    let heartbeat: NodeJS.Timeout | null = null;
    let retry: NodeJS.Timeout | null = null;
    let backoff = BACKOFF_MIN_MS;
    let running = false;
    let last: TwapPrice | null = null;

    const clearTimers = (): void => {
        if (heartbeat !== null) {
            clearInterval(heartbeat);
            heartbeat = null;
        }
        if (retry !== null) {
            clearTimeout(retry);
            retry = null;
        }
    };

    const reconnect = (): void => {
        if (!running || retry !== null) {
            return;
        }
        retry = setTimeout(() => {
            retry = null;
            connect();
        }, backoff);
        backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    };

    const connect = (): void => {
        if (!running) {
            return;
        }
        const live = new WebSocket(env.relayUrl);
        socket = live;

        live.addEventListener('open', () => {
            backoff = BACKOFF_MIN_MS;
            live.send(
                JSON.stringify({
                    action: 'subscribe',
                    subscriptions: [{ topic, type: 'update', filters: JSON.stringify({ symbol: env.symbol }) }]
                })
            );
            // A text frame, not a protocol ping: the relay checks for the literal word.
            heartbeat = setInterval(() => {
                if (live.readyState === WebSocket.OPEN) {
                    live.send('PING');
                }
            }, PING_MS);
        });

        live.addEventListener('message', (event: MessageEvent) => {
            if (typeof event.data !== 'string' || !event.data.startsWith('{')) {
                return;
            }
            let message: RelayMessage;
            try {
                message = JSON.parse(event.data) as RelayMessage;
            } catch {
                return;
            }
            const payload = message.payload;
            if (message.topic !== topic || payload?.symbol !== env.symbol || typeof payload.value !== 'number') {
                return;
            }
            last = {
                symbol: env.symbol,
                value: payload.value,
                windowSeconds: payload.window_s ?? env.windowSeconds,
                at: new Date(payload.timestamp ?? Date.now()).toISOString(),
                source: 'polymarket-rtds'
            };
        });

        const drop = (why: string): void => {
            if (socket !== live) {
                return;
            }
            clearTimers();
            socket = null;
            log.warn('twap relay disconnected', { why });
            reconnect();
        };
        live.addEventListener('close', () => drop('close'));
        live.addEventListener('error', () => drop('error'));
    };

    return {
        name: 'polymarket-rtds',
        start: () => {
            if (running) {
                return;
            }
            if (topic === undefined) {
                log.warn('twap relay has no topic for this window', { windowSeconds: env.windowSeconds });
                return;
            }
            running = true;
            connect();
        },
        stop: () => {
            running = false;
            clearTimers();
            socket?.close();
            socket = null;
        },
        latest: () => last
    };
}

// ----------------------------------------------------------------------------------------
// Chainlink Data Streams - the signed route
// ----------------------------------------------------------------------------------------

/** How often the engine asks the API for a fresh report. */
const POLL_MS = 2_000;

/**
 * The schema versions this decoder understands, keyed by the version the feed id carries in its
 * first two bytes. Both begin with the same seven fields, so `price` sits at the same index;
 * they are still listed separately because ABI decoding is positional and a v3 blob decoded as
 * a v2 tuple does not merely misread, it throws.
 */
const REPORT_SCHEMAS: Record<number, string> = {
    2: 'bytes32 feedId, uint32 validFromTimestamp, uint32 observationsTimestamp, uint192 nativeFee, uint192 linkFee, uint32 expiresAt, int192 price',
    3: 'bytes32 feedId, uint32 validFromTimestamp, uint32 observationsTimestamp, uint192 nativeFee, uint192 linkFee, uint32 expiresAt, int192 price, int192 bid, int192 ask'
};

/** The envelope every report ships in: context, the blob, and the DON's signatures. */
const REPORT_ENVELOPE = 'bytes32[3] reportContext, bytes reportBlob, bytes32[] rs, bytes32[] ss, bytes32 rawVs';

/** Data Streams prices carry 18 decimals, as the onchain verifier reports them. */
const PRICE_DECIMALS = 10n ** 18n;

/**
 * The signature the API expects: `METHOD PATH SHA256(body) KEY TIMESTAMP`, HMAC-SHA256 under the
 * shared secret. The body hash is the hash of the EMPTY string for a GET, not an empty field.
 */
function authHeaders(env: PriceEnv, method: string, path: string, at: number): Record<string, string> {
    const bodyHash = createHash('sha256').update('').digest('hex');
    const signature = createHmac('sha256', env.apiSecret)
        .update(`${method} ${path} ${bodyHash} ${env.apiKey} ${at}`)
        .digest('hex');
    return {
        Authorization: env.apiKey,
        'X-Authorization-Timestamp': String(at),
        'X-Authorization-Signature-SHA256': signature
    };
}

/** Reads the price out of a `fullReport` hex blob. Throws on a schema this build cannot read. */
export function decodeReport(fullReport: string): { price: number; observedAt: number } {
    const [, blob] = decodeAbiParameters(parseAbiParameters(REPORT_ENVELOPE), fullReport as `0x${string}`);
    // The first two bytes of the feed id ARE the schema version - there is no version field.
    const version = Number.parseInt(blob.slice(2, 6), 16);
    const schema = REPORT_SCHEMAS[version];
    if (schema === undefined) {
        throw new Error(`Unsupported Data Streams report schema v${version}`);
    }
    const fields = decodeAbiParameters(parseAbiParameters(schema), blob);
    const observationsTimestamp = fields[2] as number;
    const price = fields[6] as bigint;
    return {
        // Through Number only at the end: the raw value is 18-decimal fixed point, and a float
        // divide of an already-lossy float would round the cents off a five-figure price.
        price: Number((price * 1_000_000n) / PRICE_DECIMALS) / 1_000_000,
        observedAt: observationsTimestamp * 1000
    };
}

/** The Data Streams half. Polls the latest report for one feed and decodes it. */
export function dataStreamsSource(env: PriceEnv, log: Logger): PriceSource {
    let timer: NodeJS.Timeout | null = null;
    let running = false;
    let last: TwapPrice | null = null;
    let complained = false;

    const poll = async (): Promise<void> => {
        const path = `/api/v1/reports/latest?feedID=${env.feedId}`;
        const at = Date.now();
        const response = await fetch(`${env.apiUrl}${path}`, { headers: authHeaders(env, 'GET', path, at) });
        if (!response.ok) {
            throw new Error(`Data Streams answered ${response.status}`);
        }
        const body = (await response.json()) as { report?: { fullReport?: string } };
        const fullReport = body.report?.fullReport;
        if (fullReport === undefined) {
            throw new Error('Data Streams returned no report');
        }
        const { price, observedAt } = decodeReport(fullReport);
        last = {
            symbol: env.symbol,
            value: price,
            windowSeconds: env.windowSeconds,
            at: new Date(observedAt).toISOString(),
            source: 'chainlink-data-streams'
        };
        complained = false;
    };

    const loop = async (): Promise<void> => {
        while (running) {
            try {
                await poll();
            } catch (error) {
                // Once per outage, not once per poll: this runs every two seconds, and a wrong
                // API key would otherwise write a log line 43,000 times a day.
                if (!complained) {
                    complained = true;
                    log.warn('twap data streams read failed', { error: String(error) });
                }
            }
            await new Promise((resolve) => {
                timer = setTimeout(resolve, POLL_MS);
            });
        }
    };

    return {
        name: 'chainlink-data-streams',
        start: () => {
            if (running) {
                return;
            }
            running = true;
            void loop();
        },
        stop: () => {
            running = false;
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
        },
        latest: () => last
    };
}

// ----------------------------------------------------------------------------------------
// The composite
// ----------------------------------------------------------------------------------------

/**
 * Both routes at once, in preference order. The signed one answers whenever it is configured
 * and current; the relay covers the gap while it reconnects, and covers the whole job in a
 * deployment that has no Data Streams credentials yet.
 */
export function createPriceSource(env: PriceEnv, log: Logger): PriceSource {
    const sources: PriceSource[] = [];
    if (env.apiKey !== '' && env.apiSecret !== '' && env.feedId !== '') {
        sources.push(dataStreamsSource(env, log));
    }
    sources.push(relaySource(env, log));

    return {
        name: sources.map((source) => source.name).join('+'),
        start: () => {
            for (const source of sources) {
                source.start();
            }
        },
        stop: () => {
            for (const source of sources) {
                source.stop();
            }
        },
        latest: () => {
            const now = Date.now();
            for (const source of sources) {
                const price = source.latest();
                if (fresh(price, now)) {
                    return price;
                }
            }
            return null;
        }
    };
}

/** Reads the price environment; call after `process.loadEnvFile()`. */
export function loadPriceEnv(read: (name: string, fallback: string) => string): PriceEnv {
    return {
        symbol: read('ROUNDS_SYMBOL', 'btc/usd'),
        windowSeconds: Number(read('ROUNDS_TWAP_WINDOW', '60')),
        apiKey: read('DATA_STREAMS_API_KEY', ''),
        apiSecret: read('DATA_STREAMS_API_SECRET', ''),
        feedId: read('DATA_STREAMS_FEED_ID', ''),
        apiUrl: read('DATA_STREAMS_API_URL', 'https://api.dataengine.chain.link'),
        relayUrl: read('ROUNDS_RELAY_URL', 'wss://ws-live-data.polymarket.com')
    };
}
