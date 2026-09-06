/** Сводка для агента владельца: показатели за период, топ товаров, запросы без ответа (бывший «Обзор и цифры»). i18n `commerce`. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { api, fmtMoney } from './api';
import { Card, Stat, Btn, Empty } from './ui';

export default function StatsSummary() {
  const { t } = useTranslation('commerce');
  const [days, setDays] = useState(7);
  const [data, setData] = useState<any>(null);
  const [currency, setCurrency] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [st, se] = await Promise.all([api(`/api/commerce/stats?days=${days}`), api('/api/commerce/settings')]);
      setData(st); setCurrency(se.settings?.currency || null);
    } catch { /* сводка не критична */ }
    setLoading(false);
  };
  useEffect(() => { void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const cur = data?.snapshot?.current || {};
  const prev = data?.snapshot?.previous || {};
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
  const delta = (k: string) => { const a = Number(cur[k] || 0), b = Number(prev[k] || 0); if (!b) return a ? '+100%' : ''; const d = Math.round(((a - b) / b) * 100); return t('overview.delta', { d: `${d >= 0 ? '+' : ''}${d}` }); };

  return (
    <Card title={t('merchant.summary')} right={
      <div className="flex items-center gap-1">
        {[7, 30, 90].map((d) => <button key={d} type="button" onClick={() => setDays(d)} className="px-2.5 py-1 rounded-full text-xs" style={days === d ? { background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' } : { color: 'var(--text-muted)', border: '1px solid transparent' }}>{t('common.days', { n: d })}</button>)}
        <Btn variant="ghost" className="px-2 py-1.5" onClick={() => void load()}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></Btn>
      </div>
    }>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <Stat label={t('overview.dialogs')} value={cur.dialogs ?? '—'} sub={delta('dialogs')} />
        <Stat label={t('overview.cardsShown')} value={cur.cards_shown ?? '—'} sub={delta('cards_shown')} />
        <Stat label={t('overview.addToCart')} value={cur.add_to_cart ?? '—'} sub={t('overview.ofDialogs', { p: pct(cur.add_to_cart || 0, cur.dialogs || 0) })} />
        <Stat label={t('overview.leads')} value={cur.leads ?? '—'} sub={delta('leads')} />
        <Stat label={t('overview.purchases')} value={cur.purchases ?? '—'} sub={t('overview.purchasesSub')} />
        <Stat label={t('overview.revenue')} value={fmtMoney(cur.revenue ?? 0, currency)} sub={delta('revenue')} />
      </div>
      <div className="grid md:grid-cols-2 gap-4 mt-4">
        <div>
          <div className="text-[11px] font-600 uppercase mb-1.5" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>{t('overview.topProducts')}</div>
          {data?.snapshot?.top_products?.length ? (
            <ul className="space-y-1">
              {data.snapshot.top_products.slice(0, 6).map((p: any) => <li key={p.product_id} className="flex justify-between gap-3 text-sm"><span className="truncate" style={{ color: 'var(--text-primary)' }}>{p.title || p.product_id}</span><span className="whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{p.clicks} · 🛒 {p.add_to_cart}</span></li>)}
            </ul>
          ) : <Empty>{t('overview.topProductsNone')}</Empty>}
        </div>
        <div>
          <div className="text-[11px] font-600 uppercase mb-1.5" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>{t('overview.emptySearches')}</div>
          {data?.snapshot?.empty_searches?.length ? (
            <ul className="space-y-1">
              {data.snapshot.empty_searches.slice(0, 6).map((e: any) => <li key={e.query} className="flex justify-between text-sm"><span className="truncate" style={{ color: 'var(--text-primary)' }}>{e.query}</span><span style={{ color: 'var(--text-muted)' }}>{e.count}</span></li>)}
            </ul>
          ) : <Empty>{t('overview.emptySearchesNone')}</Empty>}
        </div>
      </div>
      {data?.pendingChanges ? <div className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>{t('overview.pending', { n: data.pendingChanges })} <Link to="/commerce/agent" className="underline">{t('overview.openAgent')}</Link></div> : null}
    </Card>
  );
}
