// Last line of defence: if rendering throws (for example on unexpected data),
// show the error and still let the user export the case, which lives in the
// store and is unaffected by the render failure.
import { Component, type ReactNode } from 'react';
import type { CaseStore } from '../state/store';
import { downloadBytes } from './download';

interface Props {
  store: CaseStore;
  children: ReactNode;
}

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  private exportNow = async () => {
    const { bytes, fileName } = await this.props.store.exportCase();
    downloadBytes(fileName, new Uint8Array(bytes), 'application/zip');
  };

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="m-6 space-y-3 rounded border border-red-300 bg-red-50 p-4 font-sans text-sm text-red-900">
        <p className="font-semibold">Something went wrong while displaying this page.</p>
        <p className="font-mono text-xs">{this.state.error.message}</p>
        <p>Your case is still in memory. Export it now so nothing is lost, then reload.</p>
        <div className="flex gap-2">
          <button type="button" className="rounded bg-red-700 px-3 py-1.5 text-white" onClick={() => void this.exportNow()}>
            Export case file
          </button>
          <button type="button" className="rounded border border-red-300 px-3 py-1.5" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      </div>
    );
  }
}
