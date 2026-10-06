import { useMemo, useState } from 'react';
import { useCase, useServices } from '../context';
import type { Nav } from '../App';
import { Badge, Banner, Button, Card, Checkbox, Empty, ExternalLink, Input, Mono, Select } from '../components/ui';
import { LookupView } from '../components/LookupView';
import { DraftEditor } from './DraftEditor';
import { VERDICT_LABEL } from './TriagePage';
import { routeFor, effectiveTemplates } from '../../core/route/route';
import { readFileBytes } from '../download';
import { CLASSIFICATION_LABELS, CLASSIFICATIONS, type Classification, type DomainRecord, type LookupResult, type Route } from '../../core/types';

export function DomainPage({ domain, nav }: { domain: string; nav: Nav }) {
  const { state } = useCase();
  const rec = state.domains.find((d) => d.domain === domain);
  if (!rec) {
    return (
      <Card title="Domain not found">
        <Button onClick={() => nav.openDomain(null)}>← Back</Button>
      </Card>
    );
  }
  return <DomainDetail rec={rec} nav={nav} />;
}

function earliestRights(dates: (string | undefined)[]): string | undefined {
  const valid = dates.filter((d): d is string => !!d && !Number.isNaN(Date.parse(d))).sort();
  return valid[0];
}

function DomainDetail({ rec, nav }: { rec: DomainRecord; nav: Nav }) {
  const { store } = useServices();
  const { state } = useCase();
  const f = rec.facts;
  const v = VERDICT_LABEL[f?.verdict ?? 'unknown'];
  const route: Route | null = useMemo(() => {
    if (!rec.classification) return null;
    const rights = earliestRights(state.subject.rights.map((r) => r.firstUse));
    return routeFor(rec.classification.value, {
      domain: rec.domain,
      ...(f ? { facts: f } : {}),
      ...(rec.inventory ? { inventory: rec.inventory } : {}),
      ...(rights ? { earliestRightsDate: rights } : {}),
    });
  }, [rec, f, state.subject.rights]);

  const onManual = (m: LookupResult<unknown>) => {
    // A pasted result answers the same question for every domain that asked it.
    const sharers = state.domains.filter((d) => d.lookups.some((l) => l.kind === m.kind && l.query === m.query)).map((d) => d.domain);
    store.recordLookup(sharers.length ? sharers : [rec.domain], m, 'user');
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => nav.openDomain(null)}>
          ← Back to triage
        </Button>
      </div>
      <Card
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-base">{rec.unicode}</span>
            {rec.unicode !== rec.domain && <Mono>{rec.domain}</Mono>}
            <Badge tone={v.tone}>{v.label}</Badge>
            {rec.inventory && <Badge tone="purple">{rec.inventory.kind === 'owned' ? 'Owned' : `Authorized${rec.inventory.party ? `: ${rec.inventory.party}` : ''}`}</Badge>}
          </span>
        }
      >
        <p className="text-sm text-slate-700">{f?.verdictReason ?? 'Not resolved yet.'}</p>
        {rec.registrable !== rec.domain && <p className="mt-1 text-xs text-slate-600">Registrable domain: {rec.registrable}. Acting on this name means acting on {rec.registrable}.</p>}
        <p className="mt-1 text-xs text-slate-500">Found by: {[...rec.techniques, ...rec.sources.filter((s) => s !== 'permutation')].join(', ') || '—'}</p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Score: ${rec.score?.total ?? 0}`}>
          {rec.score?.items.length ? (
            <ul className="space-y-1 text-sm" data-testid="score-items">
              {rec.score.items.map((i) => (
                <li key={i.ruleId} className="flex gap-2">
                  <span className={i.points >= 0 ? 'w-10 shrink-0 font-semibold tabular-nums text-red-700' : 'w-10 shrink-0 font-semibold tabular-nums text-emerald-700'}>
                    {i.points > 0 ? '+' : ''}
                    {i.points}
                  </span>
                  <span>{i.reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No scoring signals.</p>
          )}
          <p className="mt-2 text-xs text-slate-500">A score only ranks domains for review. You decide the classification. Rules: src/config/scoring.rules.ts (version {rec.score?.rulesetVersion}).</p>
        </Card>
        <Classifier rec={rec} />
      </div>

      {route && <RouteCard rec={rec} route={route} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="DNS">
          {f ? (
            <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1 text-sm">
              <dt className="text-slate-500">NS</dt>
              <dd>{f.ns.join(', ') || '—'}</dd>
              <dt className="text-slate-500">A / AAAA</dt>
              <dd>{[...f.a, ...f.aaaa].join(', ') || '— (no website records)'}</dd>
              <dt className="text-slate-500">MX</dt>
              <dd>{f.mx.join(', ') || '—'}</dd>
              <dt className="text-slate-500">TXT</dt>
              <dd className="break-all text-xs">{f.txt.join(' | ') || '—'}</dd>
              <dt className="text-slate-500">Wildcard</dt>
              <dd>{f.wildcard === undefined ? 'not checked' : f.wildcard ? 'yes' : 'no'}</dd>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">Not resolved.</p>
          )}
          <p className="mt-2 text-xs text-slate-500">“Has a website” here means only that A/AAAA records exist. Markwatch cannot load web pages from the browser.</p>
        </Card>
        <Card title="Registration (RDAP)">
          {f?.rdap ? (
            <dl className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1 text-sm">
              <dt className="text-slate-500">Registrar</dt>
              <dd>
                {f.rdap.registrar?.name ?? '—'} {f.rdap.registrar?.ianaId && <span className="text-xs text-slate-500">IANA {f.rdap.registrar.ianaId}</span>}
              </dd>
              <dt className="text-slate-500">Abuse contact</dt>
              <dd>{[...(f.rdap.registrar?.abuseEmail ?? []), ...(f.rdap.registrar?.abuseTel ?? [])].join(', ') || '—'}</dd>
              <dt className="text-slate-500">Created</dt>
              <dd>{f.rdap.registered ?? '—'}</dd>
              <dt className="text-slate-500">Expires</dt>
              <dd>{f.rdap.expires ?? '—'}</dd>
              <dt className="text-slate-500">Status</dt>
              <dd className="text-xs">{f.rdap.status.join(', ') || '—'}</dd>
              <dt className="text-slate-500">Registrant</dt>
              <dd className="text-xs">{f.rdap.registrant ? (f.rdap.registrant.redacted ? 'Redacted' : [f.rdap.registrant.org, f.rdap.registrant.name, f.rdap.registrant.country].filter(Boolean).join(', ')) : '—'}</dd>
              <dt className="text-slate-500">Source</dt>
              <dd className="text-xs">{f.rdap.server}</dd>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">No RDAP data. Check the lookups below: it may have been blocked or the TLD has no RDAP service.</p>
          )}
        </Card>
        <Card title="Hosting and providers">
          {f && (Object.keys(f.networks).length > 0 || f.providers.length > 0) ? (
            <div className="space-y-2 text-sm">
              {Object.entries(f.networks).map(([ip, n]) => (
                <div key={ip}>
                  <Mono>{ip}</Mono> → {n.org ?? n.name ?? 'unknown network'} {n.country && `(${n.country})`}
                  <div className="text-xs text-slate-600">
                    Abuse: {n.abuseEmail.join(', ') || '—'} · {n.server}
                  </div>
                  {f.abusix[ip]?.length ? <div className="text-xs text-slate-600">Abusix: {f.abusix[ip].join(', ')}</div> : null}
                </div>
              ))}
              {f.providers.map((p) => (
                <div key={p.id + p.role} className="text-xs">
                  <Badge>{p.role}</Badge> {p.name}: <span className="text-slate-500">{p.evidence}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No hosting data.</p>
          )}
        </Card>
        <Card title={`Certificates (${f?.ct.length ?? 0})`}>
          {f?.ct.length ? (
            <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
              {f.ct.slice(0, 50).map((c) => (
                <li key={c.id}>
                  {c.notBefore.slice(0, 10)} · {c.commonName} · <span className="text-slate-500">{c.issuer}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">None found, or not searched. Only domains containing the mark are searched in certificate logs.</p>
          )}
        </Card>
      </div>

      <Evidence rec={rec} />

      <Card title={`Lookups (${rec.lookups.length})`}>
        {rec.lookups.length ? [...rec.lookups].reverse().map((l, i) => <LookupView key={`${l.at}-${i}`} r={l} onManual={onManual} />) : <Empty>No lookups yet.</Empty>}
      </Card>
    </>
  );
}

function Classifier({ rec }: { rec: DomainRecord }) {
  const { store } = useServices();
  const [value, setValue] = useState<Classification | ''>(rec.classification?.value ?? '');
  const [note, setNote] = useState(rec.classification?.note ?? '');
  return (
    <Card title="Classification">
      <p className="mb-2 text-xs text-slate-600">Your judgment, recorded in the audit log. Markwatch never classifies automatically.</p>
      <Select value={value} onChange={(e) => setValue(e.target.value as Classification | '')} aria-label="Classification">
        <option value="">— choose —</option>
        {CLASSIFICATIONS.map((c) => (
          <option key={c} value={c}>
            {CLASSIFICATION_LABELS[c]}
          </option>
        ))}
      </Select>
      <Input className="mt-2" placeholder="Note (why)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Classification note" />
      <div className="mt-2 flex gap-2">
        <Button variant="primary" disabled={!value} onClick={() => value && store.classify(rec.domain, value, note.trim() || undefined)}>
          Save classification
        </Button>
        {rec.classification && <Button onClick={() => (store.clearClassification(rec.domain), setValue(''), setNote(''))}>Clear</Button>}
      </div>
      {rec.classification && (
        <p className="mt-2 text-xs text-slate-500">
          Saved {rec.classification.at}: {CLASSIFICATION_LABELS[rec.classification.value]}
        </p>
      )}
    </Card>
  );
}

function RouteCard({ rec, route }: { rec: DomainRecord; route: Route }) {
  const { store } = useServices();
  const { templates } = useCase();
  const [openDraft, setOpenDraft] = useState<string | null>(null);
  const allowed = effectiveTemplates(route, rec.acks);
  const acked = route.requiresAck && rec.acks.some((a) => a.id === route.requiresAck?.id);
  const tplTitle = (id: string) => templates.find((t) => t.id === id)?.title ?? id;

  const startDraft = (templateId: string) => {
    const d = store.createDraft(rec.domain, templateId);
    setOpenDraft(d.id);
  };

  return (
    <Card title={`Recommended route: ${route.headline}`}>
      <div className="space-y-2" data-testid="route-warnings">
        {route.warnings
          .filter((w) => !(w.dismissible && rec.dismissedWarnings.includes(w.id)))
          .map((w) => (
            <Banner key={w.id} level={w.level} {...(w.dismissible ? { onDismiss: () => store.dismissWarning(rec.domain, w.id) } : {})}>
              {w.text}
            </Banner>
          ))}
      </div>
      <h3 className="mt-3 text-sm font-semibold">Why</h3>
      <ul className="list-disc pl-5 text-sm text-slate-700">
        {route.why.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      {route.requiresAck && (
        <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3">
          <Checkbox label={route.requiresAck.text} checked={!!acked} disabled={!!acked} onChange={(c) => c && store.recordAck(rec.domain, route.requiresAck!.id, route.requiresAck!.text)} />
          {!acked && <p className="mt-1 text-xs text-amber-900">Outbound templates stay locked until this is recorded. The acknowledgment goes in the audit log.</p>}
        </div>
      )}
      <h3 className="mt-3 text-sm font-semibold">Steps</h3>
      <ol className="space-y-3">
        {route.steps.map((s, i) => (
          <li key={s.id} className="rounded border border-slate-200 p-3 text-sm">
            <div className="font-medium">
              {i + 1}. {s.title}
            </div>
            <p className="text-slate-700">{s.explanation}</p>
            {s.contacts.map((c) => (
              <div key={c.label + c.source} className="mt-1 text-xs">
                <span className="font-medium">{c.label}</span>
                {c.email.length > 0 && <>: {c.email.join(', ')}</>}
                {c.url && (
                  <>
                    {' '}
                    · <ExternalLink href={c.url}>web form</ExternalLink>
                  </>
                )}
                <div className="text-slate-500">Source: {c.source}</div>
              </div>
            ))}
            <div className="mt-2 flex flex-wrap gap-2">
              {s.templates.map((t) =>
                allowed.includes(t) ? (
                  <Button key={t} onClick={() => startDraft(t)}>
                    Draft: {tplTitle(t)}
                  </Button>
                ) : (
                  <Button key={t} disabled title="Locked until the acknowledgment above is recorded">
                    🔒 {tplTitle(t)}
                  </Button>
                ),
              )}
            </div>
          </li>
        ))}
      </ol>
      {route.escalations.length > 0 && (
        <>
          <h3 className="mt-3 text-sm font-semibold">Escalation options</h3>
          <ul className="space-y-1 text-sm">
            {route.escalations.map((e) => (
              <li key={e.id}>
                <Badge tone={e.available ? 'blue' : 'gray'}>{e.available ? 'available' : 'not available'}</Badge> <strong>{e.title}</strong>: {e.explanation}
                {e.note && <div className="text-xs text-slate-500">{e.note}</div>}
              </li>
            ))}
          </ul>
        </>
      )}
      {rec.drafts.length > 0 && (
        <>
          <h3 className="mt-4 text-sm font-semibold">Drafts</h3>
          <div className="mt-1 flex flex-wrap gap-2">
            {rec.drafts.map((d) => (
              <Button key={d.id} variant={openDraft === d.id ? 'primary' : 'secondary'} onClick={() => setOpenDraft(openDraft === d.id ? null : d.id)}>
                {tplTitle(d.templateId)} · {d.createdAt.slice(0, 16)}Z{d.exports.length ? ` · exported ×${d.exports.length}` : ''}
              </Button>
            ))}
          </div>
        </>
      )}
      {openDraft && rec.drafts.find((d) => d.id === openDraft) && (
        <div className="mt-3">
          <DraftEditor rec={rec} draft={rec.drafts.find((d) => d.id === openDraft)!} route={route} allowed={allowed} />
        </div>
      )}
    </Card>
  );
}

function Evidence({ rec }: { rec: DomainRecord }) {
  const { store } = useServices();
  const { state } = useCase();
  const [busy, setBusy] = useState(false);
  const files = state.evidence.filter((e) => rec.evidence.includes(e.sha256));
  return (
    <Card title={`Evidence (${files.length})`}>
      <p className="mb-2 text-xs text-slate-600">Attach screenshots, saved pages or other files. Each one is hashed (SHA-256) and logged. Files stay in memory and leave only inside an exported case file.</p>
      <label className="inline-block cursor-pointer rounded border border-slate-300 px-3 py-1.5 text-sm">
        {busy ? 'Hashing…' : 'Attach files'}
        <input
          type="file"
          multiple
          className="sr-only"
          aria-label="Attach evidence"
          onChange={(e) => {
            const list = [...(e.target.files ?? [])];
            e.target.value = '';
            setBusy(true);
            void (async () => {
              for (const fl of list) await store.addEvidence({ name: fl.name, type: fl.type, bytes: await readFileBytes(fl) }, [rec.domain]);
              setBusy(false);
            })();
          }}
        />
      </label>
      <ul className="mt-2 space-y-1 text-sm">
        {files.map((e) => (
          <li key={e.sha256} className="flex items-center justify-between gap-2">
            <span>
              {e.name} <span className="text-xs text-slate-500">({e.bytes.toLocaleString()} bytes, added {e.addedAt})</span>
              <div className="font-mono text-xs text-slate-500">SHA-256 {e.sha256}</div>
            </span>
            <Button variant="ghost" onClick={() => store.removeEvidence(e.sha256)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
