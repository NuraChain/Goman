import { useToasts } from '../../stores/toasts.store.ts';

import ToastItem from './toast-item.tsx';

// The toast host: bottom-centered, riding above the tab bar via the shared --tabbar-h.
// pointer-events pass through the empty stack; each toast re-enables its own.
export default function Toasts() {
    const toasts = useToasts();

    return (
        <div
            className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+0.75rem)] z-[var(--z-toast)] flex flex-col items-center gap-2 px-4 lg:bottom-6"
            aria-live="polite"
        >
            {toasts.items().map((toast) => (
                <ToastItem key={toast.id} toast={toast} onDismiss={() => toasts.dismiss(toast.id)} />
            ))}
        </div>
    );
}
