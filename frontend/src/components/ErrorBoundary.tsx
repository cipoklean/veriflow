import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Top-level crash guard. The app must NEVER blank-screen (judges click fast):
 * any uncaught render error is caught here and rendered as a styled glass card
 * with the error message and a Reload button, instead of an empty white page.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface for debugging without taking down the UI.
    console.error('[VeriFlow] render error caught by boundary:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#06090F]/95 p-6">
          <div className="w-full max-w-md rounded-3xl border border-white/12 bg-gradient-to-b from-white/[0.07] to-white/[0.03] p-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_30px_80px_rgba(0,0,0,0.60)] backdrop-blur-2xl">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-400">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <h1 className="font-display text-xl font-semibold text-text-primary">Something broke.</h1>
            <p className="mt-2 text-sm text-text-secondary">
              An unexpected error crashed the app. Reload to continue — your funds are safe on-chain.
            </p>
            <pre className="mt-4 max-h-32 overflow-auto rounded-xl border border-white/10 bg-black/30 p-3 text-left font-mono text-xs text-red-300">
              {this.state.error.message || String(this.state.error)}
            </pre>
            <button
              onClick={() => {
                this.setState({ error: null });
                window.location.reload();
              }}
              className="btn-primary mt-6 w-full"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
