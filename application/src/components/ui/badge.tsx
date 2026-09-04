import type { ReactNode } from 'react';

import Icon from '../../icons/icon.tsx';
import type { IconName } from '../../icons/registry.ts';

import { badgeClass, type BadgeTone } from './variants.ts';

export default function Badge(props: { tone?: BadgeTone; icon?: IconName; children?: ReactNode }) {
    return (
        <span className={badgeClass(props.tone ?? 'muted')}>
            {props.icon !== undefined && <Icon name={props.icon} size={12} />}
            {props.children}
        </span>
    );
}
