import Skeleton from './skeleton.tsx';

// A stack of placeholder rows - the loading shape of every list. `height` is a complete
// Tailwind height utility spelled at the call site so the scanner sees it.
export default function SkeletonList(props: {
    count: number;
    height: string;
    radius?: 'control' | 'card';
    gap?: 'sm' | 'md';
    className?: string;
}) {
    const item = `${props.height} ${props.radius === 'card' ? 'rounded-card' : 'rounded-control'}`;
    const wrapper =
        `${props.gap === 'md' ? 'flex flex-col gap-3' : 'flex flex-col gap-2'}` +
        `${props.className !== undefined ? ` ${props.className}` : ''}`;

    return (
        <div className={wrapper}>
            {Array.from({ length: props.count }, (_slot, index) => (
                <Skeleton key={index} className={item} />
            ))}
        </div>
    );
}
