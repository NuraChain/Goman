import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

import { uploadMessage } from '../../api.ts';
import { walletFor } from '../../lib/contracts.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { useSession } from '../../stores/session.store.ts';
import { useOnchain } from '../../stores/onchain.store.ts';

import Icon from '../../icons/icon.tsx';
import Input from '../ui/input.tsx';

// Picks a file, signs the upload, and hands back the stored URI. Posted as FormData rather
// than through the typed client on purpose - the client has no multipart method, because a
// browser posts a file natively and encoding it into JSON would only make it bigger.
export default function ImageField(props: { label: string; value: string; onChange: (uri: string) => void }) {
    const { t } = useLocale();
    const session = useSession();
    const onchain = useOnchain();

    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState('');

    const input = useRef<HTMLInputElement>(null);

    const upload = async (file: File): Promise<void> => {
        setBusy(true);
        setFailure('');
        try {
            const wallet = await walletFor(session.provider(), session.address());
            const issuedAt = new Date().toISOString();
            const signature = await wallet.signMessage({
                account: session.address() as `0x${string}`,
                message: uploadMessage(issuedAt)
            });

            const body = new FormData();
            body.append('address', session.address());
            body.append('issuedAt', issuedAt);
            body.append('signature', signature);
            body.append('file', file, file.name);

            const response = await fetch('/api/uploads', { method: 'POST', body });
            const payload = (await response.json()) as { uri?: string; error?: string };
            if (!response.ok || typeof payload.uri !== 'string') {
                setFailure(payload.error ?? t('admin.uploadFailed'));
                return;
            }
            props.onChange(payload.uri);
        } catch (error) {
            onchain.narrate(error);
            setFailure(t('admin.uploadFailed'));
        } finally {
            setBusy(false);
            if (input.current !== null) {
                // Clearing it lets the SAME file be re-picked after a failure; a browser fires
                // no change event when the value is unchanged.
                input.current.value = '';
            }
        }
    };

    const pick = (event: ChangeEvent<HTMLInputElement>): void => {
        const file = event.target.files?.[0];
        if (file !== undefined) {
            void upload(file);
        }
    };

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-end gap-2">
                <div className="flex-1">
                    <Input
                        label={props.label}
                        placeholder="https://"
                        value={props.value}
                        onInput={(next) => props.onChange(next)}
                    />
                </div>
                <button
                    className="flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-control border border-line px-3.5 text-[14px] font-semibold text-muted transition-colors duration-200 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                    type="button"
                    disabled={busy}
                    aria-busy={busy}
                    onClick={() => input.current?.click()}
                >
                    {busy ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></span>
                    ) : (
                        <Icon name="deposit" size={16} />
                    )}
                    <span>{t('admin.upload')}</span>
                </button>
            </div>

            <input
                ref={input}
                className="hidden"
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                onChange={pick}
            />

            <div className="flex items-center gap-2">
                {props.value.trim() !== '' && (
                    <>
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-control bg-overlay">
                            <img className="h-full w-full object-cover" src={props.value.trim()} alt="" />
                        </span>
                        <button
                            className="cursor-pointer text-[12px] font-semibold text-muted transition-colors duration-200 hover:text-no"
                            type="button"
                            onClick={() => props.onChange('')}
                        >
                            {t('common.close')}
                        </button>
                    </>
                )}
            </div>

            {failure !== '' && <p className="text-[12px] font-semibold text-no">{failure}</p>}
            <p className="text-[12px] text-faint">{t('admin.uploadHint')}</p>
        </div>
    );
}
