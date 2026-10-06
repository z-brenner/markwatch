// Draft editor. The merged text is read-only: all changes go through merge
// fields, so unfilled-field detection cannot be bypassed by editing prose.
// Every export path stays disabled until each unfilled field is filled or
// dismissed with a reason. Nothing is ever sent from here.
import { useMemo, useState } from 'react';
import { useCase, useServices } from '../context';
import { Banner, Button, Input, Badge } from '../components/ui';
import { buildDraftContext, buildEml, buildMailto, renderTemplate, BANNER } from '../../core/draft';
import { renderForExport } from '../../core/draft/export';
import { downloadBytes } from '../download';
import type { DomainRecord, DraftRecord, Route } from '../../core/types';

export function DraftEditor({ rec, draft, route, allowed }: { rec: DomainRecord; draft: DraftRecord; route: Route; allowed: string[] }) {
  const { store } = useServices();
  const { state, templates } = useCase();
  const tpl = templates.find((t) => t.id === draft.templateId);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [attach, setAttach] = useState(false);
  const [notice, setNotice] = useState('');

  const rendered = useMemo(() => {
    if (!tpl) return null;
    const ctx = buildDraftContext(state, rec, { route });
    const dismissedPaths = draft.dismissed.map((d) => d.field);
    // Preview shows internal notes; exports are rendered from the template with notes removed.
    return { result: renderTemplate(tpl, ctx, draft.values, dismissedPaths), out: renderForExport(tpl, ctx, draft.values, dismissedPaths) };
  }, [tpl, state, rec, route, draft.values, draft.dismissed]);
  const result = rendered?.result;

  if (!tpl || !result) return <Banner level="danger">Template “{draft.templateId}” is not loaded. Import it on the Templates page.</Banner>;
  const out = rendered.out;
  const locked = !allowed.includes(draft.templateId);
  const blocking = result.blocking || locked || out.leak;
  const dismissedFields = draft.dismissed.map((d) => d.field);

  const setValue = (path: string, value: string) => store.updateDraft(rec.domain, draft.id, (d) => ({ ...d, values: { ...d.values, [path]: value } }));

  const exportEml = async () => {
    const attachments = attach
      ? rec.evidence.flatMap((sha) => {
          const meta = state.evidence.find((e) => e.sha256 === sha);
          const bytes = store.evidenceBytes(sha);
          return meta && bytes ? [{ name: meta.name, type: meta.type, data: bytes }] : [];
        })
      : [];
    const eml = buildEml({ ...(state.sender.email ? { from: state.sender.email } : {}), to: out.to, subject: out.subject, body: out.text, date: new Date(), attachments });
    downloadBytes(`${tpl.id}-${rec.domain}.eml`, eml, 'message/rfc822');
    await store.recordDraftExport(rec.domain, draft.id, 'eml', out.text, tpl.id, dismissedFields);
    setNotice('Downloaded .eml draft. Open it in your mail client; Outlook opens it as an unsent draft. Nothing was sent.');
  };
  const exportTxt = async () => {
    downloadBytes(`${tpl.id}-${rec.domain}.txt`, out.text, 'text/plain;charset=utf-8');
    await store.recordDraftExport(rec.domain, draft.id, 'txt', out.text, tpl.id, dismissedFields);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(out.text);
    } catch {
      setNotice('The browser refused clipboard access. Use Download .txt instead.');
      return;
    }
    await store.recordDraftExport(rec.domain, draft.id, 'copy', out.text, tpl.id, dismissedFields);
    setNotice('Copied to the clipboard. Note: your system clipboard may keep a history.');
  };
  const mailto = buildMailto({ to: out.to, subject: out.subject, body: out.text });

  return (
    <div className="rounded border border-slate-300 bg-slate-50 p-3" data-testid="draft-editor">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{tpl.title}</h3>
        <Badge>{tpl.channel}</Badge>
        {!tpl.builtin && <Badge tone="purple">imported template</Badge>}
        {result.unfilled.length > 0 ? <Badge tone="red">{result.unfilled.length} unfilled</Badge> : <Badge tone="green">all fields filled or dismissed</Badge>}
      </div>
      {locked && <Banner level="danger">This template is locked for this classification until the required acknowledgment is recorded.</Banner>}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase text-slate-500">Fields</h4>
          {result.fields.map((fs) => (
            <div key={fs.path} className="rounded border border-slate-200 bg-white p-2 text-xs" data-testid="draft-field" data-state={fs.state}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono">{fs.path}</span>
                <Badge tone={fs.state === 'filled' ? 'green' : fs.state === 'dismissed' ? 'gray' : 'red'}>{fs.state}</Badge>
              </div>
              {fs.hint && <div className="text-slate-500">{fs.hint}</div>}
              {fs.source && <div className="text-slate-500">Source: {fs.source}</div>}
              {fs.state !== 'dismissed' && (
                <Input
                  className="mt-1"
                  aria-label={`Value for ${fs.path}`}
                  placeholder={fs.state === 'filled' && !fs.userSupplied ? `(from lookup) ${fs.value ?? ''}` : 'Enter a value'}
                  value={draft.values[fs.path] ?? ''}
                  onChange={(e) => setValue(fs.path, e.target.value)}
                />
              )}
              {fs.state === 'unfilled' &&
                (dismissing === fs.path ? (
                  <div className="mt-1 flex gap-1">
                    <Input placeholder="Reason for leaving it out" value={reason} onChange={(e) => setReason(e.target.value)} aria-label={`Dismiss reason for ${fs.path}`} />
                    <Button
                      disabled={!reason.trim()}
                      onClick={() => {
                        store.dismissDraftField(rec.domain, draft.id, fs.path, reason.trim());
                        setDismissing(null);
                        setReason('');
                      }}
                    >
                      Dismiss
                    </Button>
                  </div>
                ) : (
                  <button type="button" className="mt-1 text-slate-600 underline" onClick={() => (setDismissing(fs.path), setReason(''))}>
                    Leave out (dismiss)…
                  </button>
                ))}
              {fs.state === 'dismissed' && <div className="text-slate-500">Dismissed: {draft.dismissed.find((d) => d.field === fs.path)?.reason}</div>}
            </div>
          ))}
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase text-slate-500">Preview</h4>
          {result.to.length > 0 && <div className="text-xs">To: {result.to.join(', ')}</div>}
          {result.subject && <div className="text-xs">Subject: {result.subject}</div>}
          {locked ? (
            <p className="mt-1 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-900" data-testid="draft-preview-locked">
              The text of this draft is hidden while the template is locked for this classification.
            </p>
          ) : (
            <pre className="mt-1 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-3 font-mono text-xs" data-testid="draft-preview">
              {result.text}
            </pre>
          )}
          <p className="mt-1 text-xs text-slate-500">The first line is always “{BANNER}”. Edit by filling fields; the merged text cannot be edited directly, so gaps cannot hide.</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={blocking} onClick={() => void exportEml()}>
          Download .eml
        </Button>
        {mailto.ok && !blocking ? (
          <a
            href={mailto.url}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
            onClick={() => void store.recordDraftExport(rec.domain, draft.id, 'mailto', out.text, tpl.id, dismissedFields)}
          >
            Open in mail app (mailto)
          </a>
        ) : (
          <Button disabled title={mailto.ok ? 'Fill or dismiss all fields first' : mailto.reason}>
            mailto {mailto.ok ? '' : '(too long)'}
          </Button>
        )}
        <Button disabled={blocking} onClick={() => void copy()}>
          Copy text
        </Button>
        <Button disabled={blocking} onClick={() => void exportTxt()}>
          Download .txt
        </Button>
        {tpl.channel === 'email' && rec.evidence.length > 0 && (
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} /> attach {rec.evidence.length} evidence file(s) to the .eml
          </label>
        )}
      </div>
      {out.leak && <Banner level="danger">Export is blocked: internal-note text would leave the app. Fix the template's notes (see templates/README.md).</Banner>}
      {blocking && !locked && !out.leak && <p className="mt-2 text-xs text-red-700">Export is blocked until every unfilled field is filled or dismissed.</p>}
      {!blocking && out.removedNotes > 0 && <p className="mt-2 text-xs text-slate-600">{out.removedNotes} internal drafting note(s) shown in the preview are removed from every export.</p>}
      {!blocking && out.placeholders > 0 && (
        <Banner level="caution">
          {out.placeholders} placeholder legal passage(s) are still in this draft. Replace them with counsel-approved text (or import your own template) before sending.
        </Banner>
      )}
      {notice && <p className="mt-2 text-xs text-emerald-700">{notice}</p>}
    </div>
  );
}
