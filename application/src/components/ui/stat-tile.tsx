import { cardClass } from './variants.ts';

// One number on a card: the portfolio stats row's atom.
export default function StatTile(props: { label: string; value: string; tone?: 'yes' | 'no' }) {
    const value =
        props.tone === 'yes'
            ? 'nums mt-0.5 text-[15px] font-bold text-yes sm:text-lg'
            : props.tone === 'no'
              ? 'nums mt-0.5 text-[15px] font-bold text-no sm:text-lg'
              : 'nums mt-0.5 text-[15px] font-bold sm:text-lg';

    return (
        <div className={cardClass({ padding: 'tile' })}>
            <p className="truncate text-[11px] text-muted sm:text-[12px]">{props.label}</p>
            <p className={value}>{props.value}</p>
        </div>
    );
}
