import { tabClass } from './variants.ts';

export default function Tabs(props: {
    tabs: Array<{ id: string; label: string }>;
    active: string;
    onChange: (id: string) => void;
}) {
    return (
        <div className="flex items-center gap-5 border-b border-line" role="tablist">
            {props.tabs.map((tab) => (
                <button
                    key={tab.id}
                    className={tabClass(props.active === tab.id)}
                    type="button"
                    role="tab"
                    aria-selected={props.active === tab.id}
                    onClick={() => props.onChange(tab.id)}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    );
}
