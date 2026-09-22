// Pure wallet-identity helpers, split from the session store so displaying an address
// never instantiates the session.

/** A 20-byte hex address. Case is NOT checked: an address copied off an explorer carries its
 *  EIP-55 checksum capitals and one typed by hand does not, and both name the same wallet. */
export function isWalletAddress(value: string): boolean
{
    return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function shortAddress(address: string): string
{
    return `${ address.slice(0, 6) }...${ address.slice(-4) }`;
}

/** Two hues from the address bytes - the deterministic identicon gradient. */
export function addressGradient(address: string): string
{
    let first = 0;
    let second = 0;
    for (let index = 2; index < address.length; index++)
    {
        const code = address.charCodeAt(index);
        if (index % 2 === 0)
        {
            first = (first + code * 7) % 360;
        }
        else
        {
            second = (second + code * 13) % 360;
        }
    }
    return `linear-gradient(135deg, hsl(${ first } 70% 55%), hsl(${ second } 70% 40%))`;
}
