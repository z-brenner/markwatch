import { useState } from 'react';
import { Banner, Button, Card, ExternalLink } from '../components/ui';
import { ALLOWLIST, ALLOWLIST_BOOTSTRAP_PUBLICATION } from '../../data/allowlist';
import { NOTICES } from '../../data/notices';
import { BUNDLED_PUBLICATION, STALE_AFTER_DAYS, bundledAgeDays, checkBootstrapDrift, type DriftResult } from '../../collect/bootstrapDrift';
import { RULESET_VERSION } from '../../config/scoring.rules';
import { APP_VERSION } from '../../state/store';

export function AboutPage() {
  const fixed = ALLOWLIST.filter((h) => !h.purpose.startsWith('RDAP'));
  const rdap = ALLOWLIST.filter((h) => h.purpose.startsWith('RDAP'));
  return (
    <>
      <Card title="Not legal advice">
        <div className="space-y-2 text-sm" data-testid="about-legal">
          <p>
            <strong>Markwatch does not give legal advice.</strong> It is a workbench that organizes public lookup data and produces draft documents from templates. Scores are heuristics that rank domains for review; they are not findings. Routes are general information about common remedies, not a recommendation for your situation.
          </p>
          <p>Every draft is marked “DRAFT. Attorney review required before sending.” Built-in templates contain placeholder legal language that a qualified attorney must replace. Markwatch never sends anything: drafts leave only as a downloaded .eml file, a mailto link you click, or text you copy.</p>
          <p>Template and routing guidance is US-centric (DMCA, ACPA) plus the global UDRP and URS policies.</p>
        </div>
      </Card>
      <Card title="Privacy model">
        <div className="space-y-2 text-sm" data-testid="about-privacy">
          <p>
            <strong>No backend, nothing retained.</strong> Markwatch is a single static file. It has no server, account, analytics or telemetry. It does not use cookies, localStorage, sessionStorage, IndexedDB or any other browser storage, and lookups are fetched with caching disabled, without cookies or credentials, and without a Referer header. Closing the tab discards everything you have not exported as a case file.
          </p>
          <p>
            <strong>But lookups are not private.</strong> Each lookup discloses what you look up to the service that answers it:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              DNS queries disclose the domain to the DNS-over-HTTPS resolver (Cloudflare by default, Google as fallback) and, through it, to the domain’s own nameservers. A registrant who runs their own nameservers can see that someone resolved their domain. Google is asked not to pass on your network (<span className="font-mono text-xs">edns_client_subnet=0.0.0.0/0</span>); Cloudflare does not send it.
            </li>
            <li>RDAP queries disclose the domain to its registry, and IP addresses to the regional internet registry.</li>
            <li>Certificate searches disclose your mark to crt.sh.</li>
            <li>Abuse-contact lookups disclose IP addresses to the resolver and to Abusix’s nameservers.</li>
            <li>“Open in a new tab” links disclose the lookup to the site they open.</li>
          </ul>
          <p>
            <strong>Every server Markwatch contacts also sees</strong> your IP address, your browser’s User-Agent, and an <span className="font-mono text-xs">Origin</span> header: the address this page is served from, or <span className="font-mono text-xs">null</span> when it is opened from disk.
          </p>
          <p>
            <strong>Traces left on your own computer</strong>, outside Markwatch’s control:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Pages opened with “open in a new tab” links are recorded in your browser history.</li>
            <li>
              Downloaded files are recorded in your browser’s download history, and their names include what you were working on: <span className="font-mono text-xs">markwatch-case-&lt;mark&gt;-&lt;time&gt;.zip</span> for case files, <span className="font-mono text-xs">&lt;template&gt;-&lt;domain&gt;.eml</span> or <span className="font-mono text-xs">.txt</span> for drafts.
            </li>
            <li>“Copy text” puts the draft on the operating system’s clipboard, which may keep a clipboard history or sync it to your other devices.</li>
          </ul>
          <p>
            <strong>The audit log is tamper-evident, not tamper-proof.</strong> Each entry includes the hash of the previous one, so an edit to an exported case file is detected on import. Anyone can still rewrite the whole chain and recompute every hash, and timestamps come from your computer’s clock.
          </p>
          <p>
            The browser enforces the network boundary through the page’s Content-Security-Policy: it may connect only to the hosts below ({ALLOWLIST.length} in total, generated from the IANA RDAP bootstrap published {ALLOWLIST_BOOTSTRAP_PUBLICATION}).
          </p>
        </div>
      </Card>
      <Card title="Network allowlist (CSP connect-src)">
        <ul className="mb-3 space-y-1 text-sm">
          {fixed.map((h) => (
            <li key={h.host}>
              <span className="font-mono">{h.host}</span>: {h.purpose}
            </li>
          ))}
        </ul>
        <details>
          <summary className="cursor-pointer text-sm">{rdap.length} RDAP servers (registries and regional internet registries)</summary>
          <ul className="mt-2 columns-2 font-mono text-xs md:columns-3">
            {rdap.map((h) => (
              <li key={h.host}>{h.host}</li>
            ))}
          </ul>
        </details>
      </Card>
      <RegistryListCard />
      <Card title="Credits and licenses">
        <div className="space-y-1 text-sm">
          <p>Markwatch {APP_VERSION} · scoring ruleset {RULESET_VERSION}</p>
          <p>
            Permutation algorithms and lookalike tables are derived from <ExternalLink href="https://github.com/elceef/dnstwist">dnstwist</ExternalLink> (Apache-2.0, © Marcin Ulikowski) and techniques from{' '}
            <ExternalLink href="https://github.com/typosquatter/ail-typo-squatting">ail-typo-squatting</ExternalLink> (BSD-2-Clause, © AIL project / CIRCL).
          </p>
          <p>
            Public Suffix List data (via tldts) is licensed under MPL-2.0; source at <ExternalLink href="https://publicsuffix.org/list/">publicsuffix.org/list</ExternalLink>. Abuse contacts may come from the Abusix Contact DB. React, react-dom, scheduler, fflate, zod, punycode, tldts, tldts-core and Tailwind CSS are MIT-licensed.
          </p>
          <p>The full notices and license texts are below.</p>
        </div>
      </Card>
      <Card title="Licenses">
        <div className="space-y-2" data-testid="about-licenses">
          <p className="text-sm">The third-party software and data compiled into this file, with their license texts. The same texts are in THIRD_PARTY_LICENSES.md in the source repository.</p>
          {NOTICES.map((n) => (
            <details key={n.id} className="rounded border border-slate-200 px-3 py-2" data-testid={`license-${n.id}`}>
              <summary className="cursor-pointer text-sm">
                <span className="font-medium">{n.title}</span>
                {n.version ? ` ${n.version}` : ''} · {n.license}
              </summary>
              <div className="mt-2 space-y-2 text-sm">
                {n.note && <p>{n.note}</p>}
                {n.url.startsWith('https://') && (
                  <p>
                    Source: <ExternalLink href={n.url}>{n.url}</ExternalLink>
                  </p>
                )}
                <pre className="max-h-96 overflow-auto rounded bg-slate-50 p-2 font-mono text-xs break-words whitespace-pre-wrap">{n.text}</pre>
              </div>
            </details>
          ))}
        </div>
      </Card>
    </>
  );
}

