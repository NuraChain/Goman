// A country flag, served from public/flags (the 4x3 set, extracted once - no CDN and no
// runtime icon dependency, the same arrangement the wallet marks use).
//
// Decorative by contract: the endonym beside it is the accessible name, so a flag never
// carries meaning on its own. It also must not: a flag names a country, and the language
// it stands in for is a presentation choice made in the language registry.
export default function Flag(props: { code: string; className?: string }) {
    return (
        <img
            className={`h-4 w-6 shrink-0 rounded-sm object-cover${props.className === undefined ? '' : ` ${props.className}`}`}
            src={`/flags/${props.code}.svg`}
            width={24}
            height={16}
            alt=""
            aria-hidden="true"
            draggable="false"
            loading="lazy"
        />
    );
}
