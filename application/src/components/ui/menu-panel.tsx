import type { ReactNode } from 'react';

import { MENU_PANEL } from './variants.ts';

// The floating menu surface: positioned against the nearest `relative` wrapper, clamped
// to the viewport, role="menu". Pair with MenuItem rows, useDismiss, and useRovingFocus.
export default function MenuPanel(props: {
    label: string;
    align?: 'start' | 'end';
    width?: string;
    children?: ReactNode;
}) {
    return (
        <div
            className={`absolute ${props.align === 'start' ? 'start-0' : 'end-0'} top-11 ${props.width ?? 'w-60'} p-1.5 ${MENU_PANEL}`}
            role="menu"
            aria-label={props.label}
        >
            {props.children}
        </div>
    );
}
