// The Telegram bot: the archive, the message text, and the pacing.
//
// None of it talks to Telegram here. What is worth testing is what would be silently wrong in
// production and never noticed: an archive nothing can open, a market title that breaks the
// markup for every unrelated event sharing its batch, and a first catch-up that would arrive
// as thousands of messages about markets that resolved months ago.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { createLogger } from '@azerothjs/logger';
import { IndexStore, type MarketRow, type OutcomeRow } from '../src/chain/store.ts';
import type { IndexedEvent } from '../src/chain/indexer.ts';
import type { TelegramBot } from '../src/telegram/bot.ts';
import { makeBackup } from '../src/telegram/backup.ts';
import { fits, tar } from '../src/telegram/tar.ts';
import { lineFor } from '../src/telegram/format.ts';
import { createTelegramService } from '../src/telegram/service.ts';

const log = createLogger({ level: 'silent' });

const ZERO = '0x0000000000000000000000000000000000000000';
const ALICE = '0x4ac0d9300422b408bA2AbF47995C87cF32763712';
const BOB = '0xAd377aeE419aBdf7874b80CF7d945Aa7882012Ab';

function marketRow(id: number, title: string): MarketRow
{
    return {
        id,
        address: `0x${ String(id + 1).padStart(40, '0') }`,
        status: 0,
        category: 'crypto',
        title_json: JSON.stringify({ en: title }),
        emoji: '₿',
        rules_json: JSON.stringify({ en: 'rules' }),
        image: '',
        creator: '0xcafe',
        created_at: 1000,
        lock_time: 5000,
        resolve_time: 9000,
        outcome_count: 2,
        volume: 0,
        liquidity: 0,
        collected: 0,
        winning_outcome: null,
        featured: 0,
        search_text: title.toLowerCase(),
        kind: 0
    };
}

function yesNo(marketId: number): OutcomeRow[]
{
    return ['Yes', 'No'].map((label, idx) => ({
        market_id: marketId,
        idx,
        oid: label.toLowerCase(),
        label_json: JSON.stringify({ en: label }),
        icon: '',
        price: 0.5
    }));
}

function event(name: string, args: Record<string, unknown>): IndexedEvent
{
    return { event: name, marketId: 1, address: '0xmarket', tx: '0xtx', at: 1000, args };
}

/** A bot that records instead of sending. */
function fakeBot(): TelegramBot & {
    lines: string[];
    documents: Array<{ name: string; size: number }>;
    replies: Array<{ chatId: string; text: string }>;
}
{
    const state = {
        lines: [] as string[],
        documents: [] as Array<{ name: string; size: number }>,
        replies: [] as Array<{ chatId: string; text: string }>,
        say: (line: string) =>
        {
            state.lines.push(line);
        },
        reply: async (chatId: string, text: string) =>
        {
            state.replies.push({ chatId, text });
            return true;
        },
        sendDocument: async (file: { name: string; bytes: Uint8Array }) =>
        {
            state.documents.push({ name: file.name, size: file.bytes.length });
            return true;
        },
        listen: () => undefined,
        name: () => 'goman_test_bot',
        stop: () => undefined
    };
    return state;
}

/** Reads names and sizes back out of a tar, so "valid archive" is an assertion, not a hope. */
function listTar(bytes: Uint8Array): Array<{ name: string; size: number }>
{
    const decoder = new TextDecoder();
    const out: Array<{ name: string; size: number }> = [];
    let offset = 0;
    while (offset + 512 <= bytes.length)
    {
        const header = bytes.subarray(offset, offset + 512);
        const name = decoder.decode(header.subarray(0, 100)).replace(/\0.*$/, '');
        if (name === '')
        {
            break;
        }
        const prefix = decoder.decode(header.subarray(345, 500)).replace(/\0.*$/, '');
        const size = parseInt(decoder.decode(header.subarray(124, 136)).replace(/\0.*$/, '').trim(), 8);

        // The checksum is the whole point of the format: a header that does not add up is a
        // header no tar implementation will read.
        const stated = parseInt(decoder.decode(header.subarray(148, 156)).replace(/\0.*$/, '').trim(), 8);
        let sum = 0;
        header.forEach((byte, index) =>
        {
            sum += index >= 148 && index < 156 ? 32 : byte;
        });
        expect(sum).toBe(stated);

        out.push({ name: prefix === '' ? name : `${ prefix }/${ name }`, size });
        offset += 512 + Math.ceil(size / 512) * 512;
    }
    return out;
}

