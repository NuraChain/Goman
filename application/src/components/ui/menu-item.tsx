import type { ReactNode } from 'react';

import type { IconName } from '../../icons/registry.ts';
import Icon from '../../icons/icon.tsx';

// One menu row: icon + label, quiet hover; `danger` is the destructive treatment
// (disconnect, delete). Focusable for the menu pattern's roving focus.
export default function MenuItem(props: {
    icon?: IconName;
    danger?: boolean;
    onSelect: () => void;
    children?: ReactNode;
}) {
    return (
        <button
            className={
                props.danger === true
                    ? 'flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-control px-3 text-[14px] font-semibold text-no transition-colors duration-200 hover:bg-no-soft'
                    : 'flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-control px-3 text-[14px] font-semibold text-text transition-colors duration-200 hover:bg-raised'
            }
            type="button"
            role="menuitem"
            onClick={() => props.onSelect()}
        >
            {props.icon !== undefined && (
                <Icon name={props.icon} size={17} className={props.danger === true ? '' : 'text-muted'} />
            )}
            {props.children}
        </button>
    );
}
