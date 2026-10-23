import type { IndexStore } from './chain/store.ts';
import type { TelegramSettings } from './wire.ts';

// Settings the CONSOLE owns, rather than the environment.
//
// The split is worth stating once. Anything needed to BOOT - the RPC url, the factory address,
// the bot token - stays in .env, because a server that cannot read it has nothing to serve and
// should fail loudly at startup. Anything an operator adjusts while the thing is RUNNING lives
// here, because changing it in .env means a redeploy, and a redeploy to change a backup
// interval is the kind of friction that ends with nobody changing it at all.
//
// Reads are defensive on purpose: the table is written by an HTTP route, so a value can be
// absent (never set), or garbage (an older shape, a hand-edited database). Every getter below
// falls back to the default rather than throwing, because a malformed row must not be able to
// stop the server from starting.

const BACKUP_MINUTES = 'telegram.backupMinutes';
const EVENTS = 'telegram.events';

/** Backup period when nothing has been saved. Ten minutes, which is what the environment
 *  variable this replaced defaulted to. */
export const DEFAULT_BACKUP_MINUTES = 10;

/** The ceiling the schema also enforces: a week. Past this a backup is not a backup. */
const MAX_BACKUP_MINUTES = 10080;

export async function readTelegramSettings(store: IndexStore): Promise<TelegramSettings>
{
    const saved = Number(await store.setting(BACKUP_MINUTES));
    const valid = Number.isFinite(saved) && saved >= 1 && saved <= MAX_BACKUP_MINUTES;
    return {
        backupMinutes: valid ? Math.floor(saved) : DEFAULT_BACKUP_MINUTES,
        // Absent reads as ON: the feed is the bot's whole point, and a fresh install that
        // silently said nothing would look broken rather than configured.
        events: (await store.setting(EVENTS)) !== 'off'
    };
}

/** Both settings in one transaction, so a restart never reads one saved and the other not. */
export function writeTelegramSettings(store: IndexStore, settings: TelegramSettings): Promise<void>
{
    return store.transaction(async () =>
    {
        await store.putSetting(BACKUP_MINUTES, String(settings.backupMinutes));
        await store.putSetting(EVENTS, settings.events ? 'on' : 'off');
    });
}
