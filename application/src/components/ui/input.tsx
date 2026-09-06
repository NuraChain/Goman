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

    /** Direction of the VALUE, when it is not the page's. A field collecting Arabic while the
     *  console runs in English is the case this exists for - the caret, the selection and the
     *  punctuation all sit on the wrong side otherwise. */
    dir?: 'ltr' | 'rtl';

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
                dir={props.dir}
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
