// Renders one LookupResult. A blocked lookup is shown as blocked, with the
// reason, a link that opens the same lookup in a new tab, and a box to paste
// the result in by hand. It is never rendered as "no data".
import { useState } from 'react';
import type { BlockReason, LookupResult, RdapDomain } from '../../core/types';
import { parsePastedDns, parsePastedRdap, parseWhoisText } from '../../core/whois/parse';
import { parseRdapNetwork } from '../../core/rdap/parse';
import { parseCrtsh } from '../../core/ct/crtsh';
import { nowUtc } from '../../core/util';
import { Badge, Button, ExternalLink, TextArea, Mono } from './ui';

export const BLOCK_LABEL: Record<BlockReason, string> = {
  csp: 'Blocked by this app’s allowlist',
  cors_or_error: 'Blocked by the browser',
  unreachable: 'Server unreachable',
  timeout: 'Timed out',
  rate_limited: 'Rate-limited',
  http_error: 'Server error',
  unsupported: 'No lookup service',
  cancelled: 'Cancelled',
  parse_error: 'Unreadable response',
};

export function StatusBadge({ r }: { r: LookupResult<unknown> }) {
  switch (r.status) {
    case 'ok':
      return <Badge tone="green">Answered</Badge>;
    case 'not_found':
      return <Badge tone="blue">Not found (authoritative)</Badge>;
    case 'manual':
      return <Badge tone="purple">Entered by user</Badge>;
    case 'blocked':
      return <Badge tone="red">{BLOCK_LABEL[r.reason]}</Badge>;
  }
}

function summarize(r: LookupResult<unknown>): string {
  if (r.status === 'not_found') return r.evidence;
  if (r.status === 'blocked') return r.detail;
  const d = r.data as Record<string, unknown> | unknown[] | null;
  if (r.kind === 'dns' && d && !Array.isArray(d)) {
    const ans = d as { rcode?: number; answers?: { data: string }[] };
    if (ans.rcode === 3) return 'NXDOMAIN (name does not exist in DNS)';
    if (ans.rcode === 2) return 'SERVFAIL';
    return ans.answers?.length ? ans.answers.map((a) => a.data).join(', ') : 'No records of this type';
  }
  if (r.kind === 'abuse' && Array.isArray(d)) return (d as string[]).join(', ');
  if (r.kind === 'ct' && Array.isArray(d)) {
    if (d.length === 0 && r.query.includes('names containing')) {
      return '0 certificates returned. crt.sh substring search often returns an empty list even when matches exist, so this is not proof that there are none.';
    }
    return `${d.length} certificate(s)`;
  }
  if (r.kind === 'rdap-domain' && d && !Array.isArray(d)) {
    const x = d as unknown as RdapDomain;
    return [x.registrar?.name, x.registered && `registered ${x.registered.slice(0, 10)}`].filter(Boolean).join(' · ') || 'RDAP record';
  }
  if (r.kind === 'rdap-ip' && d && !Array.isArray(d)) {
    const x = d as { org?: string; name?: string };
    return x.org ?? x.name ?? 'Network record';
  }
  return '';
}

/** Parses pasted text into the lookup's data type. Returns null when nothing usable was found. */
function parsePaste(r: LookupResult<unknown>, text: string): unknown {
  switch (r.kind) {
    case 'dns':
      return parsePastedDns(text);
    case 'rdap-domain': {
      const rdap = parsePastedRdap(text);
      if (rdap) return rdap;
      const w = parseWhoisText(text);
      if (!w.registrar && !w.registered && !(w.nameservers?.length)) return null;
      const { registrarAbuseEmail, ...whois } = w;
      const registrar = whois.registrar ?? { abuseEmail: [], abuseTel: [] };
      return {
        ldhName: r.query,
        status: w.status ?? [],
        nameservers: w.nameservers ?? [],
        redactedFields: [],
        server: 'manual (WHOIS text pasted by user)',
        ...whois,
        registrar: { ...registrar, abuseEmail: [...new Set([...(registrar.abuseEmail ?? []), ...(registrarAbuseEmail ?? [])])] },
      } satisfies RdapDomain;
    }
    case 'rdap-ip':
      try {
        return parseRdapNetwork(JSON.parse(text), 'manual');
      } catch {
        return null;
      }
    case 'abuse': {
      const emails = [...new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((e) => e.toLowerCase()))];
      return emails.length ? emails : null;
    }
    case 'ct':
      try {
        const list = parseCrtsh(JSON.parse(text));
        return list?.length ? list : null;
      } catch {
        return null;
      }
  }
}

export function LookupView({ r, onManual }: { r: LookupResult<unknown>; onManual?: (m: LookupResult<unknown>) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const showPaste = r.status === 'blocked' && r.reason !== 'cancelled' && onManual;

  const submit = () => {
    const data = parsePaste(r, text);
    if (data === null || data === undefined) {
      setErr('Could not find usable data in the pasted text. Paste the raw JSON or WHOIS output.');
      return;
    }
    onManual?.({ status: 'manual', kind: r.kind, query: r.query, source: `${r.source} (pasted by user)`, at: nowUtc(), data, pastedText: text.slice(0, 200_000) });
    setOpen(false);
    setText('');
    setErr('');
  };

  return (
    <div className="border-b border-slate-100 py-2 text-sm last:border-0" data-testid="lookup" data-status={r.status}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge r={r} />
        <span className="font-medium">{r.kind}</span>
        <Mono>{r.query}</Mono>
        <span className="text-xs text-slate-500">
          {r.source} · {r.at}
        </span>
      </div>
      <p className="mt-1 text-slate-700">{summarize(r)}</p>
      {r.status === 'blocked' && (
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
          <span className="text-slate-600">This is not “no data”: the lookup did not complete.</span>
          {r.manualUrl && <ExternalLink href={r.manualUrl}>Open this lookup in a new tab</ExternalLink>}
          {showPaste && (
            <Button variant="ghost" className="!px-1 !py-0 text-xs" onClick={() => setOpen((o) => !o)}>
              {open ? 'Cancel' : 'Paste the result by hand'}
            </Button>
          )}
        </div>
      )}
      {open && (
        <div className="mt-2 space-y-2">
          <TextArea rows={6} value={text} onChange={(e) => setText(e.target.value)} aria-label={`Paste result for ${r.query}`} placeholder="Paste the JSON or WHOIS text from the page you opened" />
          {err && <p className="text-xs text-red-700">{err}</p>}
          <Button variant="primary" onClick={submit} disabled={!text.trim()}>
            Save as user-entered result
          </Button>
        </div>
      )}
    </div>
  );
}
