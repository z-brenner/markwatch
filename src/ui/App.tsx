import { useEffect, useState } from 'react';
import { CaseStore } from '../state/store';
import { Runner } from '../state/runner';
import { ServicesContext, useCase, type AppServices } from './context';
import { SetupPage } from './pages/SetupPage';
import { DiscoverPage } from './pages/DiscoverPage';
import { TriagePage } from './pages/TriagePage';
import { DomainPage } from './pages/DomainPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { CasePage } from './pages/CasePage';
import { AboutPage } from './pages/AboutPage';
import { cx } from './components/ui';

export type Page = 'setup' | 'discover' | 'triage' | 'templates' | 'case' | 'about';
const NAV: { id: Page; label: string }[] = [
  { id: 'setup', label: '1. Setup' },
  { id: 'discover', label: '2. Discover & resolve' },
  { id: 'triage', label: '3. Triage' },
  { id: 'templates', label: 'Templates' },
  { id: 'case', label: 'Case file & audit log' },
  { id: 'about', label: 'About & privacy' },
];

export interface Nav {
  go: (p: Page) => void;
  openDomain: (d: string | null) => void;
}

export function App() {
  const [services, setServices] = useState<AppServices | null>(null);
  useEffect(() => {
    let live = true;
    void CaseStore.create().then((store) => {
      if (live) setServices({ store, runner: new Runner(store) });
    });
    return () => {
      live = false;
    };
  }, []);
  if (!services) return <p className="p-6 font-sans text-sm">Loading…</p>;
  return (
    <ServicesContext.Provider value={services}>
      <Shell />
    </ServicesContext.Provider>
  );
}

function Shell() {
  const [page, setPage] = useState<Page>('setup');
  const [domain, setDomain] = useState<string | null>(null);
  const { dirty, state } = useCase();
  const nav: Nav = {
    go: (p) => {
      setDomain(null);
      setPage(p);
    },
    openDomain: setDomain,
  };

  // Warn before closing the tab with unexported work. This is a prompt, not storage.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans text-slate-900">
      <aside className="w-60 shrink-0 border-r border-slate-200 bg-white">
        <div className="px-4 py-4">
          <h1 className="text-lg font-bold">Markwatch</h1>
          <p className="text-xs text-slate-500">Domain enforcement workbench</p>
        </div>
        <nav aria-label="Main">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => nav.go(n.id)}
              aria-current={page === n.id && !domain ? 'page' : undefined}
              className={cx('block w-full px-4 py-2 text-left text-sm hover:bg-slate-100', page === n.id && !domain && 'bg-slate-100 font-semibold')}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <div className="mt-6 px-4 text-xs text-slate-500">
          <p>{state.domains.length} domains in case</p>
          <p>{state.audit.length} audit entries</p>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div role="status" className={cx('border-b px-6 py-2 text-xs', dirty ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-600')}>
          Nothing is saved in this browser. {dirty ? 'You have unexported changes: ' : ''}
          <button type="button" className="underline" onClick={() => nav.go('case')}>
            export a case file
          </button>{' '}
          to keep your work.
        </div>
        <main className="mx-auto w-full max-w-6xl flex-1 space-y-4 p-6">
          {domain ? (
            <DomainPage domain={domain} nav={nav} />
          ) : page === 'setup' ? (
            <SetupPage nav={nav} />
          ) : page === 'discover' ? (
            <DiscoverPage nav={nav} />
          ) : page === 'triage' ? (
            <TriagePage nav={nav} />
          ) : page === 'templates' ? (
            <TemplatesPage />
          ) : page === 'case' ? (
            <CasePage />
          ) : (
            <AboutPage />
          )}
        </main>
        <footer className="border-t border-slate-200 bg-white px-6 py-2 text-xs text-slate-500">Markwatch does not give legal advice. Every draft requires attorney review before sending.</footer>
      </div>
    </div>
  );
}
