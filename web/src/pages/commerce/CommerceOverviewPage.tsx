/** Обзор и цифры: чек-лист запуска, показатели за период, топ товаров, пустые запросы. i18n `commerce`. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Circle, RefreshCw } from 'lucide-react';
import { api, fmtMoney } from './api';
import { Card, Stat, Btn, Empty, CopyRow, useToast } from './ui';

export default function CommerceOverviewPage() {
  const { t } = useTranslation('commerce');
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [toast, show] = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const [st, se] = await Promise.all([api(`/api/commerce/stats?days=${days}`), api('/api/commerce/settings')]);
      setData(st); setSettings(se);
    } catch (e: any) { show(e?.message || t('common.error'), 'error'); }
    setLoading(false);
  };
  useEffect(() => { void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const cur = data?.snapshot?.current || {};
  const prev = data?.snapshot?.previous || {};
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
  const delta = (k: string) => { const a = Number(cur[k] || 0), b = Number(prev[k] || 0); if (!b) return a ? '+100%' : ''; const d = Math.round(((a - b) / b) * 100); return t('overview.delta', { d: `${d >= 0 ? '+' : ''}${d}` }); };
  const s = settings?.settings;
  const checklist = [
    { ok: (settings?.products || 0) > 0, label: settings?.products ? t('overview.check.catalogN', { n: settings.products }) : t('overview.check.catalog'), to: '/commerce/catalog' },
    { ok: !!settings?.key?.configured, label: t('overview.check.key'), to: '/commerce/settings' },
    { ok: !!s?.greeting && !!s?.brand_name, label: t('overview.check.widget'), to: '/commerce/widget' },
    { ok: !!s?.policies, label: t('overview.check.policies'), to: '/commerce/settings' },
    { ok: (cur.widget_opens || 0) > 0, label: t('overview.check.embed'), to: '/commerce/widget' },
  ];

  return (
    <div className="space-y-5">
      {toast}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-700" style={{ fontFamily: 'Space Grotesk, sans-serif', color: 'var(--text-primary)' }}>{t('overview.title')}</h1>
        <div className="flex items-center gap-2">
          {[7, 30, 90].map((d) => <button key={d} type="button" onClick={() => setDays(d)} className="px-3 py-1.5 rounded-full text-xs" style={days === d ? { background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' } : { color: 'var(--text-muted)', border: '1px solid transparent' }}>{t('common.days', { n: d })}</button>)}
          <Btn variant="ghost" onClick={() => void load()}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></Btn>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat label={t('overview.dialogs')} value={cur.dialogs ?? '—'} sub={delta('dialogs')} />
        <Stat label={t('overview.cardsShown')} value={cur.cards_shown ?? '—'} sub={delta('cards_shown')} />
        <Stat label={t('overview.addToCart')} value={cur.add_to_cart ?? '—'} sub={t('overview.ofDialogs', { p: pct(cur.add_to_cart || 0, cur.dialogs || 0) })} />
        <Stat label={t('overview.leads')} value={cur.leads ?? '—'} sub={delta('leads')} />
        <Stat label={t('overview.purchases')} value={cur.purchases ?? '—'} sub={t('overview.purchasesSub')} />
        <Stat label={t('overview.revenue')} value={fmtMoney(cur.revenue ?? 0, s?.currency)} sub={delta('revenue')} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title={t('overview.launch')}>
          <ul className="space-y-2">
            {checklist.map((c) => (
              <li key={c.label} className="flex items-center gap-2 text-sm">
                {c.ok ? <CheckCircle2 size={18} style={{ color: '#10b981' }} /> : <Circle size={18} style={{ color: 'var(--text-disabled)' }} />}
                <Link to={c.to} style={{ color: c.ok ? 'var(--text-muted)' : 'var(--text-primary)' }}>{c.label}</Link>
              </li>
            ))}
          </ul>
          {s?.embedSnippet ? (
            <div className="mt-4">
              <div className="text-[11px] font-600 uppercase mb-1.5" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>{t('overview.codeForSite')}</div>
              <CopyRow text={s.embedSnippet} size={11} />
            </div>
          ) : null}
        </Card>

        <Card title={t('overview.emptySearches')} right={<span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('overview.emptySearchesSub')}</span>}>
          {data?.snapshot?.empty_searches?.length ? (
            <ul className="space-y-1.5">
              {data.snapshot.empty_searches.map((e: any) => <li key={e.query} className="flex justify-between text-sm"><span style={{ color: 'var(--text-primary)' }}>{e.query}</span><span style={{ color: 'var(--text-muted)' }}>{e.count}</span></li>)}
            </ul>
          ) : <Empty>{t('overview.emptySearchesNone')}</Empty>}
        </Card>

        <Card title={t('overview.topProducts')} right={<span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('overview.topProductsSub')}</span>}>
          {data?.snapshot?.top_products?.length ? (
            <ul className="space-y-1.5">
              {data.snapshot.top_products.map((p: any) => <li key={p.product_id} className="flex justify-between gap-3 text-sm"><span className="truncate" style={{ color: 'var(--text-primary)' }}>{p.title || p.product_id}</span><span className="whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{p.clicks} · 🛒 {p.add_to_cart}</span></li>)}
            </ul>
          ) : <Empty>{t('overview.topProductsNone')}</Empty>}
        </Card>

        <Card title={t('overview.changes')}>
          <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
            {data?.pendingChanges ? <>{t('overview.pending', { n: data.pendingChanges })} <Link to="/commerce/agent" className="underline">{t('overview.openAgent')}</Link></> : t('overview.pendingNone')}
          </div>
          <div className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>{t('overview.changesNote')}</div>
        </Card>
      </div>
    </div>
  );
}
