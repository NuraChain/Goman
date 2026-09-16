import { useEffect, useRef, useState } from 'react';

import { useLocale } from '../../stores/locale.store.ts';
import { useAdmin } from '../../stores/admin.store.ts';
import { useOnchain } from '../../stores/onchain.store.ts';

import Icon from '../../icons/icon.tsx';

import Button from '../ui/button.tsx';
import Card from '../ui/card.tsx';
import Input from '../ui/input.tsx';
import SettingRow from '../ui/setting-row.tsx';
import Skeleton from '../ui/skeleton.tsx';
import Toggle from '../ui/toggle.tsx';

// The bot's settings.
//
// Both of these used to be environment variables, which meant a redeploy to change a number
// nobody should need a deploy to change. They live in the database now and are applied to the
// RUNNING service on save, so the next backup honours a new interval rather than the next boot.
//
// The tab used to carry an allowlist as well - who was permitted to send /newmarket. The bot
// takes no market suggestions any more, so there is nothing left to gate: it posts the event
// feed and backs the database up, and a market is prepared in the create form by a wallet the
// console invited under Access.
export default function TelegramCard() {
    const { t } = useLocale();
    const admin = useAdmin();
    const onchain = useOnchain();

    const state = admin.telegram.data();

    const [minutes, setMinutes] = useState('');
    const [events, setEvents] = useState(true);
    const [saving, setSaving] = useState(false);

    // Re-seeds whenever the SAVED settings change, the way the signer card re-seeds off the
    // chain's own set: stale input sitting over a value somebody else changed is how an
    // operator saves back the number they just replaced.
    const lastSeen = useRef('');

    useEffect(() => {
        if (state === undefined) {
            return;
        }
        const stamp = `${state.settings.backupMinutes}|${state.settings.events}`;
        if (stamp !== lastSeen.current) {
            lastSeen.current = stamp;
            setMinutes(String(state.settings.backupMinutes));
            setEvents(state.settings.events);
        }
    }, [state]);

    const period = Number(minutes);
    const validPeriod = Number.isInteger(period) && period >= 1 && period <= 10080;
    const changed =
        state !== undefined && (period !== state.settings.backupMinutes || events !== state.settings.events);

    const busy = saving || onchain.pending();

    const save = async (): Promise<void> => {
        if (!validPeriod) {
            return;
        }
        setSaving(true);
        await admin.saveTelegramSettings({ backupMinutes: period, events });
        setSaving(false);
    };

    if (state === undefined) {
        return (
            <Card>
                <Skeleton className="h-48 rounded-control" />
            </Card>
        );
    }

    return (
        <Card>
            <h2 className="mb-1 text-lg font-bold tracking-tight">{t('admin.telegramTitle')}</h2>
            <p className="mb-3 text-[13px] text-muted">{t('admin.telegramHint')}</p>

            {/* Said plainly rather than implied by controls that quietly reach nothing:
                without a token in the environment the bot does not exist, and settings
                saved against it are preparation, not configuration. */}
            {!state.configured && (
                <p className="mb-3 flex items-start gap-2 rounded-control bg-surface-2 p-3 text-[13px] text-muted">
                    <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-no" />
                    <span>{t('admin.telegramInert')}</span>
                </p>
            )}

            {state.botName !== '' && (
                <p className="mb-3 text-[13px] text-muted">
                    <span className="latin-nums" dir="ltr">
                        @{state.botName}
                    </span>
                </p>
            )}

            <SettingRow label={t('admin.telegramBackup')} hint={t('admin.telegramBackupHint')}>
                <div className="w-28 shrink-0">
                    <Input
                        type="number"
                        label={t('admin.telegramBackup')}
                        placeholder="10"
                        dir="ltr"
                        value={minutes}
                        onInput={setMinutes}
                    />
                </div>
            </SettingRow>

            <SettingRow label={t('admin.telegramEvents')} hint={t('admin.telegramEventsHint')} divided>
                <Toggle checked={events} label={t('admin.telegramEvents')} onChange={setEvents} />
            </SettingRow>

            {!validPeriod && (
                <p className="mt-3 text-[12px] font-semibold text-no">{t('admin.telegramBackupInvalid')}</p>
            )}

            <div className="mt-4 flex justify-end">
                <Button
                    size="sm"
                    icon="check"
                    disabled={!validPeriod || !changed || busy}
                    loading={saving}
                    onClick={() => void save()}
                >
                    {t('admin.saveSettings')}
                </Button>
            </div>
        </Card>
    );
}
