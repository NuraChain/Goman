import Icon from '../../icons/icon.tsx';
import type { IconName } from '../../icons/registry.ts';

import { inputClass, type InputSize } from './variants.ts';

export default function Input(props: {
    value?: string;
    placeholder?: string;
    type?: string;
    icon?: IconName;

    /** `sm` is the 36px header row; `md` (the default) is the 44px page field. */
    size?: InputSize;

    /** The accessible name; inputs here never rely on a visually attached label. */
    label: string;

    onInput?: (value: string) => void;
    onEnter?: () => void;
}) {
    const size = props.size ?? 'md';

    return (
        <div className="relative flex items-center">
            {props.icon !== undefined && (
                <span
                    className={
                        size === 'sm'
                            ? 'pointer-events-none absolute start-3 text-muted'
                            : 'pointer-events-none absolute start-3.5 text-muted'
                    }
                >
                    <Icon name={props.icon} size={size === 'sm' ? 15 : 17} />
                </span>
            )}
            <input
                className={inputClass(size, props.icon !== undefined)}
                type={props.type ?? 'text'}
                value={props.value ?? ''}
                placeholder={props.placeholder}
                aria-label={props.label}
                onChange={(event) => props.onInput?.(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        props.onEnter?.();
                    }
                }}
            />
        </div>
    );
}
