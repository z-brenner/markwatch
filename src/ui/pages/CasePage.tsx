import { useState } from 'react';
import { useCase, useRun, useServices } from '../context';
import { Banner, Button, Card, Mono } from '../components/ui';
import { downloadBytes, readFileBytes } from '../download';

export function CasePage() {
  const { store, runner } = useServices();
  const { state, importAudit, importWarnings, dirty } = useCase();
  const run = useRun();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shown, setShown] = useState(100);

  const doExport = async () => {
    setBusy(true);
    setError('');
    try {
      const { bytes, fileName } = await store.exportCase();
      downloadBytes(fileName, new Uint8Array(bytes), 'application/zip');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const doImport = async (f: File) => {
    if (dirty && !window.confirm('Importing replaces the current case, and you have unexported changes. Continue?')) return;
    setBusy(true);
    setError('');
    try {
      runner.reset();
      await store.importCase(await readFileBytes(f));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card title="Case file">
        <p className="mb-3 text-sm text-slate-600">
          The case file is a ZIP holding the case as JSON (schema v1), every evidence file with its SHA-256, a manifest, and the append-only audit log. Timestamps are UTC from this computer’s clock. This is the only way to keep your work.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void doExport()} disabled={busy}>
            Export case file (.zip)
          </Button>
          <label className={run.running ? 'inline-block cursor-not-allowed rounded border border-slate-200 px-3 py-1.5 text-sm text-slate-400' : 'inline-block cursor-pointer rounded border border-slate-300 px-3 py-1.5 text-sm'}>
            {run.running ? 'Import case file (finish or cancel the running lookup first)' : 'Import case file'}
            <input
              type="file"
              accept=".zip,application/zip"
              disabled={!!run.running}
              className="sr-only"
              aria-label="Import case file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void doImport(f);
              }}
            />
          </label>
        </div>
        <div className="mt-3 space-y-2">
          {error && <Banner level="danger">{error}</Banner>}
          {importAudit && !importAudit.ok && (
            <Banner level="danger">
              Audit log integrity check FAILED at entry {importAudit.brokenAt}: {importAudit.reason}. The case file was edited outside Markwatch, or is corrupt.
            </Banner>
          )}
          {importAudit?.ok && <Banner level="info">Audit log hash chain verified: the log is internally consistent. (This detects casual edits, but someone could recompute the whole chain.)</Banner>}
          {importAudit?.warnings.map((w) => (
            <Banner key={w} level="caution">
              {w}
            </Banner>
          ))}
          {importWarnings.map((w) => (
            <Banner key={w} level="caution">
              {w}
            </Banner>
          ))}
        </div>
      </Card>
      <Card title={`Audit log (${state.audit.length} entries)`}>
        <p className="mb-2 text-xs text-slate-600">
          Append-only and hash-chained: each entry includes the SHA-256 of the previous one, so edits made outside the app are detected on import. This is tamper-evident, not tamper-proof: someone could recompute the whole chain.
        </p>
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full text-left text-xs" data-testid="audit-table">
            <thead className="sticky top-0 bg-white text-slate-500">
              <tr>
                <th className="py-1 pr-2">#</th>
                <th className="pr-2">Time (UTC)</th>
                <th className="pr-2">Actor</th>
                <th className="pr-2">Event</th>
                <th className="pr-2">Details</th>
                <th>Hash</th>
              </tr>
            </thead>
            <tbody>
              {[...state.audit]
                .reverse()
                .slice(0, shown)
                .map((e) => (
                  <tr key={e.seq} className="border-t border-slate-100 align-top">
                    <td className="py-1 pr-2">{e.seq}</td>
                    <td className="whitespace-nowrap pr-2">{e.at}</td>
                    <td className="pr-2">{e.actor}</td>
                    <td className="pr-2">{e.type}</td>
                    <td className="max-w-md break-all pr-2 font-mono">{JSON.stringify(e.payload)}</td>
                    <td>
                      <Mono>{e.hash.slice(0, 12)}…</Mono>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {shown < state.audit.length && (
          <Button className="mt-2" onClick={() => setShown(shown + 500)}>
            Show more
          </Button>
        )}
      </Card>
    </>
  );
}
