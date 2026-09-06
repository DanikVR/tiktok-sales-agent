/** Диалоги виджета: список и расшифровка с карточками, которые видел покупатель. i18n `commerce`. */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Loader2, ChevronRight, Search, Bell, Flame } from 'lucide-react';
import { api, fmtDate, fmtMoney } from './api';
import { Card, Empty, CopyInline, Input, Btn, Textarea, useToast } from './ui';
import { AGENT_CSS, ProductCards, Comparison, CheckoutCard, Suggestions, PostCards, strings } from '../../components/commerce/AgentComponents';

const vars: React.CSSProperties = {
  ['--cg-accent' as any]: 'var(--accent-green)', ['--cg-accent-rgb' as any]: '16,185,129', ['--cg-bg' as any]: 'var(--bg-secondary)', ['--cg-surface' as any]: 'var(--bg-tertiary)',
  ['--cg-text' as any]: 'var(--text-primary)', ['--cg-muted' as any]: 'var(--text-muted)', ['--cg-muted-bg' as any]: 'var(--bg-elevated)', ['--cg-border' as any]: 'var(--border-subtle)',
};

export default function CommerceDialogsPage() {
  const { id } = useParams();
  return id ? <DialogView id={id} /> : <DialogList />;
}

function DialogList() {
  const { t } = useTranslation('commerce');
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const load = (query = q) => { setLoading(true); api(`/api/commerce/conversations?page=${page}&limit=30${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ''}`).then((r) => { setItems(r.items); setTotal(r.total); }).finally(() => setLoading(false)); };
  useEffect(() => { load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-700" style={{ fontFamily: 'Space Grotesk, sans-serif', color: 'var(--text-primary)' }}>{t('dialogs.title')} <span className="text-base font-500" style={{ color: 'var(--text-muted)' }}>{total}</span></h1>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (page !== 1) setPage(1); else load(); }}>
          <Input placeholder={t('dialogs.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
          <Btn variant="ghost" aria-label={t('common.search')}><Search size={15} /></Btn>
        </form>
      </div>
      <Card>
        {loading ? <Empty><Loader2 className="animate-spin inline" /></Empty> : items.length === 0 ? <Empty>{t('dialogs.empty')}</Empty> : (
          <div className="grid xl:grid-cols-2 gap-2">
            {items.map((c) => (
              <Link key={c.id} to={`/commerce/dialogs/${c.id}`} title={t('dialogs.open')} className="flex items-center gap-4 p-3 rounded-2xl hover:opacity-90 min-w-0" style={{ background: 'var(--bg-tertiary)' }}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{c.preview || '…'}</div>
                  <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{fmtDate(c.last_at)} · {t('dialogs.messages', { n: c.message_count })}{c.page_url ? ` · ${c.page_url.replace(/^https?:\/\//, '').slice(0, 60)}` : ''}</div>
                </div>
                {c.cart?.items?.length ? <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>🛒 {c.cart.items.length}</span> : null}
                {c.lead_count ? <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,.12)', color: '#10b981' }}>{t('dialogs.leadsN', { n: c.lead_count })}</span> : null}
                {c.intent === 'hot' || c.contact ? <span title={t('dialogs.clientBadge')} className="flex-shrink-0" style={{ color: '#ef4444' }}><Flame size={14} /></span> : null}
                {c.push_count ? <span title={t('dialogs.pushable')} className="flex-shrink-0" style={{ color: '#f59e0b' }}><Bell size={14} /></span> : null}
                <ChevronRight size={16} className="flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
              </Link>
            ))}
          </div>
        )}
        {total > 30 ? <div className="flex justify-end gap-2 mt-3"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="text-xs px-3 py-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }}>←</button><button type="button" disabled={page * 30 >= total} onClick={() => setPage(page + 1)} className="text-xs px-3 py-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }}>→</button></div> : null}
      </Card>
    </div>
  );
}

function DialogView({ id }: { id: string }) {
  const { t, i18n } = useTranslation('commerce');
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api(`/api/commerce/conversations/${id}`).then(setData).catch((e) => setErr(e?.message)); }, [id]);
  const s = strings(i18n.language);
  if (err) return <div style={{ color: '#ef4444' }}>{err}</div>;
  if (!data) return <div className="py-10 text-center"><Loader2 className="animate-spin inline" /></div>;
  const c = data.conversation;
  const noop = () => {};
  return (
    <div className="space-y-4" style={vars}>
      <style>{AGENT_CSS}</style>
      <Link to="/commerce/dialogs" className="inline-flex items-center gap-1 text-sm" style={{ color: 'var(--text-muted)' }}><ArrowLeft size={15} /> {t('dialogs.all')}</Link>
      <div className="grid lg:grid-cols-[1fr_300px] gap-4 items-start">
        <Card>
          <div className="space-y-3">
            {data.messages.map((m: any) => (
              <div key={m.id}>
                {m.role === 'user' ? (
                  <div className="ml-auto max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>{m.display?.text}</div>
                ) : (
                  <div className="max-w-[92%]">
                    {m.display?.text ? <div className="rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap" style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>{m.display.text}</div> : null}
                    {(m.display?.components || []).map((comp: any, i: number) => {
                      switch (comp.component) {
                        case 'products': return <ProductCards key={i} data={comp.data} s={s} onAdd={noop} onOpen={noop} accent="var(--accent-green)" openAsLink />;
                        case 'comparison': return <Comparison key={i} data={comp.data} s={s} onAdd={noop} accent="var(--accent-green)" />;
                        case 'checkout': return <CheckoutCard key={i} data={comp.data} s={s} onCheckout={noop} accent="var(--accent-green)" />;
                        case 'posts': return <PostCards key={i} data={comp.data} s={s} onOpen={noop} accent="var(--accent-green)" openAsLink />;
                        case 'suggestions': return <Suggestions key={i} chips={comp.data?.chips || []} onPick={noop} accent="var(--text-muted)" />;
                        case 'lead_form': return <div key={i} className="text-xs italic" style={{ color: 'var(--text-muted)' }}>{t('dialogs.leadFormShown')}{comp.data?.reason ? `: ${comp.data.reason}` : ''}</div>;
                        default: return null;
                      }
                    })}
                  </div>
                )}
              </div>
            ))}
            {!data.messages.length ? <Empty>{t('dialogs.noMessages')}</Empty> : null}
          </div>
        </Card>
        {/* Правая колонка (диалог, корзина, заявки, push) прилипает к верху при прокрутке переписки. */}
        <div className="space-y-3 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-1rem)] lg:overflow-y-auto">
          <Card title={t('dialogs.info')}>
            <dl className="text-sm space-y-1" style={{ color: 'var(--text-primary)' }}>
              <div className="flex justify-between gap-2"><dt style={{ color: 'var(--text-muted)' }}>{t('dialogs.started')}</dt><dd>{fmtDate(c.started_at)}</dd></div>
              <div className="flex justify-between gap-2"><dt style={{ color: 'var(--text-muted)' }}>{t('dialogs.lang')}</dt><dd>{c.lang || '—'}</dd></div>
              <div className="flex justify-between gap-2"><dt style={{ color: 'var(--text-muted)' }}>{t('dialogs.page')}</dt><dd className="truncate max-w-[160px]" title={c.page_url || ''}>{c.page_url ? c.page_url.replace(/^https?:\/\//, '') : '—'}</dd></div>
              <div className="flex justify-between gap-2"><dt style={{ color: 'var(--text-muted)' }}>{t('dialogs.tokens')}</dt><dd>{(c.usage?.input || 0) + (c.usage?.output || 0)} <span style={{ color: 'var(--text-muted)' }}>({t('dialogs.cache', { n: c.usage?.cache_read || 0 })})</span></dd></div>
            </dl>
          </Card>
          <VisitorCard visitor={data.visitor} push={Number(data.push || 0)} />
          <Card title={t('dialogs.cart')}>
            {c.cart?.items?.length ? <ul className="text-sm space-y-1">{c.cart.items.map((i: any) => <li key={i.product_id} className="flex justify-between gap-2"><span className="truncate" style={{ color: 'var(--text-primary)' }}>{i.title} × {i.quantity}</span><span style={{ color: 'var(--text-muted)' }}>{fmtMoney(i.price * i.quantity, c.cart.currency)}</span></li>)}</ul> : <div className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('dialogs.cartEmpty')}</div>}
          </Card>
          <ClientCard c={c} leads={data.leads || []} />
          <Card title={t('dialogs.leads')}>
            {data.leads?.length ? <ul className="text-sm space-y-2">{data.leads.map((l: any) => <li key={l.id} style={{ color: 'var(--text-primary)' }}><b>{t(`leads.kind.${l.kind}`)}</b> · {t(`leads.status.${l.status}`)}{l.total != null ? ` · ${fmtMoney(l.total, l.currency)}` : ''}{l.contact?.phone ? <> · <CopyInline text={l.contact.phone} /></> : null}{l.contact?.email ? <> · <CopyInline text={l.contact.email} /></> : null}</li>)}</ul> : <div className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('dialogs.leadsNone')}</div>}
          </Card>
          <PushCard id={id} />
        </div>
      </div>
    </div>
  );
}