describe('the backup archive', () =>
{
    let store: IndexStore;
    let uploads: string;

    beforeEach(() =>
    {
        store = new IndexStore(':memory:');
        store.insertMarket(marketRow(1, 'Will BTC hit 100k?'), yesNo(1));
        uploads = mkdtempSync(join(tmpdir(), 'goman-test-uploads-'));
    });

    afterEach(() =>
    {
        store.close();
        rmSync(uploads, { recursive: true, force: true });
    });

    it('carries the database and every upload, in a tar anything can read', async () =>
    {
        mkdirSync(join(uploads, 'nested'), { recursive: true });
        writeFileSync(join(uploads, 'one.png'), Buffer.from('first image'));
        writeFileSync(join(uploads, 'nested', 'two.png'), Buffer.from('second'));

        const archive = await makeBackup({ store, uploadDir: uploads, log });
        const entries = listTar(gunzipSync(archive?.bytes as Uint8Array));

        expect(entries.map((entry) => entry.name).sort()).toEqual([
            'index.db',
            'uploads/nested/two.png',
            'uploads/one.png'
        ]);
        expect(entries.find((entry) => entry.name === 'uploads/one.png')?.size).toBe(11);
        expect(archive?.name).toMatch(/^goman-\d{8}-\d{4}\.tar\.gz$/);
    });

    it('snapshots a database that opens - not a copy of a WAL file mid-write', async () =>
    {
        const archive = await makeBackup({ store, uploadDir: uploads, log });
        const database = listTar(gunzipSync(archive?.bytes as Uint8Array)).find((entry) => entry.name === 'index.db');
        expect(database?.size).toBeGreaterThan(0);
        // A second one straight after must not trip over the first one's scratch file.
        expect(await makeBackup({ store, uploadDir: uploads, log })).not.toBeNull();
    });

    // A backup that is never delivered is worth less than one missing the pictures.
    it('leaves the uploads out rather than exceed what Telegram will accept', async () =>
    {
        writeFileSync(join(uploads, 'huge.bin'), Buffer.alloc(4096));

        const archive = await makeBackup({ store, uploadDir: uploads, log, limitBytes: 1024 });
        const names = listTar(gunzipSync(archive?.bytes as Uint8Array)).map((entry) => entry.name);

        expect(names).toEqual(['index.db']);
        expect(archive?.caption).toContain('Database only');
    });

    it('treats a missing uploads directory as a fresh deployment, not a failure', async () =>
    {
        const archive = await makeBackup({ store, uploadDir: join(uploads, 'nope'), log });
        expect(listTar(gunzipSync(archive?.bytes as Uint8Array)).map((entry) => entry.name)).toEqual(['index.db']);
    });

    it('refuses a name no ustar header can hold', () =>
    {
        expect(fits('uploads/short.png')).toBe(true);
        expect(fits(`uploads/${ 'a'.repeat(200) }.png`)).toBe(false);
        // Long, but splittable at a '/' inside the prefix field.
        expect(fits(`uploads/${ 'a'.repeat(60) }/${ 'b'.repeat(60) }.png`)).toBe(true);
    });

    it('closes the archive so nothing reports it truncated', () =>
    {
        const bytes = tar([{ name: 'a.txt', bytes: new TextEncoder().encode('hi'), mtime: 0 }]);
        expect(bytes.length % 512).toBe(0);
        expect(bytes.subarray(bytes.length - 1024).every((byte) => byte === 0)).toBe(true);
    });
});

