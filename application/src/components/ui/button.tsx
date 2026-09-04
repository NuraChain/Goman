import type { ReactNode } from 'react';

import Icon from '../../icons/icon.tsx';
import type { IconName } from '../../icons/registry.ts';

import { buttonClass, type ButtonVariant, type ButtonSize } from './variants.ts';

export default function Button(props: {
    variant?: ButtonVariant;
    size?: ButtonSize;
    block?: boolean;
    disabled?: boolean;
    submit?: boolean;
    icon?: IconName;

    /**
     * Work is in flight FOR THIS BUTTON: a spinner replaces the icon, the button is inert, and
     * assistive tech is told via `aria-busy`. It exists because without it no on-chain button
     * in the app could say it was busy - a signature prompt could sit behind the wallet window
     * for thirty seconds while the page looked merely broken.
     */
    loading?: boolean;

    /** Required when the button renders no visible text (icon-only). */
    label?: string;

    onClick?: () => void;
    children?: ReactNode;
}) {
    // Loading implies disabled: a busy control that still accepts clicks is the bug this prop
    // was added to prevent, so the caller cannot forget to pass both.
    const inert = props.loading === true || props.disabled === true;

    return (
        <button
            className={buttonClass(props.variant ?? 'primary', props.size ?? 'md', props.block ?? false)}
            type={props.submit === true ? 'submit' : 'button'}
            disabled={inert}
            aria-busy={props.loading === true}
            aria-label={props.label}
            onClick={() => (inert ? undefined : props.onClick?.())}
        >
            {props.loading === true && (
                <span
                    className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80"
                    aria-hidden="true"
                ></span>
            )}
            {props.loading !== true && props.icon !== undefined && <Icon name={props.icon} size={18} />}
            {props.children}
        </button>
    );
}
