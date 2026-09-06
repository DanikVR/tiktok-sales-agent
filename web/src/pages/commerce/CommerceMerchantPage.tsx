/**
 * Агент владельца: чат с отчётами и staged-изменениями. Изменения из чата не применяются сами —
 * справа панель «Изменения» с кнопками «Применить» / «Отклонить» (approval surface по blueprint). i18n `commerce`.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Send, Sparkles } from 'lucide-react';
import { api, authHeaders, readSse, type AgentSseEvent } from './api';
import { Card, Btn, Empty, useToast } from './ui';
import { AGENT_CSS, MetricsCard, DigestCard, ChangePreview, Suggestions } from '../../components/commerce/AgentComponents';
import StatsSummary from './StatsSummary';

type Block = { id: number; kind: 'text'; role: 'user' | 'assistant'; text: string } | { id: number; kind: 'component'; component: string; data: any } | { id: number; kind: 'progress'; text: string };
type NewBlock = Block extends infer B ? (B extends Block ? Omit<B, 'id'> : never) : never;

const vars: React.CSSProperties = {
  ['--cg-accent' as any]: '#f59e0b', ['--cg-accent-rgb' as any]: '245,158,11', ['--cg-bg' as any]: 'var(--bg-secondary)', ['--cg-surface' as any]: 'var(--bg-tertiary)',
  ['--cg-text' as any]: 'var(--text-primary)', ['--cg-muted' as any]: 'var(--text-muted)', ['--cg-muted-bg' as any]: 'var(--bg-elevated)', ['--cg-border' as any]: 'var(--border-subtle)',
};

export default function CommerceMerchantPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t, i18n } = useTranslation('commerce');
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [changes, setChanges] = useState<any[]>([]);
  const [busyChange, setBusyChange] = useState<string | null>(null);
  const convRef = useRef<string | null>(null);
  const idRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [toast, show] = useToast();
  const starters = (t('merchant.starters', { returnObjects: true }) as unknown) as string[];
  const progressLabel = (k: string) => t(`merchant.progress.${['read', 'stage', 'think'].includes(k) ? k : 'think'}`);

  const loadChanges = () => api('/api/commerce/changes?status=staged').then((r) => setChanges(r.changes)).catch(() => {});
  useEffect(() => {
    void loadChanges();
    // Из каталога: ?audit=1 — новый чат и сразу запрос на аудит качества каталога.
    if (new URLSearchParams(window.location.search).get('audit') === '1') {
      try { sessionStorage.removeItem('comag_merchant_conv'); } catch { /* ignore */ }
      convRef.current = null;
      window.history.replaceState(null, '', window.location.pathname);
      window.setTimeout(() => { void send(t('merchant.auditPrompt')); }, 50);
      return;
    }
    try { convRef.current = sessionStorage.getItem('comag_merchant_conv'); } catch { /* ignore */ }
    if (convRef.current) {
      api(`/api/commerce/merchant/conversations/${convRef.current}`).then((r) => {
        const restored: Block[] = [];
        for (const m of r.messages || []) {
          if (m.role === 'user') restored.push({ id: idRef.current++, kind: 'text', role: 'user', text: m.display?.text || '' });
          else { if (m.display?.text) restored.push({ id: idRef.current++, kind: 'text', role: 'assistant', text: m.display.text }); for (const c of m.display?.components || []) restored.push({ id: idRef.current++, kind: 'component', component: c.component, data: c.data }); }
        }
        setBlocks(restored);
      }).catch(() => { convRef.current = null; });
    }
  }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [blocks, busy]);

  const push = (b: NewBlock) => { const id = idRef.current++; setBlocks((p) => [...p, { ...(b as any), id }]); return id; };

  const send = async (text: string) => {
    const msg = text.trim(); if (!msg || busy) return;
    setInput(''); push({ kind: 'text', role: 'user', text: msg }); setBusy(true);
    let assistantId: number | null = null; let progressId: number | null = null;
    const rm = (id: number) => setBlocks((p) => p.filter((b) => b.id !== id));
    try {
      const res = await fetch('/api/commerce/merchant/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ message: msg, conversationId: convRef.current, lang: (i18n.language || 'en').slice(0, 2) }) });
      await readSse(res, (ev: AgentSseEvent) => {
        if (ev.type === 'meta' && ev.data?.conversationId) { convRef.current = ev.data.conversationId; try { sessionStorage.setItem('comag_merchant_conv', ev.data.conversationId); } catch { /* ignore */ } }
        else if (ev.type === 'progress') { const label = progressLabel(ev.text); if (progressId == null) progressId = push({ kind: 'progress', text: label }); else setBlocks((p) => p.map((b) => (b.id === progressId ? { ...b, text: label } as Block : b))); }
        else if (ev.type === 'text') { if (progressId != null) { rm(progressId); progressId = null; } if (assistantId == null) assistantId = push({ kind: 'text', role: 'assistant', text: '' }); const id = assistantId; setBlocks((p) => p.map((b) => (b.id === id && b.kind === 'text' ? { ...b, text: b.text + ev.delta } : b))); }
        else if (ev.type === 'component') { if (progressId != null) { rm(progressId); progressId = null; } assistantId = null; push({ kind: 'component', component: ev.component, data: ev.data }); if (ev.component === 'change_preview') void loadChanges(); }
        else if (ev.type === 'error') { if (progressId != null) { rm(progressId); progressId = null; } push({ kind: 'text', role: 'assistant', text: ev.message }); }
      });
    } catch (e: any) { push({ kind: 'text', role: 'assistant', text: t('merchant.errorPrefix', { msg: e?.message || e }) }); }
    finally { if (progressId != null) rm(progressId); setBusy(false); }
  };

  const apply = async (id: string) => { setBusyChange(id); try { await api(`/api/commerce/changes/${id}/apply`, { method: 'POST' }); show(t('merchant.applied')); await loadChanges(); setBlocks((p) => p.map((b) => (b.kind === 'component' && b.component === 'change_preview' && b.data?.changeId === id ? { ...b, data: { ...b.data, status: 'applied' } } : b))); } catch (e: any) { show(e?.message, 'error'); } setBusyChange(null); };
  const discard = async (id: string) => { setBusyChange(id); try { await api(`/api/commerce/changes/${id}/discard`, { method: 'POST' }); await loadChanges(); setBlocks((p) => p.map((b) => (b.kind === 'component' && b.component === 'change_preview' && b.data?.changeId === id ? { ...b, data: { ...b.data, status: 'discarded' } } : b))); } catch (e: any) { show(e?.message, 'error'); } setBusyChange(null); };
  const reset = () => { convRef.current = null; try { sessionStorage.removeItem('comag_merchant_conv'); } catch { /* ignore */ } setBlocks([]); };

  return (
    <div className="space-y-4" style={vars}>
      <style>{AGENT_CSS}</style>
      {toast}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {embedded
          ? <div className="text-[11px] font-600 uppercase" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>{t('merchant.title')}</div>
          : <h1 className="text-2xl font-700" style={{ fontFamily: 'Space Grotesk, sans-serif', color: 'var(--text-primary)' }}>{t('merchant.title')}</h1>}
        <Btn variant="ghost" onClick={reset}>{t('merchant.newChat')}</Btn>
      </div>
      <StatsSummary />
      <div className="grid lg:grid-cols-[1fr_340px] gap-4 items-start">
        <Card className="flex flex-col">
          <div ref={scrollRef} className="overflow-y-auto space-y-3 pr-1" style={{ height: 'min(62dvh, 640px)' }}>
            {blocks.length === 0 ? (
              <div className="py-6">
                <div className="flex items-center gap-2 mb-2 text-sm" style={{ color: 'var(--text-primary)' }}><Sparkles size={16} style={{ color: '#f59e0b' }} /> {t('merchant.intro')}</div>
                <Suggestions chips={Array.isArray(starters) ? starters : []} onPick={(c) => void send(c)} accent="#f59e0b" />
              </div>
            ) : null}
            {blocks.map((b) => {
              if (b.kind === 'text') return <div key={b.id} className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${b.role === 'user' ? 'ml-auto' : ''}`} style={b.role === 'user' ? { background: 'var(--bg-tertiary)', color: 'var(--text-primary)' } : { background: 'var(--card-bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>{b.text}</div>;
              if (b.kind === 'progress') return <div key={b.id} className="text-xs flex items-center gap-2" style={{ color: 'var(--text-muted)' }}><Loader2 size={13} className="animate-spin" /> {b.text}</div>;
              switch (b.component) {
                case 'metrics': return <MetricsCard key={b.id} data={b.data} t={t} />;
                case 'digest': return <DigestCard key={b.id} data={b.data} onAction={(a) => void send(a)} t={t} />;
                case 'change_preview': return <ChangePreview key={b.id} data={b.data} onApply={apply} onDiscard={discard} busy={busyChange === b.data?.changeId} t={t} />;
                case 'suggestions': return <Suggestions key={b.id} chips={b.data?.chips || []} onPick={(c) => void send(c)} accent="#f59e0b" />;
                default: return null;
              }
            })}
            {busy && blocks[blocks.length - 1]?.kind === 'text' && (blocks[blocks.length - 1] as any).role === 'user' ? <div className="text-xs flex items-center gap-2" style={{ color: 'var(--text-muted)' }}><Loader2 size={13} className="animate-spin" /> {t('merchant.progress.think')}</div> : null}
          </div>
          <form className="flex gap-2 mt-3" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('merchant.placeholder')} disabled={busy} className="flex-1 rounded-xl px-3.5 py-2.5 text-sm outline-none" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }} />
            <Btn disabled={busy || !input.trim()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}</Btn>
          </form>
        </Card>
        <Card title={t('merchant.changes')} right={<span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('merchant.pending', { n: changes.length })}</span>}>
          {changes.length === 0 ? <Empty>{t('merchant.noChanges')}</Empty> : (
            <div className="space-y-3">
              {changes.map((c) => <ChangePreview key={c.id} data={{ changeId: c.id, kind: c.kind, status: c.status, note: c.note, items: c.items }} onApply={apply} onDiscard={discard} busy={busyChange === c.id} t={t} />)}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
