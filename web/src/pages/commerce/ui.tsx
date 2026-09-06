/** Мелкие общие элементы кабинета Commerce Agents. Подписи окна подтверждения — из i18n `commerce`. */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check } from 'lucide-react';

export function Card({ title, right, children, className = '' }: { title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl p-4 sm:p-5 min-w-0 ${className}`} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
      {(title || right) && (
        <div className="flex items-center justify-between gap-3 mb-3">
          {title ? <h3 className="text-sm font-700 uppercase tracking-wider" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>{title}</h3> : <span />}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export const inputStyle: React.CSSProperties = { background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' };

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] font-600 uppercase mb-1.5" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>{label}</div>
      {children}
      {hint ? <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>{hint}</div> : null}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`w-full rounded-xl px-3 py-2.5 text-sm outline-none ${props.className || ''}`} style={{ ...inputStyle, ...(props.style || {}) }} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`w-full rounded-xl px-3 py-2.5 text-sm outline-none ${props.className || ''}`} style={{ ...inputStyle, minHeight: 96, ...(props.style || {}) }} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`w-full rounded-xl px-3 py-2.5 text-sm outline-none ${props.className || ''}`} style={{ ...inputStyle, ...(props.style || {}) }} />;
}

export function Btn({ children, variant = 'primary', className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const style: React.CSSProperties = variant === 'primary'
    ? { background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }
    : variant === 'danger' ? { background: 'rgba(239,68,68,.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,.3)' }
    : { background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' };
  return <button type="button" {...rest} className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-sm font-600 transition-all active:scale-95 disabled:opacity-50 ${className}`} style={{ ...style, ...(rest.style || {}) }}>{children}</button>;
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
      <div className="text-[11px] font-600 uppercase" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>{label}</div>
      <div className="text-2xl font-700 mt-1" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub ? <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>{children}</div>;
}

export function useToast(): [React.ReactNode, (msg: string, kind?: 'ok' | 'error') => void] {
  const [t, setT] = React.useState<{ msg: string; kind: 'ok' | 'error' } | null>(null);
  const show = React.useCallback((msg: string, kind: 'ok' | 'error' = 'ok') => { setT({ msg, kind }); window.setTimeout(() => setT(null), 2600); }, []);
  const node = t ? <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full text-sm shadow-lg" style={{ background: t.kind === 'ok' ? '#111827' : '#b91c1c', color: '#fff' }}>{t.msg}</div> : null;
  return [node, show];
}

/** Окно подтверждения в стиле кабинета (вместо системного window.confirm). */
export function useConfirm(): [React.ReactNode, (opts: { title?: string; message: string; confirmText?: string; danger?: boolean }) => Promise<boolean>] {
  const { t } = useTranslation('commerce');
  const [st, setSt] = React.useState<{ opts: { title?: string; message: string; confirmText?: string; danger?: boolean }; resolve: (v: boolean) => void } | null>(null);
  const ask = React.useCallback((opts: { title?: string; message: string; confirmText?: string; danger?: boolean }) => new Promise<boolean>((resolve) => setSt({ opts, resolve })), []);
  const close = (v: boolean) => { st?.resolve(v); setSt(null); };
  React.useEffect(() => {
    if (!st) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false); if (e.key === 'Enter') close(true); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st]);
  const node = st ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.55)' }} onClick={() => close(false)}>
      <div className="w-full max-w-md rounded-3xl p-6" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', boxShadow: '0 24px 64px rgba(0,0,0,.35)' }} onClick={(e) => e.stopPropagation()}>
        <div className="text-lg font-700 mb-2" style={{ color: 'var(--text-primary)' }}>{st.opts.title || t('common.confirmTitle')}</div>
        <div className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>{st.opts.message}</div>
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => close(false)}>{t('common.cancel')}</Btn>
          <Btn variant={st.opts.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{st.opts.confirmText || t('common.confirm')}</Btn>
        </div>
      </div>
    </div>
  ) : null;
  return [node, ask];
}

/** Строка для копирования (код, ссылка): свой горизонтальный скролл, не распирает страницу; иконка «копировать» справа. */
export function CopyRow({ text, size = 12, className = '' }: { text: string; size?: number; className?: string }) {
  const { t } = useTranslation('commerce');
  const [ok, setOk] = React.useState(false);
  const copy = () => { navigator.clipboard.writeText(text).then(() => { setOk(true); window.setTimeout(() => setOk(false), 1500); }).catch(() => {}); };
  return (
    <div className={`flex items-stretch gap-1.5 min-w-0 ${className}`}>
      <code className="flex-1 min-w-0 px-3 py-2.5 rounded-xl overflow-x-auto whitespace-nowrap" style={{ fontSize: size, background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>{text}</code>
      <button type="button" onClick={copy} title={t('common.copy')} aria-label={t('common.copy')} className="flex-shrink-0 px-2.5 rounded-xl flex items-center transition-colors" style={{ background: 'var(--bg-tertiary)', color: ok ? '#10b981' : 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>{ok ? <Check size={15} /> : <Copy size={15} />}</button>
    </div>
  );
}

/** Короткое значение (телефон, email) с маленькой иконкой «копировать» рядом. */
export function CopyInline({ text }: { text: string }) {
  const { t } = useTranslation('commerce');
  const [ok, setOk] = React.useState(false);
  const copy = () => { navigator.clipboard.writeText(text).then(() => { setOk(true); window.setTimeout(() => setOk(false), 1500); }).catch(() => {}); };
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <span>{text}</span>
      <button type="button" onClick={copy} title={t('common.copy')} aria-label={t('common.copy')} className="p-0.5 rounded" style={{ color: ok ? '#10b981' : 'var(--text-muted)' }}>{ok ? <Check size={12} /> : <Copy size={12} />}</button>
    </span>
  );
}
