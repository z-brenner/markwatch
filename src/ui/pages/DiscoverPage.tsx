import { useMemo, useState } from 'react';
import { useCase, useRun, useServices } from '../context';
import type { Nav } from '../App';
import { Badge, Banner, Button, Card, Empty, Progress, TextArea } from '../components/ui';
import { LookupView } from '../components/LookupView';
import { parseDomainList } from '../../pipeline/deps';
import { CT_MIN_TERM } from '../../state/runner';
import { hasOpenBlock } from './TriagePage';
import type { CtEntry, LookupResult } from '../../core/types';

const PHASE_LABEL = { ns: 'Checking registration (NS)', enrich: 'Enriching registered domains (DNS + RDAP)', network: 'Looking up networks and abuse contacts', verify: 'Verifying with registry RDAP' } as const;

export function DiscoverPage({ nav }: { nav: Nav }) {
  const { store, runner } = useServices();
  const { state } = useCase();
  const run = useRun();
  const [manualText, setManualText] = useState(run.manual.join('\n'));
  const [verifyN, setVerifyN] = useState(50);

  const configured = !!state.subject.primaryDomain && state.subject.marks.length > 0;
  const stats = useMemo(() => {
    const active = state.domains.filter((d) => !d.inventory);
    const blocked = active.filter(hasOpenBlock).length;
    const unresolved = active.filter((d) => !d.lookups.some((l) => l.kind === 'dns')).length;
    const notDelegated = active.filter((d) => d.facts?.verdict === 'not_delegated').length;
    return { total: state.domains.length, active: active.length, excluded: state.domains.length - active.length, blocked, unresolved, notDelegated };
  }, [state.domains]);
  const ct = runner.ctTerms();
  const busy = run.running !== null;

  if (!configured) {
    return (
      <Card title="Discover">
        <Empty>
          Complete the setup first.{' '}
          <button type="button" className="underline" onClick={() => nav.go('setup')}>
            Go to setup
          </button>
        </Empty>
      </Card>
    );
  }

  const generate = () => {
    const parsed = parseDomainList(manualText);
    runner.setManual(parsed.valid.filter((d) => !d.startsWith('*.')));
    runner.discover();
  };
  const ld = run.lastDiscovery;

  return (
    <>
      <Card title="1. Generate candidates">
        <p className="mb-3 text-sm text-slate-600">
          Permutations of <strong>{state.subject.marks.join(', ')}</strong> on <strong>{state.subject.primaryDomain}</strong> using {state.settings.techniques.length} techniques, capped at {state.settings.cap.toLocaleString()}.
        </p>
        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium">Domains you already know about (optional)</span>
          <TextArea rows={3} value={manualText} onChange={(e) => setManualText(e.target.value)} aria-label="Known domains" placeholder="one per line" />
        </label>
        <Button variant="primary" onClick={generate} disabled={busy}>
          Generate candidates
        </Button>
        {ld && (
          <div className="mt-3 space-y-2 text-sm" data-testid="discovery-summary">
            {ld.permutation && (
              <p>
                <strong>{ld.permutation.generated.toLocaleString()}</strong> permutations generated, <strong>{ld.permutation.kept.toLocaleString()}</strong> kept
                {ld.permutation.droppedByCap > 0 && (
                  <span className="text-amber-800">, {ld.permutation.droppedByCap.toLocaleString()} dropped by the cap (lowest-priority techniques first)</span>
                )}
                .
              </p>
            )}
            {ld.invalidManual.length > 0 && <Banner level="caution">Ignored invalid entries: {ld.invalidManual.join(', ')}</Banner>}
            {ld.permutation && (
              <div className="flex flex-wrap gap-1">
                {Object.entries(ld.permutation.perTechnique).map(([t, s]) => (
                  <Badge key={t} title={`${s.generated} generated`}>
                    {t}: {s.kept}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      <Card title="2. Certificate transparency search (crt.sh)">
        {!state.settings.ctEnabled ? (
          <p className="text-sm text-slate-600">Disabled in settings.</p>
        ) : (
          <>
            <p className="mb-2 text-sm text-slate-600">
              Finds domains containing the mark in public certificate logs. crt.sh is slow and rate-limited (5 requests a minute), so searches run 12 s apart and often fail; when they do you can open the search and paste the result. Typo domains that do not contain the mark are not checked individually.
            </p>
            {ct.skipped.length > 0 && <p className="mb-2 text-xs text-amber-800">Skipped (shorter than {CT_MIN_TERM} characters; results would be unmanageable): {ct.skipped.join(', ')}</p>}
            <Button onClick={() => void runner.ctSearch()} disabled={busy || ct.terms.length === 0}>
              Search for {ct.terms.map((t) => `“${t}”`).join(', ') || '(no usable terms)'}
            </Button>
            {run.running === 'ct' && <p className="mt-2 text-sm">Searching… (this can take a minute)</p>}
            <div className="mt-3">
              {run.ct.map(({ term, result }) => (
                <LookupView
                  key={term + result.at}
                  r={result}
                  onManual={(m) => runner.applyManualCt(term, (m as LookupResult<CtEntry[]> & { status: 'manual' }).data, (m as { pastedText: string }).pastedText)}
                />
              ))}
            </div>
          </>
        )}
      </Card>

      <Card title="3. Resolve and enrich">
        <div className="mb-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-5" data-testid="resolve-stats">
          <Stat label="Domains in case" value={stats.total} />
          <Stat label="Excluded (inventory)" value={stats.excluded} />
          <Stat label="To check" value={stats.active} />
          <Stat label="Not yet resolved" value={stats.unresolved} />
          <Stat label="With blocked lookups" value={stats.blocked} tone={stats.blocked ? 'red' : undefined} />
        </div>
        <p className="mb-3 text-xs text-slate-600">
          Each lookup discloses the domain to the DNS resolver ({state.settings.primaryResolver === 'google' ? 'dns.google' : 'cloudflare-dns.com'}) or the registry that answers it. Unregistered candidates cost one DNS query; registered ones get full enrichment.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void runner.resolve(false)} disabled={busy || stats.active === 0}>
            Resolve {stats.unresolved.toLocaleString()} unresolved domain(s)
          </Button>
          <Button onClick={() => void runner.resolve(true)} disabled={busy || stats.blocked === 0}>
            Retry blocked lookups
          </Button>
          {busy && (
            <Button variant="danger" onClick={() => runner.cancel()}>
              Cancel
            </Button>
          )}
        </div>
        {run.progress && run.running && (
          <div className="mt-3">
            <Progress done={run.progress.done} total={run.progress.total} label={PHASE_LABEL[run.progress.phase]} />
          </div>
        )}
        {run.error && <Banner level="danger">{run.error}</Banner>}
        <div className="mt-4 border-t border-slate-200 pt-3 text-sm">
          <p className="mb-2">
            <strong>{stats.notDelegated}</strong> candidate(s) are not delegated in DNS. That is not proof they are unregistered: domains on hold or without nameservers are absent from DNS. Registry RDAP settles it, but registries forbid bulk querying, so verify only the top-scoring ones.
          </p>
          <div className="flex items-center gap-2">
            <input type="number" min={1} max={500} value={verifyN} onChange={(e) => setVerifyN(Number(e.target.value))} className="w-20 rounded border border-slate-300 px-2 py-1 text-sm" aria-label="How many to verify" />
            <Button onClick={() => void runner.verifyTop(verifyN)} disabled={busy || stats.notDelegated === 0}>
              Verify top {verifyN} with RDAP
            </Button>
          </div>
        </div>
      </Card>
      <div>
        <Button variant="primary" onClick={() => nav.go('triage')}>
          Go to triage →
        </Button>
      </div>
      {store.state.domains.length === 0 && <p className="text-xs text-slate-500">No domains yet. Generate candidates above.</p>}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'red' }) {
  return (
    <div className="rounded border border-slate-200 p-2">
      <div className={tone === 'red' ? 'text-lg font-semibold text-red-700' : 'text-lg font-semibold'}>{value.toLocaleString()}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
