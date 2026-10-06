import type { Collector, Capability } from '../../../src/collect/Collector';
import type { CtEntry, DnsAnswer, LookupResult, RdapDomain, RdapNetwork, RRType } from '../../../src/core/types';

const AT = '2026-10-05T12:00:00.000Z';

export interface FakeZone {
  ns?: string[];
  a?: string[];
  mx?: string[];
  rcode?: number;
  rdap?: 'ok' | 'blocked' | 'notfound';
  dnsBlocked?: boolean;
}

/** In-memory Collector: records calls and answers from a zone table. */
export class FakeCollector implements Collector {
  readonly id = 'fake';
  readonly capabilities: ReadonlySet<Capability> = new Set<Capability>(['dns', 'rdap', 'ct', 'abuse']);
  calls: string[] = [];
  constructor(private zones: Record<string, FakeZone>) {}

  dns(name: string, type: RRType): Promise<LookupResult<DnsAnswer>> {
    this.calls.push(`dns ${name} ${type}`);
    const z = this.zones[name];
    const query = `${name} ${type}`;
    if (z?.dnsBlocked) return Promise.resolve({ status: 'blocked', kind: 'dns', query, source: 'fake', at: AT, reason: 'cors_or_error', detail: 'blocked' });
    const rcode = z ? (z.rcode ?? 0) : 3;
    const data = type === 'NS' ? z?.ns : type === 'A' ? z?.a : type === 'MX' ? z?.mx?.map((m) => `10 ${m}.`) : undefined;
    const code = { NS: 2, A: 1, AAAA: 28, MX: 15, TXT: 16, SOA: 6, CNAME: 5 }[type];
    return Promise.resolve({
      status: 'ok',
      kind: 'dns',
      query,
      source: 'fake',
      at: AT,
      data: { name, type, rcode, ad: false, answers: (data ?? []).map((d) => ({ name, type: code, ttl: 60, data: d })), authority: [], resolver: 'cloudflare' },
    });
  }

  rdapDomain(domain: string): Promise<LookupResult<RdapDomain>> {
    this.calls.push(`rdap ${domain}`);
    const z = this.zones[domain];
    if (!z || z.rdap === 'notfound') return Promise.resolve({ status: 'not_found', kind: 'rdap-domain', query: domain, source: 'fake', at: AT, evidence: '404' });
    if (z.rdap === 'blocked') return Promise.resolve({ status: 'blocked', kind: 'rdap-domain', query: domain, source: 'fake', at: AT, reason: 'cors_or_error', detail: 'blocked' });
    return Promise.resolve({
      status: 'ok',
      kind: 'rdap-domain',
      query: domain,
      source: 'fake',
      at: AT,
      data: { ldhName: domain, status: [], nameservers: z.ns ?? [], redactedFields: [], server: 'https://rdap.fake/', registered: '2026-10-01T00:00:00Z', registrar: { name: 'Fake Registrar', abuseEmail: ['abuse@fake.example'], abuseTel: [] } },
    });
  }

  rdapIp(ip: string): Promise<LookupResult<RdapNetwork>> {
    this.calls.push(`rdap-ip ${ip}`);
    return Promise.resolve({ status: 'ok', kind: 'rdap-ip', query: ip, source: 'fake', at: AT, data: { cidr: [], org: 'Fake Host', abuseEmail: ['abuse@host.example'], server: 'https://rir.fake/' } });
  }

  ctSearch(term: string): Promise<LookupResult<CtEntry[]>> {
    this.calls.push(`ct ${term}`);
    return Promise.resolve({ status: 'ok', kind: 'ct', query: term, source: 'fake', at: AT, data: [] });
  }

  abuseContact(ip: string): Promise<LookupResult<string[]>> {
    this.calls.push(`abuse ${ip}`);
    return Promise.resolve({ status: 'ok', kind: 'abuse', query: ip, source: 'fake', at: AT, data: ['abuse@abusix.example'] });
  }
}
