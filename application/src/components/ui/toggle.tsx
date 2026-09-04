// The settings toggle: a 44px-wide track with a sliding knob, RTL-aware via logical
// `start-*` offsets. The accessible name is required - the track carries no text.
export default function Toggle(props: { checked: boolean; label: string; onChange: (next: boolean) => void }) {
    return (
        <button
            className={
                props.checked
                    ? 'relative h-7 w-12 shrink-0 cursor-pointer rounded-full bg-brand transition-colors duration-200'
                    : 'relative h-7 w-12 shrink-0 cursor-pointer rounded-full bg-line-strong transition-colors duration-200'
            }
            type="button"
            role="switch"
            aria-checked={props.checked}
            aria-label={props.label}
            onClick={() => props.onChange(!props.checked)}
        >
            <span
                className={
                    props.checked
                        ? 'absolute top-1 start-6 h-5 w-5 rounded-full bg-white transition-all duration-200'
                        : 'absolute top-1 start-1 h-5 w-5 rounded-full bg-white transition-all duration-200'
                }
                aria-hidden="true"
            ></span>
        </button>
    );
}
