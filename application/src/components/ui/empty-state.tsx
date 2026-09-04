import type { ReactNode } from 'react';

import type { IconName } from '../../icons/registry.ts';
import Icon from '../../icons/icon.tsx';

// The centered empty/error state: icon circle, title, hint, one action. `heading` renders
// the title as the page's h1 for full-page gates (the signed-out portfolio).
export default function EmptyState(props: {
    icon: IconName;
    tone?: 'muted' | 'brand' | 'danger';
    size?: 'md' | 'lg';
    title?: string;
    hint?: string;
    heading?: boolean;
    children?: ReactNode;
}) {
    const tone =
        props.tone === 'brand'
            ? 'bg-brand-soft text-brand'
            : props.tone === 'danger'
              ? 'bg-no-soft text-no'
              : 'bg-overlay text-muted';
    const circleSize = props.size === 'lg' ? 'h-14 w-14' : 'h-12 w-12';
    const circle = `mx-auto mb-4 flex ${circleSize} items-center justify-center rounded-sheet ${tone}`;

    return (
        <div
            className={
                props.size === 'lg'
                    ? 'mx-auto max-w-sm py-20 text-center motion-safe:animate-rise'
                    : 'mx-auto max-w-sm py-14 text-center motion-safe:animate-rise'
            }
        >
            <span className={circle}>
                <Icon name={props.icon} size={props.size === 'lg' ? 26 : 22} />
            </span>
            {props.title !== undefined &&
                (props.heading === true ? (
                    <h1 className="mb-1 text-xl font-bold tracking-tight">{props.title}</h1>
                ) : (
                    <p className="mb-1 font-bold">{props.title}</p>
                ))}
            {props.hint !== undefined && <p className="mb-5 text-[14px] text-muted">{props.hint}</p>}
            {props.children}
        </div>
    );
}
