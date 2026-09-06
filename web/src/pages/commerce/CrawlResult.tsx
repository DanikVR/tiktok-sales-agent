/** Карточка «Анализ завершён»: что нашли, насколько полны данные, что делать дальше. Общая для сайта и соцсетей. i18n `commerce`. */
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { fmtDate, fmtMoney } from './api';
import { Btn } from './ui';

export const PLATFORM_LABEL: Record<string, string> = {
  shopify: 'Shopify', woocommerce: 'WooCommerce', magento: 'Magento', squarespace: 'Squarespace', prestashop: 'PrestaShop', opencart: 'OpenCart',
  wix: 'Wix', bitrix: '1C-Bitrix', insales: 'InSales', tilda: 'Tilda', instagram: 'Instagram', tiktok: 'TikTok', telegram: 'Telegram',
};

export function CrawlResult({ crawl, summary, onHide, mode = 'site' }: { crawl: any; summary: any; onHide: () => void; mode?: 'site' | 'social' }) {
  const { t } = useTranslation('commerce');
  const s = summary || {};
  const total = Number(s.total || 0);
  const pct = (n: number) => (total ? Math.round((Number(n || 0) / total) * 100) : 0);
  const found = Number(crawl.products_found || 0);
  const tips: string[] = [];
  if (!found) tips.push(mode === 'social' ? t('result.tips.noneSocial') : t('result.tips.noneSite'));
  if (total && pct(s.with_description) < 60) tips.push(t('result.tips.noDescription', { n: total - Number(s.with_description || 0) }));
  if (total && pct(s.with_image) < 80) tips.push(t('result.tips.noImage', { n: total - Number(s.with_image || 0) }));
  if (total && pct(s.with_price) < 95) tips.push(t('result.tips.noPrice', { n: total - Number(s.with_price || 0) }));
  if (total && Number(s.in_stock || 0) < total) tips.push(t('result.tips.outOfStock', { n: total - Number(s.in_stock || 0) }));
  if (found && !tips.length) tips.push(t('result.tips.good'));
  const tiles: Array<[string, number, number | null]> = [[t('result.tiles.total'), total, null], [t('result.tiles.inStock'), Number(s.in_stock || 0), pct(s.in_stock)], [t('result.tiles.withImage'), Number(s.with_image || 0), pct(s.with_image)], [t('result.tiles.withDescription'), Number(s.with_description || 0), pct(s.with_description)], [t('result.tiles.withPrice'), Number(s.with_price || 0), pct(s.with_price)], [t('result.tiles.variants'), Number(s.variants || 0), null]];
  const social = crawl.platform === 'instagram' || crawl.platform === 'tiktok' || crawl.platform === 'telegram';
  return (
    <div className="mt-3 rounded-2xl px-4 py-4" style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.35)' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-700" style={{ color: 'var(--text-primary)' }}>{t('result.title')}{crawl.finished_at ? ` · ${fmtDate(crawl.finished_at)}` : ''}</div>
          <div className="text-sm mt-1" style={{ color: 'var(--text-primary)' }}>{crawl.message}</div>
          <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{crawl.platform && PLATFORM_LABEL[crawl.platform] ? t('result.platform', { name: PLATFORM_LABEL[crawl.platform] }) : t('result.platformUnknown')}{crawl.currency ? ` · ${t('result.currency', { c: crawl.currency })}` : ''}{crawl.url && crawl.url !== 'instagram' ? ` · ${crawl.url}` : ''}{social ? ` · ${t('result.postsSaved')}` : ''}</div>
        </div>
        <button type="button" onClick={onHide} className="text-xs px-2 py-1 rounded-lg whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{t('common.hide')}</button>
      </div>
      {total ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 2xl:grid-cols-6 gap-2 mt-3">
          {tiles.map(([label, val, p]) => (
            <div key={label} className="rounded-xl px-3 py-2" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
              <div className="text-[10px] uppercase" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>{label}</div>
              <div className="text-lg font-700" style={{ color: 'var(--text-primary)' }}>{val}{p != null ? <span className="text-xs font-500 ml-1" style={{ color: 'var(--text-muted)' }}>{p}%</span> : null}</div>
            </div>
          ))}
        </div>
      ) : null}
      {s.categories?.length ? <div className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>{t('result.categories', { list: s.categories.map((c: any) => `${c.name} (${c.count})`).join(', ') })}</div> : null}
      {s.min_price != null && s.max_price != null ? <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{t('result.prices', { min: fmtMoney(s.min_price, s.currency), max: fmtMoney(s.max_price, s.currency) })}</div> : null}
      <ul className="mt-3 space-y-1 text-sm" style={{ color: 'var(--text-primary)' }}>{tips.map((x) => <li key={x}>• {x}</li>)}</ul>
      <div className="flex gap-2 mt-3 flex-wrap"><Link to="/commerce/settings"><Btn variant="ghost">{t('result.terms')}</Btn></Link><Link to="/commerce/widget"><Btn>{t('result.widget')}</Btn></Link></div>
    </div>
  );
}
