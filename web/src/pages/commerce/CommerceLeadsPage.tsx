/** Заявки: контакты из формы, сводки чекаута и покупки по пикселю; статусы работы. i18n `commerce`. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { api, fmtDate, fmtMoney } from './api';
import { Card, Empty, Select, CopyInline, useToast } from './ui';

const KINDS = ['callback', 'checkout', 'purchase', 'cart'];
const STATUSES = ['new', 'contacted', 'won', 'lost'];

export default function CommerceLeadsPage() {
  const { t } = useTranslation('commerce');
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, show] = useToast();
  const load = () => { setLoading(true); api(`/api/commerce/leads?limit=100${status ? `&status=${status}` : ''}`).then((r) => { setItems(r.items); setTotal(r.total); }).catch((e) => show(e?.message, 'error')).finally(() => setLoading(false)); };
  useEffect(() => { load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  const setLeadStatus = async (id: string, st: string) => { try { const r = await api(`/api/commerce/leads/${id}`, { method: 'PATCH', body: JSON.stringify({ status: st }) }); setItems((xs) => xs.map((x) => (x.id === id ? r.lead : x))); } catch (e: any) { show(e?.message, 'error'); } };

  return (
    <div className="space-y-5">
      {toast}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-700" style={{ fontFamily: 'Space Grotesk, sans-serif', color: 'var(--text-primary)' }}>{t('leads.title')} <span className="text-base font-500" style={{ color: 'var(--text-muted)' }}>{total}</span></h1>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44"><option value="">{t('leads.allStatuses')}</option>{STATUSES.map((k) => <option key={k} value={k}>{t(`leads.status.${k}`)}</option>)}</Select>
      </div>
      <Card>
        {loading ? <Empty><Loader2 className="animate-spin inline" /></Empty> : items.length === 0 ? <Empty>{t('leads.empty')}</Empty> : (
          <div className="grid xl:grid-cols-2 gap-3">
            {items.map((l) => (
              <div key={l.id} className="rounded-2xl p-3 min-w-0 space-y-2" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span className="px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>{KINDS.includes(l.kind) ? t(`leads.kind.${l.kind}`) : l.kind}</span>
                    <span>{fmtDate(l.created_at)}</span>
                    {l.conversation_id ? <Link to={`/commerce/dialogs/${l.conversation_id}`} className="underline">{t('leads.dialog')}</Link> : null}
                  </div>
                  <Select value={l.status} onChange={(e) => void setLeadStatus(l.id, e.target.value)} className="w-36 py-1.5">{STATUSES.map((k) => <option key={k} value={k}>{t(`leads.status.${k}`)}</option>)}</Select>
                </div>
                <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
                  {l.contact?.name || l.contact?.phone || l.contact?.email ? <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">{l.contact?.name ? <span>{l.contact.name}</span> : null}{l.contact?.phone ? <CopyInline text={l.contact.phone} /> : null}{l.contact?.email ? <CopyInline text={l.contact.email} /> : null}</span> : '—'}
                  {l.note ? <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{l.note}</div> : null}
                </div>
                {(l.items || []).length ? <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{(l.items || []).slice(0, 3).map((i: any) => `${i.title} × ${i.quantity}`).join(', ')}{(l.items || []).length > 3 ? ` +${l.items.length - 3}` : ''}</div> : null}
                {l.total != null ? <div className="text-sm font-600" style={{ color: 'var(--text-primary)' }}>{fmtMoney(l.total, l.currency)}</div> : null}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
