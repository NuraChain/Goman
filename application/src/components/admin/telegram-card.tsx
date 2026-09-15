import { useEffect, useRef, useState } from 'react';

import { shortAddress } from '../../lib/wallet.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { useAdmin } from '../../stores/admin.store.ts';
import { useOnchain } from '../../stores/onchain.store.ts';

import Icon from '../../icons/icon.tsx';

import { faDigits } from '../../i18n/format.ts';

import Badge from '../ui/badge.tsx';
import Button from '../ui/button.tsx';
import Card from '../ui/card.tsx';
import Input from '../ui/input.tsx';
import SettingRow from '../ui/setting-row.tsx';
import Skeleton from '../ui/skeleton.tsx';
import Toggle from '../ui/toggle.tsx';

/** A Telegram user id is numeric. Anything else - an @name, a link - admits nobody. */
const ID_RE = /^[0-9]{1,20}$/;

// The bot's settings and the list of people who may command it.
//
// Two of these used to be environment variables, which meant a redeploy to change a number
// nobody should need a deploy to change. They live in the database now and are applied to the
// RUNNING service on save, so the next backup honours a new interval rather than the next boot.
//
// The allowlist is the security-bearing half of the tab. The bot is a public endpoint: anyone
// who finds its @name can message it, and /help and /myid answer anyone, because that is how
// a prospective proposer finds the id an admin needs. Nothing else runs without a seat here.
// The seat is keyed on the numeric id and not the @username, and the input enforces that - a
// username can be released and re-registered by somebody else, and an allowlist that quietly
// drifts to a stranger is the whole risk this table exists to avoid.
export default function TelegramCard() {
    const { t, lang } = useLocale();
    const admin = useAdmin();
    const onchain = useOnchain();

    const state = admin.telegram.data();

    const [minutes, setMinutes] = useState('');
    const [events, setEvents] = useState(true);
    const [newId, setNewId] = useState('');
    const [newName, setNewName] = useState('');
    const [saving, setSaving] = useState(false);
    const [adding, setAdding] = useState(false);
    const [removing, setRemoving] = useState('');

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

    /** Counts in the reader's own digits; ids stay Latin, because Telegram's are. */
    const count = (value: number): string => (lang() === 'fa' ? faDigits(String(value)) : String(value));

    const period = Number(minutes);
    const validPeriod = Number.isInteger(period) && period >= 1 && period <= 10080;
    const changed =
        state !== undefined && (period !== state.settings.backupMinutes || events !== state.settings.events);

    const idValid = ID_RE.test(newId.trim());
    const busy = saving || adding || removing !== '' || onchain.pending();

    const save = async (): Promise<void> => {
        if (!validPeriod) {
            return;
        }
        setSaving(true);
        await admin.saveTelegramSettings({ backupMinutes: period, events });
        setSaving(false);
    };

    const add = async (): Promise<void> => {
        if (!idValid) {
            return;
        }
        setAdding(true);
        if (await admin.addTelegramAdmin(newId.trim(), newName)) {
            setNewId('');
            setNewName('');
        }
        setAdding(false);
    };

    const remove = async (id: string): Promise<void> => {
        setRemoving(id);
        await admin.removeTelegramAdmin(id);
        setRemoving('');
    };

    if (state === undefined) {
        return (
            <Card>
                <Skeleton className="h-48 rounded-control" />
            </Card>
        );
    }

    return (
        <div className="flex flex-col gap-6">
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

            <Card>
                <h2 className="mb-1 text-lg font-bold tracking-tight">{t('admin.botAdminsTitle')}</h2>
                <p className="mb-3 text-[13px] text-muted">{t('admin.botAdminsHint')}</p>

                {state.admins.length === 0 ? (
                    <p className="mb-3 text-[13px] text-muted">{t('admin.botAdminsEmpty')}</p>
                ) : (
                    <ul className="mb-3 flex flex-col gap-1.5">
                        {state.admins.map((entry) => (
                            <li key={entry.id} className="flex items-center gap-2 text-[13px]">
                                <Icon name="user" size={14} className="shrink-0 text-faint" />
                                <span className="nums latin-nums shrink-0 text-muted" dir="ltr">
                                    {entry.id}
                                </span>
                                {entry.username !== '' && (
                                    <span className="min-w-0 flex-1 truncate" dir="ltr">
                                        @{entry.username}
                                    </span>
                                )}
                                {entry.username === '' && <span className="min-w-0 flex-1"></span>}
                                {entry.addedBy !== '' && (
                                    <Badge>
                                        <span className="latin-nums" dir="ltr">
                                            {shortAddress(entry.addedBy)}
                                        </span>
                                    </Badge>
                                )}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    icon="trash"
                                    label={t('admin.botAdminRemove')}
                                    disabled={busy}
                                    loading={removing === entry.id}
                                    onClick={() => void remove(entry.id)}
                                />
                            </li>
                        ))}
                    </ul>
                )}

                <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
                    <div className="min-w-32 flex-1">
                        <Input
                            label={t('admin.botAdminId')}
                            placeholder="123456789"
                            dir="ltr"
                            value={newId}
                            onInput={setNewId}
                        />
                    </div>
                    <div className="min-w-32 flex-1">
                        <Input
                            label={t('admin.botAdminName')}
                            placeholder="@name"
                            dir="ltr"
                            value={newName}
                            onInput={setNewName}
                        />
                    </div>
                    <Button
                        size="sm"
                        icon="plus"
                        disabled={!idValid || busy}
                        loading={adding}
                        onClick={() => void add()}
                    >
                        {t('admin.botAdminAdd')}
                    </Button>
                </div>

                {newId.trim() !== '' && !idValid && (
                    <p className="mt-2 text-[12px] font-semibold text-no">{t('admin.botAdminIdInvalid')}</p>
                )}

                <p className="mt-3 text-[12px] text-muted">
                    <span className="nums">{count(state.admins.length)}</span> {t('admin.botAdminsCount')}
                </p>
            </Card>
        </div>
    );
}
