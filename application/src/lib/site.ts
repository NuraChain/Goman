// Where this deployment lives, as the browser half knows it.
//
// A canonical link and `og:url` have to be ABSOLUTE, and the only other way to learn an origin
// during a server render is to read the request - which the kit treats as "this page is a
// function of the visitor" and answers `private, no-store` for. That would quietly make every
// page uncacheable, including the one page here that is meant to be cached. A build-time
// constant costs nothing and poisons nothing.
//
// It has to AGREE with `SITE_URL` in server/.env, which the Telegram poster already uses to
// build the same links. Unset, every absolute tag is simply omitted: a canonical pointing at
// `http://localhost:6001` on a live site is worse than no canonical at all.
const configured = (import.meta.env.VITE_SITE_URL ?? '') as string;

/** The origin, without a trailing slash, or `''` when this deployment has not been told one. */
export const siteUrl = configured.replace(/\/$/, '');

/**
 * The absolute url of a page in one language, or `null` when no origin is configured.
 *
 * Under `routing: 'prefix'` the base IS the language, so the address is the origin, the language
 * and the route's own path - which is why this needs no router internals. `pathname` arrives
 * base-relative from `useRoute()`, and `/` is the one that would otherwise render `/en/`.
 */
export function canonicalUrl(lang: string, pathname: string): string | null
{
    if (siteUrl === '')
    {
        return null;
    }

    return `${ siteUrl }/${ lang }${ pathname === '/' ? '' : pathname }`;
}