function formatDate(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.exec(iso)?.[0] ?? iso;
}

function RegistryListCard() {
  const [now] = useState(() => Date.now());
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<DriftResult | null>(null);
  const age = bundledAgeDays(now);
  const old = age !== null && age > STALE_AFTER_DAYS;

  const check = async () => {
    setChecking(true);
    setResult(null);
    try {
      setResult(await checkBootstrapDrift());
    } finally {
      setChecking(false);
    }
  };

  return (
    <Card title="Registry list (IANA RDAP bootstrap)">
      <div className="space-y-2 text-sm" data-testid="registry-list">
        <p>
          RDAP lookups are routed by a snapshot of IANA’s list of registry RDAP servers, built into this file. The snapshot was published <strong data-testid="bootstrap-publication">{formatDate(BUNDLED_PUBLICATION)}</strong>
          {age !== null && ` (${age} day${age === 1 ? '' : 's'} ago)`}.
        </p>
        {old && (
          <Banner level="caution">
            The snapshot is more than {STALE_AFTER_DAYS} days old. Registries may have moved RDAP servers since; lookups for those TLDs would be blocked or go to the wrong server. Check for updates below, then run <span className="font-mono">npm run update-bootstrap</span> and rebuild.
          </Banner>
        )}
        <p>
          The check runs only when you click the button. It fetches IANA’s public file <span className="font-mono text-xs">https://data.iana.org/rdap/dns.json</span>; IANA learns only that someone fetched it (plus your IP address and browser, as with every request). No domain, IP or mark is sent.
        </p>
        <div>
          <Button onClick={() => void check()} disabled={checking}>
            {checking ? 'Checking…' : 'Check IANA for updates'}
          </Button>
        </div>
        {result && (
          <div data-testid="drift-result" className="space-y-1">
            {result.status === 'current' && <Banner level="info">Up to date. {result.detail}</Banner>}
            {result.status === 'stale' && (
              <Banner level="caution">
                <p>Update available. {result.detail}</p>
                {result.newHosts.length > 0 && (
                  <p className="mt-1">
                    New RDAP servers: <span className="font-mono text-xs">{result.newHosts.join(', ')}</span>
                  </p>
                )}
                <p className="mt-1">This page cannot update itself: the servers it may contact are fixed when it is built.</p>
              </Banner>
            )}
            {result.status === 'blocked' && <Banner level="caution">{result.detail} The snapshot was not compared.</Banner>}
            {result.livePublication && <p className="text-xs text-slate-600">IANA’s current file was published {formatDate(result.livePublication)}.</p>}
          </div>
        )}
      </div>
    </Card>
  );
}
