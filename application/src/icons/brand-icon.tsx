import { BRAND_SRC, WALLET_LABEL, type WalletBrand } from './brands.ts';

// A wallet brand mark, served from public/wallets. Decorative (the adjacent label names
// the wallet), so the alt stays empty and the mark is hidden from the tree.
export default function BrandIcon(props: { brand: WalletBrand; size?: number }) {
    return (
        <img
            src={BRAND_SRC[props.brand]}
            width={props.size ?? 24}
            height={props.size ?? 24}
            alt=""
            aria-hidden="true"
            draggable="false"
            className="shrink-0 select-none"
            title={WALLET_LABEL[props.brand]}
        />
    );
}
