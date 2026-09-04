// The compact pill switcher (chart ranges, P/L periods): one bold pill for the active
// entry, quiet text pills for the rest. `latinNums` pins digits for range labels.
export default function PillGroup(props: {
    items: Array<{ id: string; label: string }>;
    active: string;
    onChange: (id: string) => void;
    latinNums?: boolean;
    className?: string;
}) {
    return (
        <div className={`flex gap-1${props.className !== undefined ? ` ${props.className}` : ''}`}>
            {props.items.map((entry) => (
                <button
                    key={entry.id}
                    className={`${props.latinNums === true ? 'latin-nums ' : ''}${
                        props.active === entry.id
                            ? 'h-8 cursor-pointer rounded-control bg-overlay px-2.5 text-[12px] font-bold text-text'
                            : 'h-8 cursor-pointer rounded-control px-2.5 text-[12px] font-semibold text-faint transition-colors duration-200 hover:text-muted'
                    }`}
                    type="button"
                    onClick={() => props.onChange(entry.id)}
                >
                    {entry.label}
                </button>
            ))}
        </div>
    );
}
