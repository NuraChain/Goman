import { useState } from 'react';

// Market art, one owner. An uploaded (or on-chain) image when there is one, the emoji when
// there is not - four call sites used to hard-code the emoji span at four different sizes,
// so adding real images meant editing all four the same way and hoping.
export default function MarketAvatar(props: {
    image: string;
    emoji: string;
    size: 'sm' | 'md' | 'lg';
    className?: string;
}) {
    const [broken, setBroken] = useState(false);

    const BOX = {
        sm: 'h-6 w-6 rounded-full text-[12px]',
        md: 'h-10 w-10 rounded-control text-xl',
        lg: 'h-12 w-12 rounded-card text-2xl'
    };

    const src = props.image.trim();
    const showImage = src !== '' && !broken;

    return (
        <span
            className={`flex shrink-0 items-center justify-center overflow-hidden bg-overlay ${BOX[props.size]} ${props.className ?? ''}`}
            aria-hidden="true"
        >
            {showImage ? (
                <img
                    className="h-full w-full object-cover"
                    src={src}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={() => setBroken(true)}
                />
            ) : (
                <span>{props.emoji}</span>
            )}
        </span>
    );
}
