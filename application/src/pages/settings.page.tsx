import { useState } from 'react';

import { readSetting, writeSetting } from '../lib/storage.ts';
import { shortAddress, addressGradient } from '../lib/wallet.ts';
import { copyText } from '../lib/clipboard.ts';

import { useLocale } from '../stores/locale.store.ts';
import { usePreferences } from '../stores/preferences.store.ts';
import { useTheme } from '../stores/theme.store.ts';
import { useSession } from '../stores/session.store.ts';
import { useToasts } from '../stores/toasts.store.ts';

import { LANGS } from '../i18n/langs.ts';

import Icon from '../icons/icon.tsx';
import type { IconName } from '../icons/registry.ts';

import Card from '../components/ui/card.tsx';
import Chip from '../components/ui/chip.tsx';
import Flag from '../components/ui/flag.tsx';
import Select from '../components/ui/select.tsx';
import SettingRow from '../components/ui/setting-row.tsx';
import Toggle from '../components/ui/toggle.tsx';

// Settings: desktop = sidebar sections, mobile = a horizontal section rail. Identity is the
// wallet (there is no username/email account behind it); the preferences are real and
// persist locally.
export default function Settings() {
    const { t, lang, setLang } = useLocale();
    const { oddsMode, setOddsMode } = usePreferences();
    const appearance = useTheme();
    const session = useSession();
    const toasts = useToasts();

    const saved = (): void => {
        toasts.push('success', t('toast.saved'), 'check');
    };

    const copyAddress = async (): Promise<void> => {
        if (await copyText(session.address())) {
            toasts.push('success', t('toast.addressCopied'), 'copy');
            return;
        }
        toasts.push('error', t('toast.copyFailed'), 'alert');
    };

    const [section, setSection] = useState('account');
    const [confirmTrades, setConfirmTrades] = useState(
        (readSetting('goman.confirm-trades') ?? readSetting('auctionhouse.confirm-trades')) !== 'off'
    );
    const [pushResolve, setPushResolve] = useState(
        (readSetting('goman.push-resolve') ?? readSetting('auctionhouse.push-resolve')) !== 'off'
    );

    const sections = [
        { id: 'account', label: t('settings.account'), icon: 'settings' as IconName },
        { id: 'trading', label: t('settings.trading'), icon: 'chart' as IconName },
        { id: 'notifications', label: t('settings.notifications'), icon: 'bell' as IconName }
    ];

    return (
        <section className="shell py-5">
            <div className="mx-auto max-w-5xl">
                <h1 className="mb-5 text-2xl font-bold tracking-tight motion-safe:animate-rise">
                    {t('settings.title')}
                </h1>

                <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
                    <nav
                        className="rail rail-bleed rail-fade min-w-0 gap-2 lg:flex-col lg:gap-1"
                        aria-label={t('settings.title')}
                    >
                        {sections.map((entry) => (
                            <button
                                key={entry.id}
                                className={
                                    section === entry.id
                                        ? 'flex h-11 shrink-0 cursor-pointer items-center gap-2.5 rounded-control bg-overlay px-3.5 text-[14px] font-bold text-text lg:w-full'
                                        : 'flex h-11 shrink-0 cursor-pointer items-center gap-2.5 rounded-control px-3.5 text-[14px] font-semibold text-muted transition-colors duration-200 hover:text-text lg:w-full'
                                }
                                type="button"
                                onClick={() => setSection(entry.id)}
                            >
                                <Icon name={entry.icon} size={17} />
                                <span>{entry.label}</span>
                            </button>
                        ))}
                    </nav>

                    <div className="min-w-0">
                        {section === 'account' && (
                            <div className="grid grid-cols-1 gap-4 motion-safe:animate-fade">
                                {session.connected() && (
                                    <Card className="flex items-center gap-4">
                                        <span
                                            className="h-14 w-14 shrink-0 overflow-hidden rounded-full ring-2 ring-line"
                                            style={{ background: addressGradient(session.address()) }}
                                            aria-hidden="true"
                                        ></span>
                                        <div className="min-w-0 flex-1">
                                            <p className="nums latin-nums font-bold" dir="ltr">
                                                {shortAddress(session.address())}
                                            </p>
                                            <p className="truncate text-[13px] text-muted">{session.wallet() ?? ''}</p>
                                        </div>
                                        <button
                                            className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-control border border-line px-3 text-[13px] font-semibold text-muted transition-colors duration-200 hover:text-text"
                                            type="button"
                                            onClick={() => void copyAddress()}
                                        >
                                            <Icon name="copy" size={14} />
                                            {t('common.copy')}
                                        </button>
                                    </Card>
                                )}
                                <Card>
                                    <SettingRow wrap label={t('nav.language')}>
                                        <div className="flex flex-wrap gap-2">
                                            {LANGS.map((row) => (
                                                <span key={row.code} lang={row.code}>
                                                    <Chip
                                                        compact
                                                        selected={lang() === row.code}
                                                        onSelect={() => {
                                                            setLang(row.code);
                                                            saved();
                                                        }}
                                                    >
                                                        <Flag code={row.flag} />
                                                        {row.endonym}
                                                    </Chip>
                                                </span>
                                            ))}
                                        </div>
                                    </SettingRow>
                                    <SettingRow divided wrap label={t('nav.theme')}>
                                        <div className="flex gap-2">
                                            <Chip
                                                compact
                                                icon="moon"
                                                selected={appearance.theme() === 'dark'}
                                                onSelect={() => {
                                                    appearance.setTheme('dark');
                                                    saved();
                                                }}
                                            >
                                                {t('nav.themeDark')}
                                            </Chip>
                                            <Chip
                                                compact
                                                icon="sun"
                                                selected={appearance.theme() === 'light'}
                                                onSelect={() => {
                                                    appearance.setTheme('light');
                                                    saved();
                                                }}
                                            >
                                                {t('nav.themeLight')}
                                            </Chip>
                                        </div>
                                    </SettingRow>
                                </Card>
                            </div>
                        )}

                        {section === 'trading' && (
                            <Card animate="fade">
                                <SettingRow label={t('settings.oddsFormat')}>
                                    <Select
                                        options={[
                                            { id: 'price', label: t('settings.oddsPrice') },
                                            { id: 'percent', label: t('settings.oddsPercent') }
                                        ]}
                                        value={oddsMode()}
                                        onChange={(next) => {
                                            setOddsMode(next as 'price' | 'percent');
                                            saved();
                                        }}
                                        label={t('settings.oddsFormat')}
                                    />
                                </SettingRow>
                                <SettingRow
                                    divided
                                    label={t('settings.confirmTrades')}
                                    hint={t('settings.confirmTradesHint')}
                                >
                                    <Toggle
                                        checked={confirmTrades}
                                        label={t('settings.confirmTrades')}
                                        onChange={(next) => {
                                            setConfirmTrades(next);
                                            writeSetting('goman.confirm-trades', next ? 'on' : 'off');
                                            saved();
                                        }}
                                    />
                                </SettingRow>
                            </Card>
                        )}

                        {section === 'notifications' && (
                            <Card animate="fade">
                                <SettingRow label={t('settings.pushResolve')}>
                                    <Toggle
                                        checked={pushResolve}
                                        label={t('settings.pushResolve')}
                                        onChange={(next) => {
                                            setPushResolve(next);
                                            writeSetting('goman.push-resolve', next ? 'on' : 'off');
                                            saved();
                                        }}
                                    />
                                </SettingRow>
                            </Card>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
}
