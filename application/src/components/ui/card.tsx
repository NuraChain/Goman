import type { ReactNode } from 'react';

import { cardClass, type CardTone, type CardPadding, type CardAnimate } from './variants.ts';

// The card surface as a component, for the common block case. A site that must be a
// different element (article, li, aside, Link) calls cardClass() directly instead.
export default function Card(props: {
    tone?: CardTone;
    padding?: CardPadding;
    interactive?: boolean;
    animate?: CardAnimate;
    className?: string;
    children?: ReactNode;
}) {
    const classes = cardClass({
        tone: props.tone,
        padding: props.padding,
        interactive: props.interactive,
        animate: props.animate
    });
    return (
        <div className={`${classes}${props.className !== undefined ? ` ${props.className}` : ''}`}>
            {props.children}
        </div>
    );
}
