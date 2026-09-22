const configured = (import.meta.env.VITE_SITE_URL ?? '') as string;

export const siteUrl = configured.replace(/\/$/, '');

export function canonicalUrl(lang: string, pathname: string): string | null
{
    if (siteUrl === '')
    {
        return null;
    }

    return `${ siteUrl }/${ lang }${ pathname === '/' ? '' : pathname }`;
}
