/**
 * Главная кабинета Commerce Agents — мобильная основа. Ассистент ведёт по сценарию (шаги с кнопками),
 * источники каталога иконками (Сайт, Instagram, TikTok, Telegram), действия (Виджет, Код для сайта,
 * Ссылка для соцсетей), короткая сводка. Всё подробное — через гамбургер в шапке. Строки — i18n `commerce`.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Globe, Instagram, Music2, Send, MessageSquareText, Code2, Link2, Check, Share2, X, Bell, KeyRound, FileText, Inbox, MessagesSquare, ExternalLink } from 'lucide-react';
import { api } from './api';
import { Btn, CopyRow, useToast } from './ui';
import SiteAnalyzePanel from './SiteAnalyzePanel';
import SocialImportCard from './SocialImportCard';
import TelegramNotifyCard from './TelegramNotifyCard';
import CommerceMerchantPage from './CommerceMerchantPage';

type Sheet = null | 'site' | 'instagram' | 'tiktok' | 'telegram' | 'code' | 'link' | 'notify';

export default function CommerceHomePage() {
  const { t } = useTranslation('commerce');
  const [data, setData] = useState<any>(null);
  const [social, setSocial] = useState<any>(null);
  const [notify, setNotify] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [toast, show] = useToast();
  const navigate = useNavigate();

  const load = async () => {
    try {
      const [a, b, c, d] = await Promise.all([api('/api/commerce/settings'), api('/api/commerce/social/status'), api('/api/commerce/social/telegram-notify').catch(() => null), api('/api/commerce/stats?days=7').catch(() => null)]);
      setData(a); setSocial(b); setNotify(c); setStats(d);
    } catch (e: any) { show(e?.message || t('common.error'), 'error'); }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { document.body.style.overflow = sheet ? 'hidden' : ''; return () => { document.body.style.overflow = ''; }; }, [sheet]);

  const s = data?.settings;
  const products = Number(data?.products || 0);
  const hasKey = !!data?.key?.configured;
  const hasPolicies = !!(s?.policies || '').trim();
  const hasBrand = !!(s?.brand_name || '').trim();
  const hasNotify = (notify?.subscribers?.length || 0) > 0;
  const cur = stats?.snapshot?.current || {};
  const copy = (text: string, key: string) => { navigator.clipboard.writeText(text).then(() => { setCopied(key); show(t('common.copied')); window.setTimeout(() => setCopied(null), 1500); }); };
  const shareLink = async () => {
    const url = s?.shareUrl; if (!url) return;
    if (navigator.share) { try { await navigator.share({ title: s.share_title || s.brand_name || '', text: s.share_description || '', url }); return; } catch { /* отмена */ } }
    copy(url, 'link');
  };

  const steps = [
    { id: 'catalog', done: products > 0, title: t('home.steps.catalog.title'), text: t('home.steps.catalog.text'), actions: [{ label: t('home.actions.site'), icon: Globe, run: () => setSheet('site') }, { label: t('home.actions.instagram'), icon: Instagram, run: () => setSheet('instagram') }, { label: t('home.actions.tiktok'), icon: Music2, run: () => setSheet('tiktok') }, { label: t('home.actions.telegram'), icon: Send, run: () => setSheet('telegram') }] },
    { id: 'key', done: hasKey, title: t('home.steps.key.title'), text: t('home.steps.key.text'), actions: [{ label: t('home.actions.enterKey'), icon: KeyRound, run: () => navigate('/commerce/settings') }] },
    { id: 'policies', done: hasPolicies, title: t('home.steps.policies.title'), text: t('home.steps.policies.text'), actions: [{ label: t('home.actions.fill'), icon: FileText, run: () => navigate('/commerce/settings') }] },
    { id: 'widget', done: hasBrand && !!(s?.greeting || '').trim(), title: t('home.steps.widget.title'), text: t('home.steps.widget.text'), actions: [{ label: t('home.actions.widget'), icon: MessageSquareText, run: () => navigate('/commerce/widget') }] },
    { id: 'notify', done: hasNotify, title: t('home.steps.notify.title'), text: t('home.steps.notify.text'), actions: [{ label: t('home.actions.connect'), icon: Bell, run: () => setSheet('notify') }] },
  ];
  const active = steps.find((x) => !x.done);
  const doneCount = steps.filter((x) => x.done).length;

  const sources = [
    { key: 'site' as const, icon: Globe, label: t('home.actions.site'), status: s?.site_url ? (s?.crawl?.state === 'done' ? t('home.sourceStatus.positions', { n: s.crawl.products_found || 0 }) : s.site_url.replace(/^https?:\/\//, '').slice(0, 22)) : t('home.sourceStatus.add') },
    { key: 'instagram' as const, icon: Instagram, label: 'Instagram', status: social?.instagram?.status === 'connected' ? `@${social.instagram.username}` : social?.instagramAccount?.username ? `@${social.instagramAccount.username}` : t('home.sourceStatus.login') },
    { key: 'tiktok' as const, icon: Music2, label: 'TikTok', status: social?.tiktok?.username ? `@${social.tiktok.username}` : t('home.sourceStatus.add') },
    { key: 'telegram' as const, icon: Send, label: 'Telegram', status: social?.telegram?.username ? `@${social.telegram.username}` : t('home.sourceStatus.add') },
  ];
  const sheetTitle: Record<string, string> = { site: t('home.sheet.site'), instagram: t('home.sheet.instagram'), tiktok: t('home.sheet.tiktok'), telegram: t('home.sheet.telegram'), code: t('home.sheet.code'), link: t('home.sheet.link'), notify: t('home.sheet.notify') };

  return (
    <div className="space-y-5">
      {toast}
      <div>
        <h1 className="text-2xl font-700" style={{ fontFamily: 'Space Grotesk, sans-serif', color: 'var(--text-primary)' }}>{s?.brand_name || t('home.titleDefault')}</h1>
        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>{products ? t('home.catalogCount', { n: products }) : t('home.catalogEmpty')}{s?.currency ? ` · ${s.currency}` : ''} · {t('home.stepsDone', { done: doneCount, total: steps.length })}</div>
      </div>

      {active ? (
      <div className="grid xl:grid-cols-2 gap-5 items-start">
      <div className="space-y-5">
      <div className="rounded-3xl p-4" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#f59e0b,#ef4444)' }}><MessageSquareText size={18} color="#fff" /></div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-600 uppercase mb-1" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>{t('home.helper')}</div>
            {steps.filter((x) => x.done).map((x) => <div key={x.id} className="text-sm flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}><Check size={14} style={{ color: '#10b981' }} /> {x.title}</div>)}
            {active ? (
              <div className="mt-2 rounded-2xl rounded-tl-md px-3.5 py-3" style={{ background: 'var(--bg-tertiary)' }}>
                <div className="text-sm font-700" style={{ color: 'var(--text-primary)' }}>{t('home.stepOf', { n: steps.indexOf(active) + 1, total: steps.length, title: active.title })}</div>
                <div className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{active.text}</div>
                <div className="flex gap-2 flex-wrap mt-3">
                  {active.actions.map((a) => <Btn key={a.label} onClick={a.run}><a.icon size={15} /> {a.label}</Btn>)}
                </div>
              </div>
            ) : (
              <div className="mt-2 rounded-2xl rounded-tl-md px-3.5 py-3 text-sm" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>{t('home.allDone')}</div>
            )}
          </div>
        </div>
      </div>

      </div>
      <div className="space-y-5">
      <div>
        <div className="text-[11px] font-600 uppercase mb-2" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>{t('home.sourcesTitle')}</div>
        <div className="grid grid-cols-4 gap-2">
          {sources.map((x) => (
            <button key={x.key} type="button" onClick={() => setSheet(x.key)} className="rounded-2xl p-3 flex flex-col items-center gap-1.5 text-center active:scale-95 transition-transform" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
              <span className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}><x.icon size={22} strokeWidth={1.6} /></span>
              <span className="text-xs font-600" style={{ color: 'var(--text-primary)' }}>{x.label}</span>
              <span className="text-[10px] leading-tight truncate w-full" style={{ color: 'var(--text-muted)' }}>{x.status}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-[11px] font-600 uppercase mb-2" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>{t('home.launchTitle')}</div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { icon: MessageSquareText, label: t('home.launch.widget.label'), sub: t('home.launch.widget.sub'), run: () => navigate('/commerce/widget') },
            { icon: Code2, label: t('home.launch.code.label'), sub: t('home.launch.code.sub'), run: () => setSheet('code') },
            { icon: Link2, label: t('home.launch.link.label'), sub: t('home.launch.link.sub'), run: () => setSheet('link') },
          ].map((x) => (
            <button key={x.label} type="button" onClick={x.run} className="rounded-2xl p-3 flex flex-col items-center gap-1.5 text-center active:scale-95 transition-transform" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
              <span className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}><x.icon size={22} strokeWidth={1.6} /></span>
              <span className="text-xs font-600" style={{ color: 'var(--text-primary)' }}>{x.label}</span>
              <span className="text-[10px] leading-tight" style={{ color: 'var(--text-muted)' }}>{x.sub}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => navigate('/commerce/dialogs')} className="rounded-2xl p-3 text-left" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
          <div className="text-[11px] uppercase flex items-center gap-1" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}><MessagesSquare size={12} /> {t('home.dialogs7')}</div>
          <div className="text-2xl font-700" style={{ color: 'var(--text-primary)' }}>{cur.dialogs ?? '—'}</div>
        </button>
        <button type="button" onClick={() => navigate('/commerce/leads')} className="rounded-2xl p-3 text-left" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
          <div className="text-[11px] uppercase flex items-center gap-1" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}><Inbox size={12} /> {t('home.leads7')}</div>
          <div className="text-2xl font-700" style={{ color: 'var(--text-primary)' }}>{cur.leads ?? '—'}</div>
        </button>
      </div>

      </div>
      </div>
      ) : (
        // Настройка пройдена: главная — агент владельца со сводкой; быстрые иконки виджета, кода и бота остаются.
        <div className="space-y-5">
          <div className="flex gap-2 flex-wrap">
            {[
              { icon: MessageSquareText, label: t('home.launch.widget.label'), run: () => navigate('/commerce/widget') },
              { icon: Code2, label: t('home.launch.code.label'), run: () => setSheet('code') },
              { icon: Link2, label: t('home.launch.link.label'), run: () => setSheet('link') },
              { icon: Globe, label: t('nav.sub.sources'), run: () => navigate('/commerce/settings#sources') },
            ].map((x) => <Btn key={x.label} variant="ghost" onClick={x.run}><x.icon size={15} /> {x.label}</Btn>)}
          </div>
          <CommerceMerchantPage embedded />
        </div>
      )}
      {sheet ? (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center" style={{ background: 'rgba(0,0,0,.55)' }} onClick={() => { setSheet(null); void load(); }}>
          <div className="w-full sm:max-w-2xl max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5 pb-[max(20px,env(safe-area-inset-bottom))]" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-lg font-700" style={{ color: 'var(--text-primary)' }}>{sheetTitle[sheet]}</div>
              <button type="button" onClick={() => { setSheet(null); void load(); }} className="p-2 rounded-xl" style={{ color: 'var(--text-muted)' }} aria-label={t('common.close')}><X size={18} /></button>
            </div>
            {sheet === 'site' ? <SiteAnalyzePanel compact onChanged={() => void load()} /> : null}
            {sheet === 'instagram' || sheet === 'tiktok' || sheet === 'telegram' ? <SocialImportCard only={sheet} compact onProductsChanged={() => void load()} /> : null}
            {sheet === 'notify' ? <TelegramNotifyCard compact onChanged={() => void load()} /> : null}
            {sheet === 'code' && s ? (
              <div className="space-y-3">
                <CopyRow text={s.embedSnippet} />
                <div className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('home.codeHint')}</div>
              </div>
            ) : null}
            {sheet === 'link' && s ? (
              <div className="space-y-3">
                <CopyRow text={s.shareUrl} />
                <div className="flex gap-2 flex-wrap">
                  <Btn onClick={() => void shareLink()}><Share2 size={15} /> {t('common.share')}</Btn>
                  <a href={s.shareUrl} target="_blank" rel="noreferrer"><Btn variant="ghost"><ExternalLink size={15} /> {t('common.open')}</Btn></a>
                </div>
                <div className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('home.linkHint')}</div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