describe('the event lines', () =>
{
    let store: IndexStore;
    const options = { symbol: 'NURA', siteUrl: 'https://goman.example' };

    beforeEach(() =>
    {
        store = new IndexStore(':memory:');
        store.insertMarket(marketRow(1, 'Will BTC hit 100k?'), yesNo(1));
    });

    afterEach(() => store.close());

    it('names the market, the side and the amount', () =>
    {
        const line = lineFor(
            event('PredictionPlaced', { buyer: ALICE, outcome: 0n, amountIn: 2_500_000_000_000_000_000n }),
            { store, ...options }
        );
        expect(line).toContain('2.5 NURA');
        expect(line).toContain('Yes');
        expect(line).toContain('Will BTC hit 100k?');
        // The link carries the question, not the row number - see marketPath in wire.ts.
        expect(line).toContain('https://goman.example/market/will-btc-hit-100k-rules-1');
    });

    // A market title is typed by its author and rides the chain verbatim. Telegram rejects a
    // whole message whose HTML does not parse, so one unescaped title silences every unrelated
    // event batched with it.
    it('escapes a title that would otherwise break the markup', () =>
    {
        store.insertMarket(marketRow(2, 'Will <b>X</b> & Y merge?'), yesNo(2));
        const line = lineFor({ ...event('MarketCreated', { marketId: 2n }), marketId: 2 }, { store, ...options });
        expect(line).toContain('Will &lt;b&gt;X&lt;/b&gt; &amp; Y merge?');
        expect(line).not.toContain('<b>X</b>');
    });

    it('says nothing about the mint and burn behind a trade', () =>
    {
        expect(lineFor(event('TransferSingle', { from: ZERO, to: ALICE }), { store, ...options })).toBeNull();
        expect(lineFor(event('TransferBatch', { from: ALICE, to: ZERO }), { store, ...options })).toBeNull();
    });

    it('reports a transfer between two accounts, which nothing else covers', () =>
    {
        const line = lineFor(event('TransferSingle', { from: ALICE, to: BOB }), { store, ...options });
        expect(line).toContain('Shares moved');
        expect(line).toContain('0x4ac0…3712');
    });

    it('names the winner when a market resolves', () =>
    {
        expect(lineFor(event('MarketResolved', { winningOutcome: 1n }), { store, ...options })).toContain('No');
    });

    it('falls back to plain text with no site url', () =>
    {
        const line = lineFor(event('MarketPaused', {}), { store, symbol: 'NURA', siteUrl: '' });
        expect(line).toContain('Will BTC hit 100k?');
        expect(line).not.toContain('<a href');
    });
});

describe('the notification feed', () =>
{
    let store: IndexStore;

    beforeEach(() =>
    {
        store = new IndexStore(':memory:');
        store.insertMarket(marketRow(1, 'Will BTC hit 100k?'), yesNo(1));
    });

    afterEach(() => store.close());

    const serviceWith = (bot: TelegramBot, events = true) =>
        createTelegramService({
            token: 't',
            chatId: 'c',
            store,
            log,
            uploadDir: 'uploads',
            backupMinutes: 10,
            symbol: 'NURA',
            siteUrl: '',
            events,
            bot
        });

    // A fresh index replays the chain from the deploy block. Reporting that would be thousands
    // of messages about markets that closed months ago, delivered one per second.
    it('reports nothing until the index has caught up', () =>
    {
        const bot = fakeBot();
        const service = serviceWith(bot);

        service.onEvents([event('MarketPaused', {}), event('MarketUnpaused', {})]);
        expect(bot.lines).toEqual([]);

        service.arm();
        expect(bot.lines.join(' ')).toContain('2 historical events');

        service.onEvents([event('MarketPaused', {})]);
        expect(bot.lines.filter((line) => line.includes('Paused'))).toHaveLength(1);
    });

    it('stays silent with the feed switched off, backups aside', () =>
    {
        const bot = fakeBot();
        const service = serviceWith(bot, false);
        service.arm();
        service.onEvents([event('MarketPaused', {})]);
        expect(bot.lines).toEqual([]);
    });

    it('sends one archive on demand', async () =>
    {
        const bot = fakeBot();
        expect(await serviceWith(bot).backupNow()).toBe(true);
        expect(bot.documents).toHaveLength(1);
        expect(bot.documents[0].name).toMatch(/\.tar\.gz$/);
    });
});
