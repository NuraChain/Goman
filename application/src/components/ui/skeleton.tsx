export default function Skeleton(props: { className?: string }) {
    return (
        <div
            className={props.className !== undefined ? `skeleton ${props.className}` : 'skeleton h-4 w-full'}
            aria-hidden="true"
        ></div>
    );
}
