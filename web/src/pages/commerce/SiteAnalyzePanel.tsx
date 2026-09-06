/** Анализ сайта: адрес или фид → прогресс по этапам → карточка результата. Используется в Каталоге и на главной (в шторке). i18n `commerce`. */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Loader2 } from 'lucide-react';
import { api } from './api';
import { Btn, Input, useToast } from './ui';
import { CrawlResult } from './CrawlResult';

export default function SiteAnalyzePanel({ compact = false, onChanged }: { compact?: boolean; onChanged?: () => void }) {
  const { t } = useTranslation('commerce');
  const [crawlUrl, setCrawlUrl] = useState('');
  const [crawl, setCrawl] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [dismissed, setDismissed] = useState(false);
  const [toast, show] = useToast();

  useEffect(() => {
    api('/api/commerce/settings').then((r) => setCrawlUrl(r.settings?.site_url || '')).catch(() => {});
    api('/api/commerce/crawl').then((r) => { setCrawl(r.status); setSummary(r.summary || null); }).catch(() => {});
  }, []);
  const running = crawl?.state === 'running';
  useEffect(() => {
    if (!running) return;
    const tm = window.setInterval(async () => {
      try {
        const r = await api('/api/commerce/crawl');
        setCrawl(r.status); setSummary(r.summary || null);
        if (r.status?.state !== 'running') { window.clearInterval(tm); setDismissed(false); show(r.status?.state === 'done' ? t('site.done', { n: r.status.products_found || 0 }) : t('site.failed'), r.status?.state === 'done' ? 'ok' : 'error'); onChanged?.(); }
      } catch { /* ignore */ }
    }, 2500);
    return () => window.clearInterval(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const start = async () => {
    try { const r = await api('/api/commerce/crawl', { method: 'POST', body: JSON.stringify({ url: crawlUrl }) }); setCrawl(r.status); setDismissed(false); show(t('site.started')); } catch (e: any) { show(e?.message, 'error'); }
  };

  return (
    <div>
      {toast}
      <div className="flex gap-2 flex-wrap">
        <Input placeholder={t('site.placeholder')} value={crawlUrl} onChange={(e) => setCrawlUrl(e.target.value)} className="flex-1 min-w-[200px]" inputMode="url" autoComplete="off" />
        <Btn onClick={() => void start()} disabled={running || !crawlUrl}>{running ? <Loader2 size={15} className="animate-spin" /> : <Globe size={15} />} {running ? t('site.analyzing') : t('site.analyze')}</Btn>
      </div>
      <div className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>{compact ? t('site.helpShort') : t('site.help')}</div>
      {running ? (
        <div className="mt-3 rounded-xl px-3 py-2.5 text-sm flex items-center gap-2 flex-wrap" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
          <Loader2 size={14} className="animate-spin" /> {crawl.phase || t('site.progress')} <span style={{ color: 'var(--text-muted)' }}>· {crawl.pages_total ? t('site.pagesOf', { seen: crawl.pages_seen || 0, total: crawl.pages_total }) : t('site.pages', { seen: crawl.pages_seen || 0 })}, {t('site.found', { n: crawl.products_found || 0 })}</span>
        </div>
      ) : null}
      {crawl && crawl.state === 'error' && !dismissed ? (
        <div className="mt-3 rounded-2xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,.10)', border: '1px solid rgba(239,68,68,.35)', color: 'var(--text-primary)' }}>
          <div className="font-700 mb-1">{t('site.notDone')}</div>
          <div>{crawl.message}</div>
          <div className="flex gap-2 mt-3"><Btn onClick={() => void start()}>{t('common.retry')}</Btn><Btn variant="ghost" onClick={() => setDismissed(true)}>{t('common.hide')}</Btn></div>
        </div>
      ) : null}
      {crawl && crawl.state === 'done' && !dismissed ? <CrawlResult crawl={crawl} summary={summary} onHide={() => setDismissed(true)} /> : null}
    </div>
  );
}
