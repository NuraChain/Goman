import { useCallback, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { useDismiss } from '../../hooks/use-dismiss.ts';

import type { IconName } from '../../icons/registry.ts';
import Icon from '../../icons/icon.tsx';

import { MENU_PANEL } from './variants.ts';

// The dropdown from the filter-row reference: a chip trigger, an overlay menu with icon
// options and a selected check. Any press outside, Escape, and selection all close it;
// arrows + Enter drive it from the keyboard, and the panel flips to the edge that keeps
// it on screen.
export default function Select(props: {
    options: Array<{ id: string; label: string; icon?: IconName }>;
    value: string;
    onChange: (id: string) => void;
    label: string;
}) {
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const [alignEnd, setAlignEnd] = useState(false);

    const root = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);

    const selected = props.options.find((option) => option.id === props.value);

    const close = useCallback(() => setOpen(false), []);
    useDismiss({ open, onClose: close, root, trigger });

    // min-w-44 on the panel; the flip check uses the same number.
    const PANEL_MIN = 176;

    const openMenu = (): void => {
        setActive(
            Math.max(
                0,
                props.options.findIndex((option) => option.id === props.value)
            )
        );
        const element = trigger.current;
        if (element !== null) {
            const rect = element.getBoundingClientRect();
            const rtl = document.documentElement.dir === 'rtl';
            setAlignEnd(rtl ? rect.right - PANEL_MIN < 8 : rect.left + PANEL_MIN > window.innerWidth - 8);
        }
        setOpen(true);
    };

    const choose = (id: string): void => {
        props.onChange(id);
        setOpen(false);
        trigger.current?.focus();
    };

    const onKeys = (event: KeyboardEvent): void => {
        if (!open) {
            return;
        }
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((current) => Math.min(props.options.length - 1, current + 1));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((current) => Math.max(0, current - 1));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const option = props.options[active];
            if (option !== undefined) {
                choose(option.id);
            }
        }
    };

    return (
        <div className="relative inline-flex" ref={root} onKeyDown={onKeys}>
            <button
                ref={trigger}
                className="flex h-9 cursor-pointer items-center gap-1.5 rounded-control border border-line bg-raised px-3 text-[13px] font-semibold text-text transition-colors duration-200 hover:border-line-strong"
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={props.label}
                onClick={() => {
                    if (open) {
                        setOpen(false);
                    } else {
                        openMenu();
                    }
                }}
            >
                {selected?.icon !== undefined && <Icon name={selected.icon} size={15} className="text-muted" />}
                {selected?.label ?? props.label}
                <Icon name="chevron-down" size={15} className="text-faint" />
            </button>

            {open && (
                <ul
                    className={`absolute ${alignEnd ? 'end-0' : 'start-0'} top-10 min-w-44 p-1 ${MENU_PANEL}`}
                    role="listbox"
                    aria-label={props.label}
                >
                    {props.options.map((option, index) => (
                        <li key={option.id} role="option" aria-selected={props.value === option.id}>
                            <button
                                className={
                                    index === active
                                        ? 'flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-control bg-raised px-3 text-[13.5px] font-semibold text-text'
                                        : 'flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-control px-3 text-[13.5px] font-semibold text-muted transition-colors duration-200 hover:bg-raised hover:text-text'
                                }
                                type="button"
                                onClick={() => choose(option.id)}
                                onMouseEnter={() => setActive(index)}
                            >
                                {option.icon !== undefined && (
                                    <Icon name={option.icon} size={15} className="text-muted" />
                                )}
                                <span className="min-w-0 flex-1 truncate text-start">{option.label}</span>
                                {props.value === option.id && <Icon name="check" size={15} className="text-brand" />}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
