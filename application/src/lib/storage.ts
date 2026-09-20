// localStorage that never throws. Privacy modes, quota errors, and non-browser runtimes
// (Node ships a stub global that throws without a backing file) all surface as "no saved
// value" instead of crashing the store that asked.

export function readSetting(key: string): string | null
{
    try
    {
        return globalThis.localStorage.getItem(key);
    }
    catch
    {
        return null;
    }
}

export function writeSetting(key: string, value: string): void
{
    try
    {
        globalThis.localStorage.setItem(key, value);
    }
    catch
    {
        // A visitor whose storage refuses simply loses persistence, never the app.
    }
}
