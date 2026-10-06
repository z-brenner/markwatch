import { useMemo, useState } from 'react';
import { useCase } from '../context';
import type { Nav } from '../App';
import { Badge, Button, Card, Empty, Input, Select } from '../components/ui';
import { CLASSIFICATION_LABELS, CLASSIFICATIONS, type DomainRecord, type RegistrationVerdict } from '../../core/types';

export const VERDICT_LABEL: Record<RegistrationVerdict, { label: string; tone: 'green' | 'red' | 'amber' | 'gray' | 'blue' }> = {
  registered: { label: 'Registered', tone: 'red' },
  registered_broken_dns: { label: 'Registered (DNS failing)', tone: 'red' },
  probably_unregistered: { label: 'Probably unregistered', tone: 'gray' },
  not_delegated: { label: 'Not in DNS (unverified)', tone: 'amber' },
  available: { label: 'Available (RDAP 404)', tone: 'green' },
  blocked: { label: 'Lookup blocked', tone: 'amber' },
  unknown: { label: 'Unknown / not checked', tone: 'gray' },
};

const PAGE = 200;

/** True if the latest attempt of some lookup is still blocked (a later answer clears it). */
export function hasOpenBlock(d: DomainRecord): boolean {
  const latest = new Map<string, DomainRecord['lookups'][number]>();
  for (const l of d.lookups) latest.set(`${l.kind}\u0000${l.query}`, l);
  return [...latest.values()].some((l) => l.status === 'blocked' && l.reason !== 'unsupported' && l.reason !== 'cancelled');
}

type VerdictFilter = 'all' | 'registered' | 'needs_attention' | RegistrationVerdict;

export function TriagePage({ nav }: { nav: Nav }) {
  const { state } = useCase();
  const [q, setQ] = useState('');
  const [verdict, setVerdict] = useState<VerdictFilter>('registered');
  const [cls, setCls] = useState<'all' | 'unclassified' | (typeof CLASSIFICATIONS)[number]>('all');
  const [showInventory, setShowInventory] = useState(false);
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return state.domains
      .filter((d) => showInventory || !d.inventory)
      .filter((d) => !needle || d.domain.includes(needle) || d.unicode.includes(needle))
      .filter((d) => {
        const v = d.facts?.verdict ?? 'unknown';
        if (verdict === 'all') return true;
        if (verdict === 'registered') return v === 'registered' || v === 'registered_broken_dns';
        if (verdict === 'needs_attention') return v === 'blocked' || v === 'not_delegated' || v === 'unknown';
        return v === verdict;
      })
      .filter((d) => (cls === 'all' ? true : cls === 'unclassified' ? !d.classification : d.classification?.value === cls))
      .sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0) || a.domain.localeCompare(b.domain));
  }, [state.domains, q, verdict, cls, showInventory]);

  const pageRows = rows.slice(page * PAGE, (page + 1) * PAGE);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));

  return (
    <Card title={`Triage (${rows.length.toLocaleString()} shown)`}>
      <div className="mb-3 grid gap-2 md:grid-cols-4">
        <Input placeholder="Search domains" value={q} onChange={(e) => (setQ(e.target.value), setPage(0))} aria-label="Search domains" />
        <Select value={verdict} onChange={(e) => (setVerdict(e.target.value as VerdictFilter), setPage(0))} aria-label="Registration filter">
          <option value="registered">Registered</option>
          <option value="needs_attention">Needs attention (blocked / unverified / unchecked)</option>
          <option value="all">All</option>
          {Object.entries(VERDICT_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        <Select value={cls} onChange={(e) => (setCls(e.target.value as typeof cls), setPage(0))} aria-label="Classification filter">
          <option value="all">Any classification</option>
          <option value="unclassified">Unclassified</option>
          {CLASSIFICATIONS.map((c) => (
            <option key={c} value={c}>
              {CLASSIFICATION_LABELS[c]}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showInventory} onChange={(e) => setShowInventory(e.target.checked)} /> Show owned / authorized
        </label>
      </div>
      {rows.length === 0 ? (
        <Empty>No domains match. {state.domains.length === 0 && 'Generate and resolve candidates first.'}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="triage-table">
            <thead className="border-b border-slate-200 text-xs text-slate-500">
              <tr>
                <th className="py-2 pr-2">Score</th>
                <th className="pr-2">Domain</th>
                <th className="pr-2">Status</th>
                <th className="pr-2">Registrar / host</th>
                <th className="pr-2">Found by</th>
                <th className="pr-2">Classification</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((d) => (
                <Row key={d.domain} d={d} onOpen={() => nav.openDomain(d.domain)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <Button disabled={page === 0} onClick={() => setPage(page - 1)}>
            ← Prev
          </Button>
          <span>
            Page {page + 1} of {pages}
          </span>
          <Button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            Next →
          </Button>
        </div>
      )}
    </Card>
  );
}

function Row({ d, onOpen }: { d: DomainRecord; onOpen: () => void }) {
  const v = VERDICT_LABEL[d.facts?.verdict ?? 'unknown'];
  const host = d.facts?.providers.find((p) => p.role === 'cdn' || p.role === 'web')?.name ?? Object.values(d.facts?.networks ?? {})[0]?.org;
  const blocked = hasOpenBlock(d);
  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50">
      <td className="py-2 pr-2 font-semibold tabular-nums" title={d.score?.items.map((i) => `${i.points > 0 ? '+' : ''}${i.points} ${i.reason}`).join('\n')}>
        {d.score?.total ?? 0}
      </td>
      <td className="pr-2">
        <button type="button" onClick={onOpen} className="text-left text-sky-700 underline">
          {d.unicode}
        </button>
        {d.unicode !== d.domain && <div className="font-mono text-xs text-slate-500">{d.domain}</div>}
        {d.inventory && (
          <div>
            <Badge tone="purple">{d.inventory.kind === 'owned' ? 'Owned' : `Authorized${d.inventory.party ? `: ${d.inventory.party}` : ''}`}</Badge>
          </div>
        )}
      </td>
      <td className="pr-2">
        <Badge tone={v.tone}>{v.label}</Badge> {blocked && <Badge tone="amber">has blocked lookups</Badge>}
      </td>
      <td className="pr-2 text-xs">
        {d.facts?.rdap?.registrar?.name ?? '—'}
        {host && <div className="text-slate-500">{host}</div>}
      </td>
      <td className="pr-2 text-xs">{[...d.techniques.filter((t) => t !== 'original'), ...d.sources.filter((s) => s !== 'permutation')].join(', ') || 'original'}</td>
      <td className="pr-2 text-xs">{d.classification ? CLASSIFICATION_LABELS[d.classification.value] : <span className="text-slate-400">—</span>}</td>
    </tr>
  );
}
