import Icon from '../../icons/icon.tsx';
import type { IconName } from '../../icons/registry.ts';

import { fieldDir } from '../../i18n/langs.ts';

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
     *  punctuation all sit on the wrong side otherwise. A numeric field defaults to `ltr`;
     *  anything holding a Latin run - an address, a URL, an id - has to say so itself.
     *  It does NOT govern the placeholder: see `fieldDir`. */
    dir?: 'ltr' | 'rtl';

    /** Inert AND visibly inert: a field whose value is not the caller's to change. */
    disabled?: boolean;

    onInput?: (value: string) => void;
    onEnter?: () => void;
}) {
    const size = props.size ?? 'md';

    // A number reads left to right in every language this app ships: the sign leads, the
    // decimal separator sits between the digits, and the browser's own spinner is pinned to
    // the physical end. Left to an RTL page, `-12.5` renders with the minus trailing and the
    // caret jumping sides as it is typed.
    const valueDir = props.dir ?? (props.type === 'number' ? 'ltr' : undefined);

    // While the field is empty it is the PLACEHOLDER on screen, and that is page copy in the
    // page's language, not a value.
    const dir = fieldDir(props.value ?? '', props.placeholder ?? '', valueDir);

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
                disabled={props.disabled === true}
                dir={dir}
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
