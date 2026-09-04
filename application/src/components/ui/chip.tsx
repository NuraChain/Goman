import type { ReactNode } from 'react';

import Icon from '../../icons/icon.tsx';
import type { IconName } from '../../icons/registry.ts';

import { chipClass } from './variants.ts';

export default function Chip(props: {
    selected?: boolean;
    icon?: IconName;

    /** Rail-density chips: shorter on mobile, icon appears from sm up only. */
    compact?: boolean;

    onSelect?: () => void;
    children?: ReactNode;
}) {
    return (
        <button
            className={chipClass(props.selected ?? false, props.compact ?? false)}
            type="button"
            aria-pressed={props.selected === true}
            onClick={() => props.onSelect?.()}
        >
            {props.icon !== undefined && (
                <span className={props.compact === true ? 'hidden sm:inline-flex' : 'inline-flex'}>
                    <Icon name={props.icon} size={15} />
                </span>
            )}
            {props.children}
        </button>
    );
}
