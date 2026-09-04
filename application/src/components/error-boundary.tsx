import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

// React has no hook form of this: catching a render error still requires a class. It is the
// only class component in the app, and it exists so a page that throws swaps in the error page
// instead of unmounting the tree to a blank screen.

interface Props {
    children: ReactNode;

    /** Rendered instead of the children; `reset` clears the error and retries the render. */
    fallback: (error: unknown, reset: () => void) => ReactNode;
}

interface State {
    failed: boolean;
    error: unknown;
}

export class ErrorBoundary extends Component<Props, State> {
    public override state: State = { failed: false, error: undefined };

    public static getDerivedStateFromError(error: unknown): State {
        return { failed: true, error };
    }

    public override componentDidCatch(error: unknown, info: ErrorInfo): void {
        // The reader gets the designed page; the detail goes to whoever is debugging.
        console.error('render failed', error, info.componentStack);
    }

    public override render(): ReactNode {
        if (this.state.failed) {
            return this.props.fallback(this.state.error, () => this.setState({ failed: false, error: undefined }));
        }
        return this.props.children;
    }
}