/** Push покупателю из диалога: сколько устройств получат, отправить сейчас или по дате, история. */
function PushCard({ id }: { id: string }) {
  const { t } = useTranslation('commerce');
  const [st, setSt] = useState<any>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, show] = useToast();
  const load = () => api(`/api/commerce/conversations/${id}/push`).then(setSt).catch(() => setSt({ subscribers: 0, jobs: [] }));
  useEffect(() => { load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const submit = async () => {
    setBusy(true);
    try {
      const sendAt = when === 'later' && at ? new Date(at).toISOString() : null;
      await api(`/api/commerce/conversations/${id}/push`, { method: 'POST', body: JSON.stringify({ title, body, sendAt }) });
      show(sendAt ? t('dialogs.push.scheduled', { date: new Date(at).toLocaleString() }) : t('dialogs.push.sentOk'));
      setTitle(''); setBody(''); load();
    } catch (e: any) { show(e?.message, 'error'); }
    setBusy(false);
  };
  const cancel = async (jobId: string) => { try { await api(`/api/commerce/push-jobs/${jobId}`, { method: 'DELETE' }); load(); } catch (e: any) { show(e?.message, 'error'); } };
  const minLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return (
    <Card title={t('dialogs.push.title')}>
      {toast}
      {!st ? <Loader2 size={16} className="animate-spin" /> : !st.subscribers ? <div className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('dialogs.push.none')}</div> : (
        <div className="space-y-2">
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('dialogs.push.subscribers', { n: st.subscribers })} · {t('dialogs.push.limit', { n: st.limit, used: st.sentToday })}</div>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('dialogs.push.titleField')} maxLength={80} />
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('dialogs.push.bodyField')} maxLength={300} style={{ minHeight: 70 }} />
          <div className="flex flex-col gap-1.5 text-sm" style={{ color: 'var(--text-primary)' }}>
            <label className="flex items-center gap-2"><input type="radio" checked={when === 'now'} onChange={() => setWhen('now')} /> {t('dialogs.push.sendNow')}</label>
            <label className="flex items-center gap-2"><input type="radio" checked={when === 'later'} onChange={() => setWhen('later')} /> {t('dialogs.push.schedule')}</label>
            {when === 'later' ? <Input type="datetime-local" value={at} min={minLocal} onChange={(e) => setAt(e.target.value)} /> : null}
          </div>
          <Btn onClick={() => void submit()} disabled={busy || !title.trim() || !body.trim() || (when === 'later' && !at)}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Bell size={15} />} {when === 'later' ? t('dialogs.push.schedule') : t('dialogs.push.sendNow')}</Btn>
        </div>
      )}
      {st?.jobs?.length ? (
        <ul className="mt-3 space-y-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          {st.jobs.map((j: any) => (
            <li key={j.id} className="flex justify-between gap-2">
              <span className="truncate" style={{ color: 'var(--text-primary)' }}>{j.title}</span>
              <span className="whitespace-nowrap">{j.status === 'scheduled' ? <>{t('dialogs.push.scheduled', { date: new Date(j.send_at).toLocaleString() })} · <button type="button" className="underline" onClick={() => void cancel(j.id)}>{t('dialogs.push.cancel')}</button></> : j.status === 'cancelled' ? t('dialogs.push.cancelled') : t('dialogs.push.sent', { n: j.sent })}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

/** Покупатель без авторизации: устройство и браузер из User-Agent, язык, пояс, город по IP, источник, визиты, приложение, push. */
function VisitorCard({ visitor, push }: { visitor: any; push: number }) {
  const { t } = useTranslation('commerce');
  if (!visitor) return null;
  const ua = String(visitor.client?.ua || '');
  const isTablet = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
  const isPhone = /iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua);
  const os = /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Android/i.test(ua) ? 'Android' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : '';
  const browser = visitor.client?.inApp ? t('dialogs.visitor.inApp', { app: visitor.client.inApp }) : /Edg\//i.test(ua) ? 'Edge' : /OPR\//i.test(ua) ? 'Opera' : /Chrome\//i.test(ua) ? 'Chrome' : /Safari\//i.test(ua) ? 'Safari' : /Firefox\//i.test(ua) ? 'Firefox' : '';
  const device = `${isTablet ? t('dialogs.visitor.tablet') : isPhone ? t('dialogs.visitor.phone') : t('dialogs.visitor.desktop')}${os ? ` · ${os}` : ''}`;
  const city = [visitor.geo?.city, visitor.geo?.country].filter(Boolean).join(', ');
  const rows: Array<[string, string]> = [
    [t('dialogs.visitor.device'), ua ? device : t('dialogs.visitor.unknown')],
    [t('dialogs.visitor.browser'), browser || t('dialogs.visitor.unknown')],
    [t('dialogs.visitor.lang'), visitor.client?.lang || t('dialogs.visitor.unknown')],
    [t('dialogs.visitor.tz'), visitor.client?.tz || visitor.geo?.tz || t('dialogs.visitor.unknown')],
    [t('dialogs.visitor.city'), city || t('dialogs.visitor.unknown')],
    [t('dialogs.visitor.source'), visitor.source || t('dialogs.visitor.unknown')],
    [t('dialogs.visitor.visits'), String(visitor.visits || 1)],
    [t('dialogs.visitor.installed'), visitor.installed ? t('dialogs.visitor.installedYes') : t('dialogs.visitor.installedNo')],
    [t('dialogs.visitor.push'), push > 0 ? t('dialogs.visitor.pushOn') : t('dialogs.visitor.pushOff')],
  ];
  return (
    <Card title={t('dialogs.visitor.title')}>
      <dl className="text-sm space-y-1" style={{ color: 'var(--text-primary)' }}>
        {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-2"><dt style={{ color: 'var(--text-muted)' }}>{k}</dt><dd className="text-right truncate max-w-[170px]" title={v}>{v}</dd></div>)}
      </dl>
    </Card>
  );
}

/** Клиент: статус по сигналам (готов к покупке / интересуется / смотрит), оставленные данные, список сигналов. */
function ClientCard({ c, leads }: { c: any; leads: any[] }) {
  const { t } = useTranslation('commerce');
  const intent: string = c.intent || 'cold';
  const contact: Record<string, string> = { ...(c.contact || {}) };
  for (const l of leads) for (const k of ['name', 'phone', 'email']) if (l.contact?.[k] && !contact[k]) contact[k] = l.contact[k];
  const signals: any[] = Array.isArray(c.signals) ? c.signals : [];
  const pill = intent === 'hot' ? { background: 'rgba(239,68,68,.12)', color: '#ef4444' } : intent === 'warm' ? { background: 'rgba(245,158,11,.12)', color: '#f59e0b' } : { background: 'var(--bg-tertiary)', color: 'var(--text-muted)' };
  return (
    <Card title={t('dialogs.client.title')} right={<span className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1" style={pill}>{intent === 'hot' ? <Flame size={12} /> : null}{t(`dialogs.client.${intent}`)}</span>}>
      {contact.name || contact.phone || contact.email ? (
        <div className="text-sm mb-2 flex flex-wrap gap-x-3 gap-y-1" style={{ color: 'var(--text-primary)' }}>
          {contact.name ? <span className="font-600">{contact.name}</span> : null}
          {contact.phone ? <CopyInline text={contact.phone} /> : null}
          {contact.email ? <CopyInline text={contact.email} /> : null}
        </div>
      ) : <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>{t('dialogs.client.noContact')}</div>}
      {signals.length ? (
        <ul className="text-xs space-y-1">
          {signals.slice(-8).reverse().map((sg, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span style={{ color: 'var(--text-primary)' }}>{t(`dialogs.client.signal.${sg.k}`, { defaultValue: sg.k })}{sg.text ? <span style={{ color: 'var(--text-muted)' }}> — «{sg.text}»</span> : null}</span>
              <span className="whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{fmtDate(sg.at)}</span>
            </li>
          ))}
        </ul>
      ) : <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('dialogs.client.noSignals')}</div>}
    </Card>
  );
}
