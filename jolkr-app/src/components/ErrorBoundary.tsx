import { Component } from 'react';
import s from './ErrorBoundary.module.css';
import { Button } from './ui/Button';
import type { ReactNode, ErrorInfo } from 'react';

export interface ErrorBoundaryProps {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
}

const MAX_RETRIES = 3;

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      const canRetry = this.state.retryCount < MAX_RETRIES;
      return (
        <div className={s.fallback}>
          <div className={s.emoji}>:(</div>
          <h1 className={s.title}>Something went wrong</h1>
          <p className={s.message}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <div className={s.actions}>
            {canRetry ? (
              <Button onClick={() => this.setState((prev) => ({ hasError: false, error: null, retryCount: prev.retryCount + 1 }))}>
                Try Again
              </Button>
            ) : (
              <p className={s.exhausted}>Too many retries.</p>
            )}
            <button
              onClick={() => window.location.reload()}
              className={s.reloadBtn}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
