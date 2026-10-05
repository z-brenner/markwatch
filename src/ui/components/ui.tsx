// Small presentational primitives. Tailwind only; no inline style attributes
// (the CSP forbids inline styles) and never any HTML injection.
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from 'react';

const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
export function Button({ variant = 'secondary', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-slate-900 text-white hover:bg-slate-700 disabled:bg-slate-400',
    secondary: 'bg-white text-slate-900 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
    danger: 'bg-red-700 text-white hover:bg-red-600 disabled:bg-red-300',
    ghost: 'text-slate-700 hover:bg-slate-100 disabled:text-slate-400',
  };
  return <button type="button" {...p} className={cx('inline-flex items-center gap-1 rounded px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed', styles[variant], className)} />;
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-lg border border-slate-200 bg-white', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          <div className="flex gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

type Tone = 'gray' | 'green' | 'red' | 'amber' | 'blue' | 'purple';
export function Badge({ tone = 'gray', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  const tones: Record<Tone, string> = {
    gray: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-100 text-emerald-800',
    red: 'bg-red-100 text-red-800',
    amber: 'bg-amber-100 text-amber-900',
    blue: 'bg-sky-100 text-sky-800',
    purple: 'bg-violet-100 text-violet-800',
  };
  return (
    <span title={title} className={cx('inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium', tones[tone])}>
      {children}
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-800">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none';
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, p.className)} />;
export const TextArea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(inputCls, 'font-mono', p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputCls, p.className)} />;

export function Checkbox({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Banner({ level, children, onDismiss }: { level: 'info' | 'caution' | 'danger'; children: ReactNode; onDismiss?: () => void }) {
  const styles = { info: 'border-sky-300 bg-sky-50 text-sky-900', caution: 'border-amber-300 bg-amber-50 text-amber-900', danger: 'border-red-300 bg-red-50 text-red-900' };
  return (
    <div role={level === 'danger' ? 'alert' : 'note'} className={cx('flex items-start justify-between gap-3 rounded border px-3 py-2 text-sm', styles[level])}>
      <div>{children}</div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="shrink-0 text-xs underline">
          Dismiss
        </button>
      )}
    </div>
  );
}

/** Link that opens a lookup or reference in a new tab. Says plainly that opening it discloses the query. */
export function ExternalLink({ href, children, disclose = true }: { href: string; children: ReactNode; disclose?: boolean }) {
  let host = href;
  try {
    host = new URL(href).hostname;
  } catch {
    /* keep raw */
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-sky-700 underline" title={disclose ? `Opens ${host} in a new tab. That site will see what you are looking up.` : undefined}>
      {children}
    </a>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-slate-500">{children}</p>;
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-xs break-all">{children}</span>;
}

export function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="text-sm" aria-live="polite">
      <div className="mb-1 flex justify-between">
        <span>{label}</span>
        <span>
          {done} / {total}
        </span>
      </div>
      <progress className="h-2 w-full" value={done} max={Math.max(total, 1)} aria-label={label}>
        {pct}%
      </progress>
    </div>
  );
}

export { cx };
