import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence: if a render throws, visitors get a recovery screen
 * instead of a blank page — with a reload, and a route out of the failure.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept in the console on purpose: there is no error-reporting service wired up,
    // and silently swallowing this would make debugging impossible.
    console.error('[arcade] unhandled UI error', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="container page">
        <div className="page-state page-state--center page-state--error" role="alert">
          <h1 className="page-state__title">Something broke on this screen</h1>
          <p className="page-state__body">
            The page hit an unexpected error. Your preferences are safe — this is a display problem, not a data one.
          </p>
          <pre
            style={{
              maxWidth: '100%',
              overflowX: 'auto',
              padding: 'var(--space-3)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface)',
              fontSize: 'var(--step--2)',
              color: 'var(--text-muted)',
            }}
          >
            {error.message}
          </pre>
          <div className="section__actions">
            <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
              Reload the page
            </button>
            <a className="btn btn--secondary" href="/games">
              Go to the games library
            </a>
          </div>
        </div>
      </div>
    );
  }
}
