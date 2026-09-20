import { Link } from 'react-router';

import type { MarketTag } from '../../api.ts';

import { chipClass } from '../ui/variants.ts';

// A market's tags, as the thing to press to find the rest of them.
//
// LINKS by default, not buttons: a tag is a place - it has a URL, it opens in a new tab, it
// can be shared - and a click handler that pushed a route would take all three away. The
// `onSelect` form exists for the one caller already standing on a tag page, where pressing
// another tag ADDS it to a filter rather than navigating away from what is on screen.
export default function TagList(props: { tags: MarketTag[]; selected?: string; onSelect?: (slug: string) => void })
{
    if (props.tags.length === 0)
    {
        return null;
    }
    return (
        <div className="flex flex-wrap gap-1.5">
            {props.tags.map((tag) =>
                props.onSelect === undefined ? (
                    <Link
                        key={tag.slug}
                        className={chipClass(tag.slug === props.selected, true)}
                        to={tagLink(tag.slug)}
                    >
                        <bdi>{tag.name}</bdi>
                    </Link>
                ) : (
                    <button
                        key={tag.slug}
                        className={chipClass(tag.slug === props.selected, true)}
                        type="button"
                        onClick={() => props.onSelect?.(tag.slug)}
                    >
                        <bdi>{tag.name}</bdi>
                    </button>
                )
            )}
        </div>
    );
}

/** Where a tag goes. One spelling of this URL, so a chip, a card and a share all agree. */
export function tagLink(slug: string): string
{
    return `/tag/${ encodeURIComponent(slug) }`;
}
