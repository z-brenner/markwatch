import { Card, ExternalLink } from '../components/ui';
import { ALLOWLIST, ALLOWLIST_BOOTSTRAP_PUBLICATION } from '../../data/allowlist';
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
        <div className="space-y-2 text-sm">
          <p>
            <strong>No backend, nothing retained.</strong> Markwatch is a single static file. It has no server, account, analytics or telemetry. It does not use cookies, localStorage, sessionStorage, IndexedDB or any other browser storage, and lookups are fetched with caching disabled. Closing the tab discards everything you have not exported as a case file.
          </p>
          <p>
            <strong>But lookups are not private.</strong> Each lookup discloses what you look up to the service that answers it:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>DNS queries disclose the domain to the DNS-over-HTTPS resolver (Cloudflare by default, Google as fallback) and, through it, to the domain’s own nameservers. A registrant who runs their own nameservers can see that someone resolved their domain.</li>
            <li>RDAP queries disclose the domain to its registry, and IP addresses to the regional internet registry.</li>
            <li>Certificate searches disclose your mark to crt.sh.</li>
            <li>Abuse-contact lookups disclose IP addresses to the resolver and to Abusix’s nameservers.</li>
            <li>“Open in a new tab” links disclose the lookup to the site they open.</li>
          </ul>
          <p>
            The browser enforces this boundary through the page’s Content-Security-Policy: it may connect only to the hosts below ({ALLOWLIST.length} in total, generated from the IANA RDAP bootstrap published {ALLOWLIST_BOOTSTRAP_PUBLICATION}).
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
      <Card title="Credits and licenses">
        <div className="space-y-1 text-sm">
          <p>Markwatch {APP_VERSION} · scoring ruleset {RULESET_VERSION}</p>
          <p>
            Permutation algorithms and lookalike tables are derived from <ExternalLink href="https://github.com/elceef/dnstwist">dnstwist</ExternalLink> (Apache-2.0, © Marcin Ulikowski) and techniques from{' '}
            <ExternalLink href="https://github.com/typosquatter/ail-typo-squatting">ail-typo-squatting</ExternalLink> (BSD-2-Clause, © AIL project / CIRCL). See NOTICE.
          </p>
          <p>
            Public Suffix List data (via tldts) is licensed under MPL-2.0; source at <ExternalLink href="https://publicsuffix.org/">publicsuffix.org</ExternalLink>. Abuse contacts may come from the Abusix Contact DB. React, fflate, zod, punycode and tldts are MIT-licensed.
          </p>
        </div>
      </Card>
    </>
  );
}
