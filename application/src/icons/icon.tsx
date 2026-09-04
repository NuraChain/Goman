import { createElement } from 'react';

import { ICONS, MIRRORED, type IconName } from './registry.ts';

// The one icon component: lucide node data ([tag, attrs] pairs) projected through
// `createElement`, so an icon is real painted geometry rather than a font glyph.
// Direction-implying icons carry .icon-mirror, which base.css flips under [dir='rtl'] -
// mirroring follows the document, never state.
//
// Icons are decorative by contract: aria-hidden always, the accessible name lives on the
// labeled control around them. An icon-only button therefore MUST carry its own aria-label.
export default function Icon(props: {
    name: IconName;

    /** Square size in px. 20 sits right against the 14px data type scale. */
    size?: number;

    /** Extra classes; color comes from `currentColor`, so tint with text utilities. */
    className?: string;

    strokeWidth?: number;

    /** Fills the glyph with currentColor - the active state of toggle icons (bookmark). */
    fill?: boolean;
}) {
    const size = props.size ?? 20;

    return (
        <svg
            viewBox="0 0 24 24"
            fill={props.fill === true ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            width={size}
            height={size}
            strokeWidth={props.strokeWidth ?? 2}
            className={[MIRRORED.has(props.name) ? 'icon-mirror' : '', props.className ?? ''].filter(Boolean).join(' ')}
        >
            {ICONS[props.name].map((node, index) => createElement(node[0], { ...node[1], key: index }))}
        </svg>
    );
}
