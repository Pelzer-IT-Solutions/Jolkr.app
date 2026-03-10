import { Component } from 'react';
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

export default class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
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
        <div className="h-full flex flex-col items-center justify-center bg-bg text-center p-8">
          <div className="text-4xl mb-4">:(</div>
          <h1 className="text-xl font-bold text-text-primary mb-2">Something went wrong</h1>
          <p className="text-text-secondary text-sm mb-6 max-w-md">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <div className="flex gap-3">
            {canRetry ? (
              <button
                onClick={() => this.setState((prev) => ({ hasError: false, error: null, retryCount: prev.retryCount + 1 }))}
                className="px-4 py-2 btn-primary text-sm rounded-lg"
              >
                Try Again
              </button>
            ) : (
              <p className="text-text-muted text-xs">Too many retries.</p>
            )}
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-input text-text-primary text-sm rounded-lg hover:bg-input/80"
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
