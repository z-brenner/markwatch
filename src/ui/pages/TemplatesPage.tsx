import { useState } from 'react';
import { useCase, useServices } from '../context';
import { Badge, Banner, Button, Card } from '../components/ui';
import { CLASSIFICATION_LABELS } from '../../core/types';

export function TemplatesPage() {
  const { store } = useServices();
  const { templates, state } = useCase();
  const [messages, setMessages] = useState<{ level: 'info' | 'caution' | 'danger'; text: string }[]>([]);
  const [view, setView] = useState<string | null>(null);

  const onFiles = async (files: File[]) => {
    const out: typeof messages = [];
    for (const f of files) {
      const r = await store.importTemplate(await f.text(), f.name);
      if (!r.ok) out.push({ level: 'danger', text: `${f.name}: not imported. ${r.errors.join(' ')}` });
      else out.push({ level: r.warnings.length ? 'caution' : 'info', text: `${f.name}: imported.${r.warnings.length ? ` ${r.warnings.join(' ')}` : ''}` });
    }
    setMessages(out);
  };

  return (
    <>
      <Card title="Templates">
        <p className="mb-3 text-sm text-slate-600">
          Built-in templates contain placeholder legal language only. Import your counsel-approved templates (Markdown with front matter; see templates/README.md in the source). An imported template with the same id replaces the built-in one. Imported templates are held in memory and saved inside the case file. Every draft starts with “DRAFT. Attorney review required before sending.” whatever the template says.
        </p>
        <label className="inline-block cursor-pointer rounded border border-slate-300 px-3 py-1.5 text-sm">
          Import template files (.md)
          <input
            type="file"
            multiple
            accept=".md,.txt,text/markdown,text/plain"
            className="sr-only"
            aria-label="Import templates"
            onChange={(e) => {
              const list = [...(e.target.files ?? [])];
              e.target.value = '';
              void onFiles(list);
            }}
          />
        </label>
        <div className="mt-3 space-y-2">
          {messages.map((m) => (
            <Banner key={m.text} level={m.level}>
              {m.text}
            </Banner>
          ))}
        </div>
      </Card>
      <Card title={`Loaded (${templates.length})`}>
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="py-1">Template</th>
              <th>Channel</th>
              <th>For</th>
              <th>Fields</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id} className="border-t border-slate-100 align-top">
                <td className="py-2">
                  <div className="font-medium">{t.title}</div>
                  <div className="font-mono text-xs text-slate-500">{t.id}</div>
                  {!t.builtin && <Badge tone="purple">imported</Badge>}
                </td>
                <td>{t.channel}</td>
                <td className="text-xs">{t.classes.map((c) => CLASSIFICATION_LABELS[c]).join(', ')}</td>
                <td>{t.fields.length}</td>
                <td className="space-x-1 text-right">
                  <Button variant="ghost" onClick={() => setView(view === t.id ? null : t.id)}>
                    {view === t.id ? 'Hide' : 'View'}
                  </Button>
                  {!t.builtin && state.templates.some((x) => x.id === t.id) && (
                    <Button variant="ghost" onClick={() => store.removeTemplate(t.id)}>
                      Remove
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {view && <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-3 font-mono text-xs">{templates.find((t) => t.id === view)?.body}</pre>}
      </Card>
    </>
  );
}
