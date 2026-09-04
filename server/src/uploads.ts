import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Image hosting for market, outcome and category art. The URI is what goes on-chain (or into
// the categories table); the bytes stay off-chain. This module is the only thing that knows
// WHERE they land, so swapping the local disk for IPFS or S3 is one implementation, not a
// change at every call site.

/** The image formats accepted, keyed by the magic bytes that actually prove the format. */
const SIGNATURES: ReadonlyArray<{ type: string; extension: string; magic: readonly number[]; offset?: number }> = [
    { type: 'image/png', extension: 'png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    { type: 'image/jpeg', extension: 'jpg', magic: [0xff, 0xd8, 0xff] },
    { type: 'image/gif', extension: 'gif', magic: [0x47, 0x49, 0x46, 0x38] },
    { type: 'image/webp', extension: 'webp', magic: [0x57, 0x45, 0x42, 0x50], offset: 8 }
];

// SVG is deliberately absent: it is a script-carrying document, and serving one from our own
// origin hands an attacker same-origin JavaScript.

/** The per-file cap. Market art is a card thumbnail, not a photograph library. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export interface StoredImage {
    /** The public URI to persist - on-chain for a market, in the table for a category. */
    uri: string;

    /** Content type as PROVEN by the magic bytes, never as claimed by the client. */
    type: string;

    bytes: number;
}

export interface Uploader {
    /** Persists the bytes and returns the URI they are reachable at. */
    put(data: Uint8Array, extension: string, type: string): Promise<string>;
}

/**
 * Reads the real format out of the leading bytes. Returns null when nothing matches, which
 * covers both an unsupported format and a file renamed to look like one.
 */
export function sniffImage(data: Uint8Array): { type: string; extension: string } | null {
    for (const candidate of SIGNATURES) {
        const at = candidate.offset ?? 0;
        if (data.length < at + candidate.magic.length) {
            continue;
        }
        if (candidate.magic.every((byte, index) => data[at + index] === byte)) {
            return { type: candidate.type, extension: candidate.extension };
        }
    }
    return null;
}

/** Content addresses the bytes, so re-uploading the same image is idempotent and free. */
export function contentName(data: Uint8Array, extension: string): string {
    return `${createHash('sha256').update(data).digest('hex').slice(0, 32)}.${extension}`;
}

/** Writes into a directory served by `staticFiles`. The default for a self-hosted deploy. */
export function diskUploader(directory: string, publicPath = '/uploads'): Uploader {
    const root = resolve(directory);
    return {
        put: async (data, extension) => {
            const name = contentName(data, extension);
            await mkdir(root, { recursive: true });
            await writeFile(resolve(root, name), data);
            return `${publicPath}/${name}`;
        }
    };
}

/**
 * Validates and stores one uploaded file. Throws a plain Error carrying a stable `code` so
 * the route maps it to the right status without matching on prose.
 */
export async function storeImage(uploader: Uploader, data: Uint8Array): Promise<StoredImage> {
    if (data.length === 0) {
        throw Object.assign(new Error('The file is empty'), { code: 'empty-file' });
    }
    if (data.length > MAX_IMAGE_BYTES) {
        throw Object.assign(new Error('The image is larger than 2 MiB'), { code: 'file-too-large' });
    }
    const format = sniffImage(data);
    if (format === null) {
        throw Object.assign(new Error('Only PNG, JPEG, GIF and WebP images are accepted'), {
            code: 'unsupported-image'
        });
    }
    return {
        uri: await uploader.put(data, format.extension, format.type),
        type: format.type,
        bytes: data.length
    };
}
