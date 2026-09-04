import type { ReactNode } from 'react';

// A settings card row: bold label (optional hint) on the start side, one control on the
// end side. `divided` draws the border-t separator every row after the first carries.
export default function SettingRow(props: {
    label: string;
    hint?: string;
    divided?: boolean;
    wrap?: boolean;
    children?: ReactNode;
}) {
    const classes =
        props.divided === true
            ? props.wrap === true
                ? 'mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4'
                : 'mt-4 flex items-center justify-between gap-2 border-t border-line pt-4'
            : props.wrap === true
              ? 'flex flex-wrap items-center justify-between gap-2'
              : 'flex items-center justify-between gap-2';

    return (
        <div className={classes}>
            <div className="min-w-0 pe-2">
                <p className="text-[14px] font-bold">{props.label}</p>
                {props.hint !== undefined && <p className="truncate text-[13px] text-muted">{props.hint}</p>}
            </div>
            {props.children}
        </div>
    );
}
