import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

import type { Logger } from '../logger.ts';
import type { IndexStore } from '../chain/store.ts';

import { fits, tar, type TarEntry } from './tar.ts';

// One restorable archive: the index database plus every uploaded image, gzipped.
//
// The database is taken with VACUUM INTO rather than copied. This app runs sqlite in WAL mode,
// so `index.db` on disk is only part of the story - the recent writes are in `index.db-wal`,
// and a plain copy of the three files taken while the indexer is mid-transaction restores to
// a torn database. VACUUM INTO holds a read transaction for its duration and writes ONE file
// that is already consistent and already compacted.

const gzipAsync = promisify(gzip);

/** Telegram refuses a document above 50 MB; the archive is held below it with room to spare. */
export const MAX_ARCHIVE_BYTES = 45 * 1024 * 1024;

export interface Backup {
    name: string;
    bytes: Uint8Array;

    /** What is inside, in one line - the caption the document is sent with. */
    caption: string;
}

export interface BackupOptions {
    store: IndexStore;
    uploadDir: string;
    log: Logger;

    /** Overridable so a test does not have to write 45 MB to prove the guard works. */
    limitBytes?: number;
}

/** Builds the archive, or null when even the database alone could not be read. */
export async function makeBackup(options: BackupOptions): Promise<Backup | null>
{
    const limit = options.limitBytes ?? MAX_ARCHIVE_BYTES;
    const stamp = new Date();
    const scratch = join(tmpdir(), `goman-snapshot-${ stamp.getTime() }.db`);

    let database: Uint8Array;
    try
    {
        options.store.snapshot(scratch);
        database = new Uint8Array(readFileSync(scratch));
    }
    catch (error)
    {
        options.log.error('backup snapshot failed', { error: String(error) });
        return null;
    }
    finally
    {
        // Whether or not the read worked: the scratch copy is a full duplicate of the database
        // sitting in the system temp directory, and one left behind every ten minutes fills a
        // disk in a day.
        rmSync(scratch, { force: true });
    }

    const now = Math.floor(stamp.getTime() / 1000);
    const entries: TarEntry[] = [{ name: 'index.db', bytes: database, mtime: now }];

    const uploads = collect(options.uploadDir, options.log);
    const uploadBytes = uploads.reduce((sum, entry) => sum + entry.bytes.length, 0);

    // Images do not compress, so the raw total is a fair prediction of the archive's size and
    // there is no point building one only to find it unsendable. The database goes on its own
    // when the images no longer fit - a backup that omits the pictures is worth having; one
    // that is never delivered is not.
    const complete = database.length + uploadBytes <= limit;
    if (complete)
    {
        entries.push(...uploads);
    }
    else
    {
        options.log.warn('backup dropped uploads to stay sendable', { uploadBytes, limit });
    }

    const bytes = new Uint8Array(await gzipAsync(tar(entries)));
    const name = `goman-${ stampOf(stamp) }.tar.gz`;
    const caption = complete
        ? `Database + ${ uploads.length } uploads, ${ mib(bytes.length) }`
        : `Database only - uploads are ${ mib(uploadBytes) } and would not send, ${ mib(bytes.length) }`;

    return { name, bytes, caption };
}

/** Every file under `dir`, named `uploads/...` inside the archive. Missing dir = no files. */
function collect(dir: string, log: Logger): TarEntry[]
{
    const out: TarEntry[] = [];
    const walk = (current: string): void =>
    {
        for (const item of readdirSync(current, { withFileTypes: true }))
        {
            const full = join(current, item.name);
            if (item.isDirectory())
            {
                walk(full);
                continue;
            }
            if (!item.isFile())
            {
                continue;
            }
            // Archive paths are '/'-separated on every platform, including the one this is
            // most likely to be developed on.
            const name = `uploads/${ relative(dir, full).split(sep).join('/') }`;
            if (!fits(name))
            {
                log.warn('backup skipped an unarchivable name', { name });
                continue;
            }
            out.push({
                name,
                bytes: new Uint8Array(readFileSync(full)),
                mtime: Math.floor(statSync(full).mtimeMs / 1000)
            });
        }
    };
    try
    {
        walk(dir);
    }
    catch
    {
        // No uploads directory yet is the ordinary state of a fresh deployment, not a failure.
    }
    return out;
}

/** `20260910-1915`, so the archives sort by name in whatever they land in. */
function stampOf(at: Date): string
{
    const pad = (value: number): string => String(value).padStart(2, '0');
    return (
        `${ at.getFullYear() }${ pad(at.getMonth() + 1) }${ pad(at.getDate()) }` +
        `-${ pad(at.getHours()) }${ pad(at.getMinutes()) }`
    );
}

/** A size a person can read: a fresh index is kilobytes and a year of one is megabytes. */
function mib(bytes: number): string
{
    return bytes < 1024 * 1024 ? `${ (bytes / 1024).toFixed(0) } KB` : `${ (bytes / 1024 / 1024).toFixed(2) } MB`;
}
