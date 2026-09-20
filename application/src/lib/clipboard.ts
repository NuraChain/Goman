// The one clipboard write. Every copy button used to push its "Copied" toast synchronously,
// before (and regardless of) the write resolving - so on a non-secure origin, or with the
// permission denied, the app cheerfully reported a copy that never happened, and two of the
// four sites additionally threw an unhandled rejection. Reporting the OUTCOME is the point.

/**
 * Writes `text` to the clipboard and reports whether it landed. Never throws: a missing API
 * (no `navigator.clipboard` outside a secure context) and a rejected write are the same
 * answer to the caller - false.
 *
 * @param text - The text to place on the clipboard.
 * @returns True when the clipboard accepted the write.
 */
export async function copyText(text: string): Promise<boolean>
{
    try
    {
        if (typeof navigator === 'undefined' || navigator.clipboard === undefined)
        {
            return false;
        }
        await navigator.clipboard.writeText(text);
        return true;
    }
    catch
    {
        return false;
    }
}
