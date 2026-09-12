import type { Lang } from '../../i18n/langs.ts';
import type { Round, RoundSide } from '../../api.ts';
import { formatMultiplier } from '../../i18n/format.ts';

// The two legs, shared by every component on the /live page so none of them re-derives the
// mapping. The INDEX is the part that must never drift: it is what `bet()` takes, and a card
// that had its own idea of which index meant Up would place the opposite bet in silence.

/** On-chain outcome index per side. Fixed by the engine at deploy time; see rounds/engine.ts. */
export const SIDE_INDEX: Record<RoundSide, number> = { up: 0, down: 1 };

/**
 * What one unit staked on `side` would pay if the round settled with the pools as they stand.
 * It is a parimutuel, so this MOVES: the stake that reads a generous multiple changes it by
 * joining the pool, and every later bet on the same side dilutes it further. Gross of the
 * market's trading fee, which comes out of the pot at settlement.
 *
 * An em dash while a side is empty: the arithmetic there divides by zero, and rendering that
 * as a very large multiple would advertise a payout nobody can actually get.
 */
export function payoutLabel(round: Round, side: RoundSide, lang: Lang): string {
    const own = side === 'up' ? round.upPool : round.downPool;
    const total = round.upPool + round.downPool;
    if (own <= 0 || total <= 0) {
        return '—';
    }
    return formatMultiplier(total / own, lang);
}
