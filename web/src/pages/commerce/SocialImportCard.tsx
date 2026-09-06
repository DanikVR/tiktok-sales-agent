/**
 * Соцсети → каталог: Instagram (вход владельца через наш шлюз, код подтверждения при запросе),
 * TikTok (публичный профиль по ссылке) и Telegram-канал (веб-превью t.me/s). Выбор «сколько последних
 * постов» с градациями, глубина анализа, продолжение старее. i18n `commerce`.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Instagram, Music2, Send, Loader2, LogOut, KeyRound, Sparkles } from 'lucide-react';
import { api } from './api';
import { Card, Btn, Input, Field, useToast } from './ui';
import { CrawlResult } from './CrawlResult';

interface SocialAccount { username: string; last_analyzed_at?: string; posts?: number; analyzed_total?: number; oldest_post_at?: string | null }
const SRC_LABEL: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', telegram: 'Telegram' };

interface SocialStatus {
  instagram: { available: boolean; status: string; username: string | null; challenge?: { method?: string } | null; error?: string | null };
  tiktok: SocialAccount | null;
  telegram: SocialAccount | null;
  instagramAccount: SocialAccount | null;
  job: any; summary: any; limits: number[]; currency: string;
}

type Src = 'instagram' | 'tiktok' | 'telegram';

export default function SocialImportCard({ onProductsChanged, only, compact = false }: { onProductsChanged: () => void; only?: Src; compact?: boolean }) {
  const { t } = useTranslation('commerce');
  const [st, setSt] = useState<SocialStatus | null>(null);
  const [ig, setIg] = useState({ username: '', password: '', proxy: '' });
  const [showProxy, setShowProxy] = useState(false);
  const [code, setCode] = useState('');
  const [tt, setTt] = useState('');
  const [tg, setTg] = useState('');
  const [limit, setLimit] = useState(25);
  const [depth, setDepth] = useState<'fast' | 'deep'>('fast');
  const [busy, setBusy] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [toast, show] = useToast();
  const prevJob = useRef<string | null>(null);

  const load = async () => {
    try {
      const r = await api<SocialStatus>('/api/commerce/social/status');
      setSt(r);
      if (!tt && r.tiktok?.username) setTt(`@${r.tiktok.username}`);
      if (!tg && r.telegram?.username) setTg(`@${r.telegram.username}`);
      const state = r.job?.state || 'idle';
      if (prevJob.current === 'running' && state !== 'running') {
        setDismissed(false);
        show(state === 'done' ? t('social.done', { n: r.job.products_found || 0 }) : t('social.failed'), state === 'done' ? 'ok' : 'error');
        onProductsChanged();
      }
      prevJob.current = state;
    } catch (e: any) { show(e?.message || t('common.error'), 'error'); }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const running = st?.job?.state === 'running';
  const igState = st?.instagram?.status || 'disconnected';
  useEffect(() => {
    if (!running && igState !== 'connecting' && igState !== 'challenge_required') return;
    const tm = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, igState]);

  const call = async (key: string, path: string, body?: any, okMsg?: string) => {
    setBusy(key);
    try { const r = await api(path, { method: 'POST', body: JSON.stringify(body || {}) }); if (okMsg) show(okMsg); await load(); return r; } catch (e: any) { show(e?.message || t('common.error'), 'error'); return null; } finally { setBusy(null); }
  };
  const analyze = async (source: Src, offset = 0) => {
    setDismissed(false);
    const r = await call(`analyze-${source}`, '/api/commerce/social/analyze', { source, handle: source === 'telegram' ? tg : tt, limit, depth, offset }, offset ? t('social.startedFrom', { n: offset + 1 }) : t('social.started'));
    if (r) prevJob.current = 'running';
  };

  const igConnected = igState === 'connected';
  const job = st?.job;
  const accountOf = (k: Src): SocialAccount | null => (k === 'instagram' ? st?.instagramAccount : k === 'tiktok' ? st?.tiktok : st?.telegram) || null;
  const continuable = (['instagram', 'tiktok', 'telegram'] as const).filter((k) => (accountOf(k)?.analyzed_total || 0) > 0).filter((k) => !only || k === only);
  const showSrc = (k: Src) => !only || only === k;
  const box: React.CSSProperties = { background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' };

  return (
    <Card title={compact ? undefined : t('social.title')}>
      {toast}
      <div className="grid gap-4">
        {showSrc('instagram') ? <div className="rounded-2xl p-4" style={box}>
          <div className="flex items-center gap-2 mb-2 text-sm font-700" style={{ color: 'var(--text-primary)' }}><Instagram size={16} /> {t('social.instagram')}</div>
          {st && !st.instagram.available ? (
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('social.igUnavailable')}</div>
          ) : igConnected ? (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-sm" style={{ color: 'var(--text-primary)' }}>@{st?.instagram.username} <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,.12)', color: '#10b981' }}>{t('social.connected')}</span>{st?.instagramAccount?.last_analyzed_at ? <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{t('social.lastAnalysis', { date: new Date(st.instagramAccount.last_analyzed_at).toLocaleString(), n: st.instagramAccount.posts })}</div> : null}</div>
              <Btn variant="ghost" disabled={busy === 'ig-logout'} onClick={() => void call('ig-logout', '/api/commerce/social/instagram/logout', {}, t('social.disconnected'))}><LogOut size={14} /> {t('social.disconnect')}</Btn>
            </div>
          ) : igState === 'challenge_required' ? (
            <div>
              <div className="text-sm mb-2" style={{ color: 'var(--text-primary)' }}>{t('social.challenge', { where: st?.instagram.challenge?.method === '2fa' ? t('social.challenge2fa') : t('social.challengeCode') })}</div>
              <div className="flex gap-2"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('social.code')} inputMode="numeric" autoComplete="one-time-code" className="w-40" /><Btn disabled={busy === 'ig-code' || code.trim().length < 4} onClick={() => void call('ig-code', '/api/commerce/social/instagram/challenge', { code: code.trim() })}><KeyRound size={14} /> {t('social.confirm')}</Btn></div>
            </div>
          ) : igState === 'connecting' ? (
            <div className="text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}><Loader2 size={14} className="animate-spin" /> {t('social.connecting')}</div>
          ) : (
            <div className="space-y-2">
              {st?.instagram.error ? <div className="text-xs" style={{ color: '#ef4444' }}>{st.instagram.error}</div> : null}
              <Input value={ig.username} onChange={(e) => setIg({ ...ig, username: e.target.value })} placeholder={t('social.login')} autoComplete="off" name="comag_ig_user" />
              <Input value={ig.password} onChange={(e) => setIg({ ...ig, password: e.target.value })} placeholder={t('social.password')} type="password" autoComplete="new-password" name="comag_ig_pass" />
              {showProxy ? <Input value={ig.proxy} onChange={(e) => setIg({ ...ig, proxy: e.target.value })} placeholder={t('social.proxy')} autoComplete="off" /> : <button type="button" className="text-[11px] underline" style={{ color: 'var(--text-muted)' }} onClick={() => setShowProxy(true)}>{t('social.proxyLink')}</button>}
              <div className="flex items-center gap-2 flex-wrap">
                <Btn disabled={busy === 'ig-connect' || !ig.username || !ig.password} onClick={() => void call('ig-connect', '/api/commerce/social/instagram/connect', { username: ig.username, password: ig.password, proxy: ig.proxy || null })}>{busy === 'ig-connect' ? <Loader2 size={14} className="animate-spin" /> : <Instagram size={14} />} {t('social.enter')}</Btn>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{t('social.passwordNote')}</span>
              </div>
            </div>
          )}
        </div> : null}

        {showSrc('tiktok') ? <div className="rounded-2xl p-4" style={box}>
          <div className="flex items-center gap-2 mb-2 text-sm font-700" style={{ color: 'var(--text-primary)' }}><Music2 size={16} /> {t('social.tiktok')}</div>
          <Input value={tt} onChange={(e) => setTt(e.target.value)} placeholder={t('social.ttPlaceholder')} autoComplete="off" name="comag_tt" />
          <div className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>{t('social.ttNote')}{st?.tiktok?.last_analyzed_at ? ` ${t('social.lastAnalysisShort', { date: new Date(st.tiktok.last_analyzed_at).toLocaleString(), n: st.tiktok.posts })}` : ''}</div>
        </div> : null}

        {showSrc('telegram') ? <div className="rounded-2xl p-4" style={box}>
          <div className="flex items-center gap-2 mb-2 text-sm font-700" style={{ color: 'var(--text-primary)' }}><Send size={16} /> {t('social.telegram')}</div>
          <Input value={tg} onChange={(e) => setTg(e.target.value)} placeholder={t('social.tgPlaceholder')} autoComplete="off" name="comag_tg" />
          <div className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>{t('social.tgNote')}{st?.telegram?.last_analyzed_at ? ` ${t('social.lastAnalysisShort', { date: new Date(st.telegram.last_analyzed_at).toLocaleString(), n: st.telegram.posts })}` : ''}</div>
        </div> : null}
      </div>

      <div className="grid gap-4 mt-4">
        <Field label={t('social.limitLabel')} hint={t('social.limitHint', { time: t(`social.limitTime.${limit}`) })}>
          <div className="flex gap-1.5">
            {(st?.limits || [10, 25, 50, 100]).map((n) => <button key={n} type="button" onClick={() => setLimit(n)} className="px-3 py-2 rounded-xl text-sm" style={limit === n ? { background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' } : { background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}>{n}</button>)}
          </div>
        </Field>
        <Field label={t('social.depthLabel')}>
          <div className="flex flex-col gap-1.5 text-sm" style={{ color: 'var(--text-primary)' }}>
            <label className="flex items-start gap-2"><input type="radio" name="comag_depth" checked={depth === 'fast'} onChange={() => setDepth('fast')} className="mt-1" /><span><b>{t('social.fast')}</b>: {t('social.fastText')}</span></label>
            <label className="flex items-start gap-2"><input type="radio" name="comag_depth" checked={depth === 'deep'} onChange={() => setDepth('deep')} className="mt-1" /><span><b>{t('social.deep')}</b>: {t('social.deepText')}</span></label>
          </div>
        </Field>
      </div>

      <div className="flex gap-2 mt-4 flex-wrap">
        {showSrc('instagram') ? <Btn disabled={running || !igConnected || !!busy} onClick={() => void analyze('instagram')}>{running && job?.platform === 'instagram' ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {t('social.analyzeIg')}</Btn> : null}
        {showSrc('tiktok') ? <Btn disabled={running || !tt.trim() || !!busy} onClick={() => void analyze('tiktok')}>{running && job?.platform === 'tiktok' ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {t('social.analyzeTt')}</Btn> : null}
        {showSrc('telegram') ? <Btn disabled={running || !tg.trim() || !!busy} onClick={() => void analyze('telegram')}>{running && job?.platform === 'telegram' ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {t('social.analyzeTg')}</Btn> : null}
      </div>
      {continuable.length ? (
        <div className="flex gap-2 mt-2 flex-wrap items-center">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('social.continue')}</span>
          {continuable.map((k) => { const a = accountOf(k)!; return (
            <Btn key={k} variant="ghost" disabled={running || !!busy || (k === 'instagram' && !igConnected)} onClick={() => void analyze(k, a.analyzed_total || 0)} title={a.oldest_post_at ? t('social.oldest', { date: new Date(a.oldest_post_at).toLocaleDateString() }) : undefined}>
              {t('social.next', { src: SRC_LABEL[k], n: limit, done: a.analyzed_total })}
            </Btn>
          ); })}
        </div>
      ) : null}

      {running ? (
        <div className="mt-3 rounded-xl px-3 py-2.5 text-sm flex items-center gap-2 flex-wrap" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
          <Loader2 size={14} className="animate-spin" /> {job.phase || t('social.progress')} <span style={{ color: 'var(--text-muted)' }}>· {job.pages_total ? t('social.postsOf', { seen: job.pages_seen || 0, total: job.pages_total }) : t('social.posts', { seen: job.pages_seen || 0 })}, {t('social.found', { n: job.products_found || 0 })}</span>
        </div>
      ) : null}
      {job && job.state === 'error' && !dismissed ? (
        <div className="mt-3 rounded-2xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,.10)', border: '1px solid rgba(239,68,68,.35)', color: 'var(--text-primary)' }}>
          <div className="font-700 mb-1">{t('social.notDone')}</div>
          <div>{job.message}</div>
          <div className="flex gap-2 mt-3"><Btn variant="ghost" onClick={() => setDismissed(true)}>{t('common.hide')}</Btn></div>
        </div>
      ) : null}
      {job && job.state === 'done' && !dismissed ? <CrawlResult crawl={job} summary={st?.summary} onHide={() => setDismissed(true)} mode="social" /> : null}
    </Card>
  );
}
