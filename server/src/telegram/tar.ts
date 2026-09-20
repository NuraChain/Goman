// A minimal ustar writer.
//
// Node ships gzip and no archiver, and the backup has to carry more than one file - the
// database AND the uploaded images - so something has to put them in one envelope. tar is
// half a page of arithmetic and every operating system can already open it, which is a better
// trade than a dependency in the backup path: the one code path that must still work on the
// day everything else has stopped.

/** Every tar field is a multiple of this, header and payload alike. */
const BLOCK = 512;

export interface TarEntry {
    /** Path inside the archive, '/'-separated. */
    name: string;
    bytes: Uint8Array;

    /** Seconds; the file's own mtime, so an unpacked backup keeps its dates. */
    mtime: number;
}

/** True when this path fits a ustar header (100 chars, or 155 + '/' + 100 when split). */
export function fits(name: string): boolean
{
    if (name.length <= 100)
    {
        return true;
    }
    const cut = name.lastIndexOf('/', 155);
    return cut > 0 && name.length - cut - 1 <= 100;
}

/** Packs entries into an uncompressed tar. Names that cannot fit a header are skipped by the
 *  caller, which is why {@link fits} is exported rather than checked here. */
export function tar(entries: readonly TarEntry[]): Uint8Array
{
    const parts: Uint8Array[] = [];
    for (const entry of entries)
    {
        parts.push(header(entry));
        parts.push(entry.bytes);
        const remainder = entry.bytes.length % BLOCK;
        if (remainder !== 0)
        {
            parts.push(new Uint8Array(BLOCK - remainder));
        }
    }
    // Two zero blocks close an archive; without them tar reports a truncated file.
    parts.push(new Uint8Array(BLOCK * 2));

    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts)
    {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

function header(entry: TarEntry): Uint8Array
{
    const block = new Uint8Array(BLOCK);
    const encoder = new TextEncoder();
    const put = (value: string, at: number, width: number): void =>
    {
        block.set(encoder.encode(value).subarray(0, width), at);
    };
    /** ustar numbers are octal, right-aligned in width-1 digits, then NUL. */
    const octal = (value: number, width: number): string => value.toString(8).padStart(width - 1, '0');

    let name = entry.name;
    let prefix = '';
    if (name.length > 100)
    {
        const cut = name.lastIndexOf('/', 155);
        prefix = name.slice(0, cut);
        name = name.slice(cut + 1);
    }

    put(name, 0, 100);
    put(octal(0o644, 8), 100, 8);
    put(octal(0, 8), 108, 8);
    put(octal(0, 8), 116, 8);
    put(octal(entry.bytes.length, 12), 124, 12);
    put(octal(Math.floor(entry.mtime), 12), 136, 12);
    // The checksum field is counted AS SPACES while the checksum is computed over the header,
    // so it is filled with spaces first and overwritten below.
    put('        ', 148, 8);
    put('0', 156, 1);
    put('ustar', 257, 6);
    put('00', 263, 2);
    put(prefix, 345, 155);

    let sum = 0;
    for (const byte of block)
    {
        sum += byte;
    }
    put(`${ octal(sum, 7) }\0 `, 148, 8);
    return block;
}
