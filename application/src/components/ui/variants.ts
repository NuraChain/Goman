// The Ledger variant maps - every utility the primitives use, spelled as FULL literal class
// lists. This is a scanner constraint, not a style choice: Tailwind cannot see names composed
// at runtime, so a variant is always one complete string picked from a map, never assembled.

export type ButtonVariant = 'primary' | 'gold' | 'outline' | 'ghost' | 'danger' | 'yes' | 'no';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type BadgeTone = 'brand' | 'gold' | 'muted' | 'yes' | 'no';

const BUTTON_BASE =
    'inline-flex cursor-pointer select-none items-center justify-center rounded-control font-semibold transition duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
    primary: 'bg-brand text-on-brand hover:bg-brand-press',
    gold: 'bg-gold text-on-gold hover:brightness-95',
    outline: 'border border-line-strong bg-transparent text-text hover:bg-overlay',
    ghost: 'bg-transparent text-muted hover:bg-overlay hover:text-text',
    danger: 'bg-no-soft text-no hover-tint',
    yes: 'bg-yes-soft text-yes hover-tint',
    no: 'bg-no-soft text-no hover-tint'
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
    sm: 'h-9 gap-1.5 px-3 text-[13px]',
    md: 'h-11 gap-2 px-4 text-[15px]',
    lg: 'h-12 gap-2 px-5 text-base'
};

export function buttonClass(variant: ButtonVariant, size: ButtonSize, block: boolean): string {
    return `${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]}${block ? ' w-full' : ''}`;
}

const BADGE_TONE: Record<BadgeTone, string> = {
    brand: 'bg-brand-soft text-brand',
    gold: 'bg-gold-soft text-gold',
    muted: 'bg-overlay text-muted',
    yes: 'bg-yes-soft text-yes',
    no: 'bg-no-soft text-no'
};

export function badgeClass(tone: BadgeTone): string {
    return `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide ${BADGE_TONE[tone]}`;
}

export function chipClass(selected: boolean, compact = false): string {
    const size = compact
        ? 'h-8 gap-1.5 px-3 text-[12.5px] sm:h-9 sm:px-3.5 sm:text-[13px]'
        : 'h-9 gap-1.5 px-3.5 text-[13px]';
    const base = `inline-flex shrink-0 cursor-pointer select-none items-center whitespace-nowrap rounded-full font-semibold transition duration-200 active:scale-[0.97] ${size}`;
    return selected
        ? `${base} bg-text text-surface`
        : `${base} border border-line bg-raised text-muted hover:border-line-strong hover:text-text`;
}

export function tabClass(active: boolean): string {
    const base =
        'inline-flex h-11 cursor-pointer select-none items-center gap-1.5 border-b-2 px-1 text-[14px] font-semibold transition-colors duration-200';
    return active ? `${base} border-brand text-text` : `${base} border-transparent text-muted hover:text-text`;
}

export type CardTone = 'line' | 'brand' | 'danger' | 'overlay';
export type CardPadding = 'none' | 'snug' | 'base' | 'tile';
export type CardAnimate = 'none' | 'rise' | 'fade';

const CARD_TONE: Record<CardTone, string> = {
    line: 'rounded-card border border-line bg-raised',
    brand: 'rounded-card border border-brand bg-brand-soft',
    danger: 'rounded-card border border-no/40 bg-raised',
    overlay: 'rounded-card border border-line bg-overlay shadow-2xl'
};

const CARD_PADDING: Record<CardPadding, string> = {
    none: '',
    snug: ' p-3.5',
    base: ' p-4',
    tile: ' p-3 sm:p-3.5'
};

const CARD_ANIMATE: Record<CardAnimate, string> = {
    none: '',
    rise: ' motion-safe:animate-rise',
    fade: ' motion-safe:animate-fade'
};

/** The card surface. `interactive` is the hover treatment list rows and market cards share. */
export function cardClass(
    options: { tone?: CardTone; padding?: CardPadding; interactive?: boolean; animate?: CardAnimate } = {}
): string {
    return (
        CARD_TONE[options.tone ?? 'line'] +
        CARD_PADDING[options.padding ?? 'base'] +
        (options.interactive === true ? ' transition duration-200 hover:border-line-strong' : '') +
        CARD_ANIMATE[options.animate ?? 'none']
    );
}

export type IconButtonSize = 'sm' | 'md' | 'lg';

const ICON_BUTTON_SIZE: Record<IconButtonSize, string> = {
    sm: 'h-8 w-8',
    md: 'h-9 w-9',
    lg: 'h-11 w-11'
};

/** The square icon-only button; `bordered` is the outlined form the filter/rail arrows use. */
export function iconButtonClass(size: IconButtonSize, bordered = false): string {
    return `flex ${ICON_BUTTON_SIZE[size]} shrink-0 cursor-pointer items-center justify-center rounded-control text-muted transition-colors duration-200 hover:bg-overlay hover:text-text disabled:pointer-events-none disabled:opacity-40${bordered ? ' border border-line' : ''}`;
}

/** The floating dropdown panel; alignment/offset/width stay at the call site. */
export const MENU_PANEL =
    'z-[var(--z-menu)] max-w-[calc(100vw-1rem)] rounded-card border border-line bg-overlay shadow-2xl motion-safe:animate-pop';

/** The market-card grid: 1/2/3/4 columns across the breakpoints. */
export const MARKET_GRID = 'grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-4';
