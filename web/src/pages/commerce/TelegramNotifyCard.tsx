/**
 * Уведомления владельцу в Telegram. Основной путь — единый бот платформы (задаёт суперадмин):
 * кнопка «Подключить Telegram» → бот → Start → чат привязан к этому агенту. Запасной — свой бот. i18n `commerce`.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, RefreshCw, Loader2, Trash2, Send, Check, ExternalLink } from 'lucide-react';
import { api } from './api';
import { Card, Btn, Input, useToast } from './ui';

interface NotifyState {
  platformBot: { username: string; name: string } | null;
  mode: 'platform' | 'own';
  hasBotToken: boolean;
  bot: { id: number; username: string; name: string } | null;
  subscribers: Array<{ chatId: string; name: string; username: string | null }>;
}

export default function TelegramNotifyCard({ compact = false, onChanged }: { compact?: boolean; onChanged?: () => void }) {
  const { t } = useTranslation('commerce');
  const [st, setSt] = useState<NotifyState | null>(null);
  const [link, setLink] = useState<{ url: string; bot: string } | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [ownOpen, setOwnOpen] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, show] = useToast();
  const subsBefore = useRef(0);

  const load = async () => { try { const r = await api<NotifyState>('/api/commerce/social/telegram-notify'); setSt(r); return r; } catch (e: any) { show(e?.message, 'error'); return null; } };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const tm = window.setInterval(async () => {
      const r = await load();
      if (r && r.subscribers.length > subsBefore.current) { setWaiting(false); setLink(null); show(t('notify.linked')); onChanged?.(); }
      if (Date.now() - started > 3 * 60_000) setWaiting(false);
    }, 3000);
    return () => window.clearInterval(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  const call = async (key: string, path: string, method: string, body?: any, okMsg?: (r: any) => string) => {
    setBusy(key);
    try { const r = await api(path, { method, body: body ? JSON.stringify(body) : undefined }); if (okMsg) show(okMsg(r)); await load(); onChanged?.(); return r; } catch (e: any) { show(e?.message || t('common.error'), 'error'); return null; } finally { setBusy(null); }
  };
  const connect = async () => {
    setBusy('link');
    try {
      const r = await api('/api/commerce/social/telegram-link', { method: 'POST' });
      subsBefore.current = st?.subscribers.length || 0;
      setLink({ url: r.url, bot: r.bot });
      setWaiting(true);
      window.open(r.url, '_blank', 'noopener');
    } catch (e: any) { show(e?.message || t('common.error'), 'error'); } finally { setBusy(null); }
  };

  const body = (
    <div>
      {toast}
      {!st ? <div className="text-sm" style={{ color: 'var(--text-muted)' }}><Loader2 size={14} className="animate-spin inline" /></div> : (
        <div className="space-y-3">
          {st.subscribers.length ? (
            <div className="flex items-center gap-2 flex-wrap text-sm" style={{ color: 'var(--text-primary)' }}>
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,.12)', color: '#10b981' }}><Check size={12} className="inline" /> {t('notify.connectedBadge')}</span>
              <span style={{ color: 'var(--text-muted)' }}>{t('notify.botLine', { bot: st.mode === 'own' ? st.bot?.username : st.platformBot?.username, n: st.subscribers.length })}</span>
            </div>
          ) : (
            <div className="text-sm" style={{ color: 'var(--text-primary)' }}>{t('notify.intro')}</div>
          )}
          {st.subscribers.length ? (
            <ul className="text-sm space-y-1">
              {st.subscribers.map((x) => <li key={x.chatId} className="flex items-center justify-between gap-2" style={{ color: 'var(--text-primary)' }}><span>{x.name}{x.username ? <span style={{ color: 'var(--text-muted)' }}> @{x.username}</span> : null}</span><button type="button" className="p-1" style={{ color: 'var(--text-muted)' }} title={t('notify.remove')} onClick={() => void call(`rm-${x.chatId}`, `/api/commerce/social/telegram-notify/subscribers/${x.chatId}`, 'DELETE')}><Trash2 size={14} /></button></li>)}
            </ul>
          ) : null}
          {st.platformBot ? (
            <div className="flex gap-2 flex-wrap items-center">
              <Btn disabled={busy === 'link'} onClick={() => void connect()}>{busy === 'link' ? <Loader2 size={15} className="animate-spin" /> : <Bell size={15} />} {st.subscribers.length ? t('notify.addRecipient') : t('notify.connect')}</Btn>
              {st.subscribers.length ? <Btn variant="ghost" disabled={busy === 'test'} onClick={() => void call('test', '/api/commerce/social/telegram-notify/test', 'POST', undefined, (r) => t('notify.testSent', { sent: r.sent, total: r.total }))}><Send size={15} /> {t('notify.test')}</Btn> : null}
            </div>
          ) : !st.hasBotToken ? (
            <div className="text-sm rounded-xl px-3 py-2" style={{ background: 'rgba(245,158,11,.12)', color: 'var(--text-primary)' }}>{t('notify.noPlatform')}</div>
          ) : null}
          {waiting && link ? (
            <div className="rounded-xl px-3 py-2.5 text-sm flex items-center gap-2 flex-wrap" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
              <Loader2 size={14} className="animate-spin" /> {t('notify.waiting')}
              <a href={link.url} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-1">@{link.bot} <ExternalLink size={12} /></a>
              <button type="button" className="underline text-xs" style={{ color: 'var(--text-muted)' }} onClick={() => setWaiting(false)}>{t('common.cancel')}</button>
            </div>
          ) : null}

          <div>
            <button type="button" className="text-xs underline" style={{ color: 'var(--text-muted)' }} onClick={() => setOwnOpen((v) => !v)}>{ownOpen ? t('common.hide') : t('notify.ownToggle')}</button>
            {ownOpen ? (
              <div className="mt-2 space-y-2">
                {st.hasBotToken ? (
                  <div className="flex items-center gap-2 flex-wrap text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('notify.ownBot')} <a href={`https://t.me/${st.bot?.username}`} target="_blank" rel="noreferrer" className="underline">@{st.bot?.username}</a></span>
                    <Btn variant="ghost" disabled={busy === 'refresh'} onClick={() => void call('refresh', '/api/commerce/social/telegram-notify/refresh', 'POST', undefined, (r) => t('notify.recipients', { n: r.subscribers?.length ?? 0 }))}><RefreshCw size={14} /> {t('notify.sync')}</Btn>
                    <Btn variant="danger" disabled={busy === 'off'} onClick={() => void call('off', '/api/commerce/social/telegram-notify', 'PUT', { botToken: null }, () => t('notify.ownOffDone'))}>{t('notify.ownOff')}</Btn>
                  </div>
                ) : (
                  <>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('notify.ownHow')}</div>
                    <div className="flex gap-2 flex-wrap">
                      <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder={t('notify.tokenPlaceholder')} autoComplete="off" name="comag_tg_token" className="flex-1 min-w-[220px]" style={{ fontFamily: 'ui-monospace, monospace' }} />
                      <Btn variant="ghost" disabled={busy === 'connect' || token.trim().length < 20} onClick={() => void call('connect', '/api/commerce/social/telegram-notify', 'PUT', { botToken: token.trim() }, (r) => (r.subscribers?.length ? t('notify.ownConnected', { n: r.subscribers.length }) : t('notify.ownConnectedEmpty')))}>{busy === 'connect' ? <Loader2 size={15} className="animate-spin" /> : <Bell size={15} />} {t('notify.ownConnect')}</Btn>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
  return compact ? body : <Card title={t('notify.title')}>{body}</Card>;
}
