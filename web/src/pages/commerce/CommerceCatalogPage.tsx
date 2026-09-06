/** Каталог: анализ сайта, соцсети, импорт CSV/XLSX/JSON, ручное добавление и правка товаров. i18n `commerce`. */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, Plus, Pencil, Trash2, Search, Loader2, ClipboardCheck } from 'lucide-react';
import { api, fmtMoney } from './api';
import { useNavigate } from 'react-router-dom';
import { Card, Btn, Input, Textarea, Field, Empty, useToast, useConfirm } from './ui';

interface Product { id: string; title: string; brand: string | null; price: number; currency: string; compare_at_price: number | null; in_stock: boolean; stock: number | null; image_url: string | null; url: string | null; category: string | null; description: string | null; sku: string | null; active: boolean; attributes: Record<string, string>; variant_of: string | null }

const EMPTY: Partial<Product> = { title: '', price: 0, currency: 'EUR', in_stock: true, active: true, attributes: {} };

export default function CommerceCatalogPage() {
  const { t } = useTranslation('commerce');
  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [toast, show] = useToast();
  const [confirmNode, askConfirm] = useConfirm();
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try { const r = await api(`/api/commerce/products?q=${encodeURIComponent(q)}&page=${page}&limit=50`); setItems(r.items); setTotal(r.total); } catch (e: any) { show(e?.message, 'error'); }
    setLoading(false);
  };
  useEffect(() => { void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const importFile = async (f: File) => {
    const fd = new FormData(); fd.append('file', f);
    try { const r = await api('/api/commerce/products/import', { method: 'POST', body: fd }); show(t('catalog.imported', { created: r.created, updated: r.updated, skipped: r.skipped })); void load(); } catch (e: any) { show(e?.message, 'error'); }
  };
  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      if (editing.id) await api(`/api/commerce/products/${editing.id}`, { method: 'PUT', body: JSON.stringify(editing) });
      else await api('/api/commerce/products', { method: 'POST', body: JSON.stringify(editing) });
      setEditing(null); show(t('common.saved')); void load();
    } catch (e: any) { show(e?.message, 'error'); }
    setSaving(false);
  };
  const removeSource = async (source: 'site' | 'telegram' | 'instagram' | 'tiktok') => {
    const label = t(`catalog.removeSource.${source}`);
    if (!(await askConfirm({ title: t('catalog.removeSourceTitle'), message: `${t('catalog.removeSourceText', { label })}${source !== 'site' ? ` ${t('catalog.removeSourcePosts')}` : ''} ${t('catalog.irreversible')}`, confirmText: t('common.delete'), danger: true }))) return;
    try { const r = await api(`/api/commerce/products?source=${source}${source !== 'site' ? '&posts=1' : ''}`, { method: 'DELETE' }); show(`${t('catalog.removed', { n: r.deleted })}${r.posts ? t('catalog.removedPosts', { n: r.posts }) : ''}`); void load(); } catch (e: any) { show(e?.message, 'error'); }
  };
  const remove = async (p: Product) => {
    if (!(await askConfirm({ title: t('catalog.deleteTitle'), message: t('catalog.deleteText', { title: p.title }), confirmText: t('common.delete'), danger: true }))) return;
    try { await api(`/api/commerce/products/${p.id}`, { method: 'DELETE' }); void load(); } catch (e: any) { show(e?.message, 'error'); }
  };

  return (
    <div className="space-y-5">
      {toast}
      {confirmNode}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-700" style={{ fontFamily: 'Space Grotesk, sans-serif', color: 'var(--text-primary)' }}>{t('catalog.title')} <span className="text-base font-500" style={{ color: 'var(--text-muted)' }}>{total}</span></h1>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.currentTarget.value = ''; }} />
          <Btn variant="ghost" onClick={() => navigate('/commerce/agent?audit=1')} title={t('catalog.audit')}><ClipboardCheck size={15} /> {t('catalog.audit')}</Btn>
          <Btn variant="ghost" onClick={() => fileRef.current?.click()}><Upload size={15} /> {t('catalog.import')}</Btn>
          <Btn onClick={() => setEditing({ ...EMPTY })}><Plus size={15} /> {t('catalog.add')}</Btn>
        </div>
      </div>

      <Card right={<form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setPage(1); void load(); }}><Input placeholder={t('catalog.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} className="w-64" /><Btn variant="ghost" aria-label={t('common.search')}><Search size={15} /></Btn></form>}>
        {loading ? <Empty><Loader2 size={20} className="animate-spin inline" /></Empty> : items.length === 0 ? <Empty>{t('catalog.empty')}</Empty> : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm min-w-[720px]">
              <thead><tr style={{ color: 'var(--text-muted)' }} className="text-left text-[11px] uppercase tracking-wider"><th className="px-4 py-2">{t('catalog.th.product')}</th><th className="px-2 py-2">{t('catalog.th.category')}</th><th className="px-2 py-2 text-right">{t('catalog.th.price')}</th><th className="px-2 py-2">{t('catalog.th.stock')}</th><th className="px-2 py-2"></th></tr></thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} style={{ borderTop: '1px solid var(--border-subtle)', opacity: p.active ? 1 : 0.5 }}>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0" style={{ background: 'var(--bg-tertiary)' }}>{p.image_url ? <img src={p.image_url} alt="" className="w-full h-full object-cover" /> : null}</div>
                        <div className="min-w-0"><div className="font-500 truncate max-w-[320px]" style={{ color: 'var(--text-primary)' }}>{p.title}</div><div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{[p.brand, p.sku, p.variant_of ? t('catalog.variant') : null, p.attributes?.['Источник'] ? `${p.attributes['Источник']}${p.attributes['Дата поста'] ? ` · ${t('catalog.postFrom', { date: p.attributes['Дата поста'] })}` : ''}` : null].filter(Boolean).join(' · ')}</div></div>
                      </div>
                    </td>
                    <td className="px-2 py-2" style={{ color: 'var(--text-muted)' }}>{p.category || '—'}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{Number(p.price) > 0 ? fmtMoney(p.price, p.currency) : <span style={{ color: 'var(--text-muted)' }}>{t('catalog.onRequest')}</span>}{p.compare_at_price ? <div className="text-[11px] line-through" style={{ color: 'var(--text-muted)' }}>{fmtMoney(p.compare_at_price, p.currency)}</div> : null}</td>
                    <td className="px-2 py-2"><span className="text-xs px-2 py-0.5 rounded-full" style={{ background: p.in_stock ? 'rgba(16,185,129,.12)' : 'rgba(239,68,68,.12)', color: p.in_stock ? '#10b981' : '#ef4444' }}>{p.in_stock ? (p.stock != null ? t('catalog.pcs', { n: p.stock }) : t('catalog.inStock')) : t('catalog.none')}</span></td>
                    <td className="px-2 py-2 whitespace-nowrap text-right"><button type="button" className="p-1.5" onClick={() => setEditing(p)} style={{ color: 'var(--text-muted)' }}><Pencil size={15} /></button><button type="button" className="p-1.5" onClick={() => void remove(p)} style={{ color: '#ef4444' }}><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 ? (
          <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 text-xs" style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
            <span>{t('catalog.removeAll')}</span>
            {(['site', 'telegram', 'instagram', 'tiktok'] as const).map((k) => <button key={k} type="button" className="underline" onClick={() => void removeSource(k)}>{t(`catalog.removeSource.${k}`)}</button>)}
            <span>{t('catalog.removeNote')}</span>
          </div>
        ) : null}
        {total > 50 ? <div className="flex justify-between items-center mt-3 text-xs" style={{ color: 'var(--text-muted)' }}><span>{t('common.page', { page, total: Math.ceil(total / 50) })}</span><div className="flex gap-2"><Btn variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>←</Btn><Btn variant="ghost" disabled={page * 50 >= total} onClick={() => setPage(page + 1)}>→</Btn></div></div> : null}
      </Card>

      {editing ? (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-6" style={{ background: 'rgba(0,0,0,.55)' }} onClick={() => setEditing(null)}>
          <div className="w-full sm:max-w-2xl max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-700 mb-4" style={{ color: 'var(--text-primary)' }}>{editing.id ? t('catalog.edit.title') : t('catalog.edit.new')}</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2"><Field label={t('catalog.edit.name')}><Input value={editing.title || ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field></div>
              <Field label={t('catalog.edit.price')}><Input type="number" step="0.01" value={editing.price ?? 0} onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })} /></Field>
              <Field label={t('catalog.edit.oldPrice')}><Input type="number" step="0.01" value={editing.compare_at_price ?? ''} onChange={(e) => setEditing({ ...editing, compare_at_price: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
              <Field label={t('catalog.edit.brand')}><Input value={editing.brand || ''} onChange={(e) => setEditing({ ...editing, brand: e.target.value })} /></Field>
              <Field label={t('catalog.edit.category')}><Input value={editing.category || ''} onChange={(e) => setEditing({ ...editing, category: e.target.value })} /></Field>
              <Field label={t('catalog.edit.sku')}><Input value={editing.sku || ''} onChange={(e) => setEditing({ ...editing, sku: e.target.value })} /></Field>
              <Field label={t('catalog.edit.stock')}><Input type="number" value={editing.stock ?? ''} onChange={(e) => setEditing({ ...editing, stock: e.target.value === '' ? null : Number(e.target.value), in_stock: e.target.value === '' ? editing.in_stock : Number(e.target.value) > 0 })} /></Field>
              <Field label={t('catalog.edit.url')}><Input value={editing.url || ''} onChange={(e) => setEditing({ ...editing, url: e.target.value })} /></Field>
              <Field label={t('catalog.edit.image')}><Input value={editing.image_url || ''} onChange={(e) => setEditing({ ...editing, image_url: e.target.value })} /></Field>
              <div className="sm:col-span-2"><Field label={t('catalog.edit.description')} hint={t('catalog.edit.descriptionHint')}><Textarea value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field></div>
              <div className="sm:col-span-2"><Field label={t('catalog.edit.attributes')}><Textarea value={Object.entries(editing.attributes || {}).map(([k, v]) => `${k}: ${v}`).join('\n')} onChange={(e) => { const attrs: Record<string, string> = {}; for (const line of e.target.value.split('\n')) { const i = line.indexOf(':'); if (i > 0) attrs[line.slice(0, i).trim()] = line.slice(i + 1).trim(); } setEditing({ ...editing, attributes: attrs }); }} style={{ minHeight: 70 }} /></Field></div>
              <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-primary)' }}><input type="checkbox" checked={editing.in_stock !== false} onChange={(e) => setEditing({ ...editing, in_stock: e.target.checked })} /> {t('catalog.edit.inStock')}</label>
              <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-primary)' }}><input type="checkbox" checked={editing.active !== false} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> {t('catalog.edit.active')}</label>
            </div>
            <div className="flex justify-end gap-2 mt-5"><Btn variant="ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</Btn><Btn onClick={() => void save()} disabled={saving || !editing.title}>{saving ? <Loader2 size={15} className="animate-spin" /> : null} {t('common.save')}</Btn></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
