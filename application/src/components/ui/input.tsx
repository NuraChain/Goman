import Icon from '../../icons/icon.tsx';
import type { IconName } from '../../icons/registry.ts';

export default function Input(props: {
    value?: string;
    placeholder?: string;
    type?: string;
    icon?: IconName;

    /** The accessible name; inputs here never rely on a visually attached label. */
    label: string;

    onInput?: (value: string) => void;
    onEnter?: () => void;
}) {
    return (
        <div className="relative flex items-center">
            {props.icon !== undefined && (
                <span className="pointer-events-none absolute start-3.5 text-muted">
                    <Icon name={props.icon} size={17} />
                </span>
            )}
            <input
                className={
                    props.icon !== undefined
                        ? 'h-11 w-full rounded-control border border-line bg-raised ps-10 pe-3.5 text-[15px] text-text placeholder:text-faint transition-colors duration-200 focus:border-brand focus:outline-none'
                        : 'h-11 w-full rounded-control border border-line bg-raised px-3.5 text-[15px] text-text placeholder:text-faint transition-colors duration-200 focus:border-brand focus:outline-none'
                }
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
