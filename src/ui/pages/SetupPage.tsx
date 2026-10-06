import { useState } from 'react';
import { useCase, useServices } from '../context';
import type { Nav } from '../App';
import { Button, Card, Checkbox, Field, Input, Select, TextArea } from '../components/ui';
import { normalizeDomain, parseDomainList } from '../../pipeline/deps';
import { TECHNIQUES, type InventoryEntry, type KeyboardLayout, type MarkRight, type Technique } from '../../core/types';

const splitLines = (s: string) =>
  s
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);

export function SetupPage({ nav }: { nav: Nav }) {
  const { store } = useServices();
  const { state } = useCase();
  const [marks, setMarks] = useState(state.subject.marks.join('\n'));
  const [owner, setOwner] = useState(state.subject.owner);
  const [primary, setPrimary] = useState(state.subject.primaryDomain);
  const [rights, setRights] = useState<MarkRight[]>(state.subject.rights);
  const [owned, setOwned] = useState(state.inventory.filter((i) => i.kind === 'owned').map((i) => i.pattern).join('\n'));
  const [authorized, setAuthorized] = useState(
    state.inventory
      .filter((i) => i.kind === 'authorized')
      .map((i) => (i.party ? `${i.pattern}, ${i.party}` : i.pattern))
      .join('\n'),
  );
  const [sender, setSender] = useState(state.sender);
  const [settings, setSettings] = useState(state.settings);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  const save = () => {
    const errs: string[] = [];
    const markList = splitLines(marks);
    if (!markList.length) errs.push('Enter at least one mark.');
    const p = normalizeDomain(primary);
    if (!p) errs.push('Enter a valid primary domain, e.g. acme.com.');
    const ownedParsed = parseDomainList(owned);
    // Authorized lines may carry the party after a comma: "partner-acme.com, Partner Co".
    const authEntries: InventoryEntry[] = [];
    const badAuth: string[] = [];
    for (const line of authorized.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const [dom = '', ...party] = line.split(',');
      const parsed = parseDomainList(dom);
      if (parsed.valid.length !== 1) badAuth.push(line);
      else authEntries.push({ pattern: parsed.valid[0]!, kind: 'authorized', ...(party.join(',').trim() ? { party: party.join(',').trim() } : {}) });
    }
    if (ownedParsed.invalid.length) errs.push(`Not valid domains (owned): ${ownedParsed.invalid.join(', ')}`);
    if (badAuth.length) errs.push(`Not valid domains (authorized): ${badAuth.join(', ')}`);
    if (!Number.isInteger(settings.cap) || settings.cap < 1 || settings.cap > 50_000) errs.push('The candidate cap must be between 1 and 50,000.');
    setErrors(errs);
    if (errs.length) return;
    store.updateSubject({ marks: markList, owner: owner.trim(), primaryDomain: p!.ascii, rights: rights.filter((r) => r.number.trim() || r.jurisdiction.trim()) });
    store.setInventory([...ownedParsed.valid.map((pattern): InventoryEntry => ({ pattern, kind: 'owned' })), ...authEntries]);
    store.updateSender(sender);
    store.updateSettings(settings);
    store.resetPrimaryNs();
    setSaved(true);
  };

  const toggleTechnique = (t: Technique, on: boolean) =>
    setSettings({ ...settings, techniques: on ? TECHNIQUES.filter((x) => x === t || settings.techniques.includes(x)) : settings.techniques.filter((x) => x !== t) });
  const toggleKeyboard = (k: KeyboardLayout, on: boolean) => setSettings({ ...settings, keyboards: on ? [...new Set([...settings.keyboards, k])] : settings.keyboards.filter((x) => x !== k) });

  return (
    <>
      <Card title="Mark and primary domain">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Mark(s)" hint="One per line, e.g. Acme Widgets">
            <TextArea rows={3} value={marks} onChange={(e) => setMarks(e.target.value)} aria-label="Marks" />
          </Field>
          <Field label="Primary domain" hint="Your main domain. It is always treated as yours.">
            <Input value={primary} onChange={(e) => setPrimary(e.target.value)} placeholder="acme.com" aria-label="Primary domain" />
          </Field>
          <Field label="Mark owner (organisation)" hint="Used in drafts and to spot your own registrations.">
            <Input value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Mark owner" />
          </Field>
        </div>
        <div className="mt-4">
          <p className="mb-1 text-sm font-medium">Mark registrations (as you enter them; Markwatch never looks these up or invents them)</p>
          {rights.map((r, i) => (
            <div key={i} className="mb-2 grid grid-cols-5 gap-2">
              {(['number', 'jurisdiction', 'classes', 'firstUse', 'note'] as const).map((k) => (
                <Input
                  key={k}
                  aria-label={`Registration ${i + 1} ${k}`}
                  placeholder={{ number: 'Reg. No.', jurisdiction: 'Jurisdiction (e.g. USPTO)', classes: 'Classes', firstUse: 'First use (YYYY-MM-DD)', note: 'Note' }[k]}
                  value={r[k] ?? ''}
                  onChange={(e) => setRights(rights.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))}
                />
              ))}
            </div>
          ))}
          <Button onClick={() => setRights([...rights, { number: '', jurisdiction: '' }])}>Add registration</Button>
        </div>
      </Card>

      <Card title="Inventory: excluded from enforcement">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Domains you own" hint="One per line. Wildcards like *.acme.com cover subdomains.">
            <TextArea rows={6} value={owned} onChange={(e) => setOwned(e.target.value)} aria-label="Owned domains" />
          </Field>
          <Field label="Authorized third parties" hint="One per line: domain, party name (e.g. licensee). Shown labelled and excluded.">
            <TextArea rows={6} value={authorized} onChange={(e) => setAuthorized(e.target.value)} aria-label="Authorized domains" />
          </Field>
        </div>
        <ImportListButton onText={(t) => setOwned((o) => (o ? `${o}\n${t}` : t))} label="Import owned list (.txt/.csv)" />
      </Card>

      <Card title="Your details (used in drafts)">
        <div className="grid gap-3 md:grid-cols-3">
          {(['name', 'title', 'organization', 'email', 'phone', 'address'] as const).map((k) => (
            <Field key={k} label={k[0]!.toUpperCase() + k.slice(1)}>
              <Input value={sender[k]} onChange={(e) => setSender({ ...sender, [k]: e.target.value })} aria-label={`Sender ${k}`} />
            </Field>
          ))}
        </div>
      </Card>

      <Card title="Discovery settings">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Candidate cap" hint="Default 5,000. You will see the count before anything is resolved.">
            <Input type="number" min={1} max={50000} value={settings.cap} onChange={(e) => setSettings({ ...settings, cap: Number(e.target.value) })} aria-label="Candidate cap" />
          </Field>
          <Field label="DNS resolver" hint="The other is used only if the first fails.">
            <Select value={settings.primaryResolver} onChange={(e) => setSettings({ ...settings, primaryResolver: e.target.value as 'cloudflare' | 'google' })} aria-label="Resolver">
              <option value="cloudflare">Cloudflare (cloudflare-dns.com)</option>
              <option value="google">Google (dns.google)</option>
            </Select>
          </Field>
          <div className="space-y-2">
            <Checkbox label="Search certificate transparency (crt.sh)" checked={settings.ctEnabled} onChange={(v) => setSettings({ ...settings, ctEnabled: v })} />
            <Checkbox label="Use the Abusix abuse-contact database" checked={settings.useAbusix} onChange={(v) => setSettings({ ...settings, useAbusix: v })} />
          </div>
        </div>
        <fieldset className="mt-4">
          <legend className="mb-1 text-sm font-medium">Techniques</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {TECHNIQUES.filter((t) => t !== 'original').map((t) => (
              <Checkbox key={t} label={t} checked={settings.techniques.includes(t)} onChange={(v) => toggleTechnique(t, v)} />
            ))}
          </div>
        </fieldset>
        <fieldset className="mt-3">
          <legend className="mb-1 text-sm font-medium">Keyboard layouts</legend>
          <div className="flex gap-4">
            {(['qwerty', 'qwertz', 'azerty'] as const).map((k) => (
              <Checkbox key={k} label={k} checked={settings.keyboards.includes(k)} onChange={(v) => toggleKeyboard(k, v)} />
            ))}
          </div>
        </fieldset>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Field label="TLDs for TLD swap">
            <TextArea rows={5} value={settings.tlds.join('\n')} onChange={(e) => setSettings({ ...settings, tlds: splitLines(e.target.value).map((t) => t.replace(/^\./, '').toLowerCase()) })} aria-label="TLDs" />
          </Field>
          <Field label="Dictionary words (mark + word)">
            <TextArea rows={5} value={settings.dictionary.join('\n')} onChange={(e) => setSettings({ ...settings, dictionary: splitLines(e.target.value).map((w) => w.toLowerCase()) })} aria-label="Dictionary" />
          </Field>
          <Field label="Risky keywords (scoring)">
            <TextArea rows={5} value={settings.riskyKeywords.join('\n')} onChange={(e) => setSettings({ ...settings, riskyKeywords: splitLines(e.target.value).map((w) => w.toLowerCase()) })} aria-label="Risky keywords" />
          </Field>
        </div>
      </Card>

      {errors.length > 0 && (
        <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={save}>
          Save setup
        </Button>
        {saved && errors.length === 0 && (
          <>
            <span className="text-sm text-emerald-700">Saved.</span>
            <Button onClick={() => nav.go('discover')}>Continue to discovery →</Button>
          </>
        )}
      </div>
    </>
  );
}

function ImportListButton({ onText, label }: { onText: (t: string) => void; label: string }) {
  return (
    <label className="mt-2 inline-block cursor-pointer text-sm text-sky-700 underline">
      {label}
      <input
        type="file"
        accept=".txt,.csv,text/plain,text/csv"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void f.text().then(onText);
          e.target.value = '';
        }}
      />
    </label>
  );
}
