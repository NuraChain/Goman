import { BRAND_SRC, WALLET_LABEL, type WalletBrand } from './brands.ts';

import Icon from './icon.tsx';

// A wallet brand mark, served from public/wallets. Decorative (the adjacent label names
// the wallet), so the alt stays empty and the mark is hidden from the tree.
//
// A brand with no vector in BRAND_SRC falls back to the generic wallet glyph at the same
// box size: the list stays legible, and nothing on screen claims to be a logo it is not.
export default function BrandIcon(props: { brand: WalletBrand; size?: number }) {
    const size = props.size ?? 24;
    const src = BRAND_SRC[props.brand];

    if (src === undefined) {
        return (
            <span
                className="flex shrink-0 items-center justify-center rounded-md bg-overlay text-muted"
                style={{ width: `${size}px`, height: `${size}px` }}
                title={WALLET_LABEL[props.brand]}
            >
                <Icon name="wallet" size={Math.round(size * 0.6)} />
            </span>
        );
    }

    return (
        <img
            src={src}
            width={size}
            height={size}
            alt=""
            aria-hidden="true"
            draggable="false"
            className="shrink-0 select-none"
            title={WALLET_LABEL[props.brand]}
        />
    );
}
