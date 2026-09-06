/**
 * Commerce Agents — рендер компонентов, которые агент отдаёт инструментами (по blueprint UI-tools):
 * products (карточки-лента), comparison, checkout, lead_form, posts (лента постов), suggestions (чипы)
 * для виджета; metrics, digest, change_preview для кабинета владельца. Все данные компонентов
 * заполнены сервером из каталога — модель передавала только id и причину.
 *
 * Строки: виджет получает словарь `w` (108 языков) из /w/:slug/config; здесь встроены ru/en как
 * запасной вариант. Кабинет передаёт `t` из i18next (пространство commerce).
 */
import React, { useEffect, useRef, useState } from 'react';

export type WidgetStrings = Record<string, any>;

export const STRINGS: Record<string, WidgetStrings> = {
  ru: { addToCart: 'В корзину', open: 'Открыть', outOfStock: 'Нет в наличии', hasOptions: 'Выбрать вариант', checkout: 'Перейти к оформлению', checkoutHint: 'Оформление и оплата проходят на сайте магазина', subtotal: 'Итого', leadTitle: 'Оставьте контакт', leadName: 'Имя', leadPhone: 'Телефон или мессенджер', leadEmail: 'Email', leadNote: 'Комментарий', leadSend: 'Отправить', leadSent: 'Спасибо, мы свяжемся с вами', leadError: 'Укажите телефон или email', compare: 'Сравнение', recommendation: 'Рекомендация', openPost: 'Открыть пост', askPrice: 'Узнать цену', priceOnRequest: 'Цена по запросу', service: 'Услуга', video: 'Видео', placeholder: 'Спросите о товаре…', send: 'Отправить', mic: 'Говорить', listening: 'Слушаю…', notReady: 'Ассистент пока не подключён', error: 'Не получилось ответить, попробуйте ещё раз', cart: 'Корзина', showCart: 'Покажи корзину', addMessage: 'Добавь в корзину: {{title}}', askMessage: 'Хочу узнать цену и условия: {{title}}', progress: { search: 'Ищу в каталоге…', details: 'Смотрю карточку товара…', policies: 'Проверяю условия магазина…', cart: 'Обновляю корзину…', checkout: 'Собираю сводку заказа…', memory: 'Вспоминаю…', think: 'Думаю…' }, poweredBy: 'Работает на Commerce Agents', added: 'Добавлено в корзину', greetingDefault: 'Здравствуйте! Помогу подобрать товар и ответить на вопросы.', starters: { empty1: 'Чем вы занимаетесь?', empty2: 'Как с вами связаться?', empty3: 'Ваши условия' } },
  en: { addToCart: 'Add to cart', open: 'Open', outOfStock: 'Out of stock', hasOptions: 'Choose option', checkout: 'Go to checkout', checkoutHint: 'Checkout and payment happen on the store\'s site', subtotal: 'Subtotal', leadTitle: 'Leave your contact', leadName: 'Name', leadPhone: 'Phone or messenger', leadEmail: 'Email', leadNote: 'Note', leadSend: 'Send', leadSent: 'Thank you, we will get back to you', leadError: 'Enter a phone or email', compare: 'Comparison', recommendation: 'Recommendation', openPost: 'Open post', askPrice: 'Ask for price', priceOnRequest: 'Price on request', service: 'Service', video: 'Video', placeholder: 'Ask about a product…', send: 'Send', mic: 'Speak', listening: 'Listening…', notReady: 'The assistant is not connected yet', error: 'Could not answer, please try again', cart: 'Cart', showCart: 'Show my cart', addMessage: 'Add to cart: {{title}}', askMessage: 'I\'d like to know the price and terms: {{title}}', progress: { search: 'Searching the catalog…', details: 'Reading the product…', policies: 'Checking store terms…', cart: 'Updating the cart…', checkout: 'Preparing the order summary…', memory: 'Recalling…', think: 'Thinking…' }, poweredBy: 'Powered by Commerce Agents', added: 'Added to cart', greetingDefault: 'Hi! I can help you choose and answer questions.', starters: { empty1: 'What do you do?', empty2: 'How can I contact you?', empty3: 'Your terms' } },
};
export function strings(lang: string | null | undefined, remote?: WidgetStrings | null): WidgetStrings {
  const base = STRINGS[(lang || 'en').slice(0, 2)] || STRINGS.en;
  if (!remote) return base;
  return { ...base, ...remote, progress: { ...base.progress, ...(remote.progress || {}) }, starters: { ...base.starters, ...(remote.starters || {}) } };
}
/** Подстановка {{var}} в строку словаря. */
export function fill(s: string, params: Record<string, string | number>): string {
  return String(s || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(params[k] ?? ''));
}

export function money(n: number | null | undefined, currency?: string | null): string {
  if (n == null || !Number.isFinite(Number(n))) return '';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'EUR', maximumFractionDigits: 0 }).format(Number(n)); } catch { return `${n} ${currency || ''}`; }
}

export interface ProductCardData {
  id: string; title: string; brand?: string | null; price: number; currency: string; compareAtPrice?: number | null; imageUrl?: string | null; url?: string | null;
  inStock: boolean; reason?: string | null; hasOptions?: boolean; category?: string | null; source?: string | null; kind?: string | null; isVideo?: boolean; priceOnRequest?: boolean;
}
export interface PostCardData { id: string; source: string; url: string; text: string; imageUrl?: string | null; takenAt?: string | null; reason?: string | null; isVideo?: boolean }

const SOURCE_NAME: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', telegram: 'Telegram' };
const PlayIcon = () => <span className="cg-play" aria-hidden><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg></span>;
const OpenIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7" /><path d="M8 7h9v9" /></svg>;

function Carousel({ children, count }: { children: React.ReactNode; count: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setCanScroll(el.scrollWidth > el.clientWidth + 8);
    const onScroll = () => { const first = el.firstElementChild as HTMLElement | null; const w = first ? first.getBoundingClientRect().width + 10 : 1; setActive(Math.max(0, Math.min(count - 1, Math.round(el.scrollLeft / w)))); };
    measure();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => { el.removeEventListener('scroll', onScroll); ro?.disconnect(); };
  }, [count]);
  const go = (dir: number) => { const el = ref.current; if (!el) return; const first = el.firstElementChild as HTMLElement | null; const w = first ? first.getBoundingClientRect().width + 10 : 220; el.scrollBy({ left: dir * w, behavior: 'smooth' }); };
  return (
    <div className="cg-carousel">
      <div className="cg-cards" ref={ref}>{children}</div>
      {canScroll ? (
        <>
          <button type="button" className="cg-arrow cg-arrow-l" aria-label="prev" onClick={() => go(-1)} disabled={active <= 0}>‹</button>
          <button type="button" className="cg-arrow cg-arrow-r" aria-label="next" onClick={() => go(1)} disabled={active >= count - 1}>›</button>
          <div className="cg-dots">{Array.from({ length: count }, (_, i) => <span key={i} className={`cg-dot-i ${i === active ? 'on' : ''}`} />)}</div>
        </>
      ) : null}
    </div>
  );
}

function LinkOrButton({ asLink, href, className, style, onClick, title, children, disabled }: { asLink: boolean; href?: string | null; className: string; style?: React.CSSProperties; onClick: () => void; title?: string; children: React.ReactNode; disabled?: boolean }) {
  if (asLink && href && !disabled) return <a className={className} style={style} href={href} target="_blank" rel="noopener noreferrer" title={title} onClick={(e) => { e.stopPropagation(); onClick(); }}>{children}</a>;
  return <button type="button" className={className} style={style} title={title} aria-label={title} disabled={disabled} onClick={(e) => { e.stopPropagation(); onClick(); }}>{children}</button>;
}

interface ProductsProps { data: { title?: string; items: ProductCardData[] }; s: WidgetStrings; onAdd: (p: ProductCardData) => void; onOpen: (p: ProductCardData) => void; onAsk?: (p: ProductCardData) => void; accent: string; openAsLink?: boolean }

export function ProductCards({ data, s, onAdd, onOpen, onAsk, accent, openAsLink = false }: ProductsProps) {
  const items = data.items || [];
  return (
    <div className="cg-block cg-block-cards">
      {data.title ? <div className="cg-block-title">{data.title}</div> : null}
      <Carousel count={items.length}>
        {items.map((p) => {
          const noPrice = p.priceOnRequest || !(Number(p.price) > 0);
          const isService = /услуг|service/i.test(String(p.kind || ''));
          const sale = p.compareAtPrice && p.compareAtPrice > p.price && !noPrice ? Math.round((1 - p.price / p.compareAtPrice) * 100) : 0;
          return (
            <div className="cg-card" key={p.id}>
              {React.createElement(openAsLink && p.url ? 'a' : 'div', { className: 'cg-card-img', role: 'button', ...(openAsLink && p.url ? { href: p.url, target: '_blank', rel: 'noopener noreferrer' } : {}), onClick: () => onOpen(p) },
                p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" /> : <div className="cg-card-noimg">{(p.title || '?').slice(0, 1).toUpperCase()}</div>,
                <div className="cg-card-shade" />,
                <div className="cg-card-badges">
                  {p.source ? <span className="cg-chip-src">{SOURCE_NAME[String(p.source).toLowerCase()] || p.source}</span> : null}
                  {isService ? <span className="cg-chip-src">{s.service}</span> : null}
                </div>,
                sale > 0 ? <span className="cg-badge cg-badge-sale">−{sale}%</span> : null,
                p.isVideo ? <PlayIcon /> : null,
                !p.inStock ? <span className="cg-badge cg-badge-oos">{s.outOfStock}</span> : null,
                <div className="cg-price-pill">
                  {noPrice ? <span className="cg-price-req">{s.priceOnRequest}</span> : <><span>{money(p.price, p.currency)}</span>{sale > 0 ? <s>{money(p.compareAtPrice, p.currency)}</s> : null}</>}
                </div>,
              )}
              <div className="cg-card-body">
                {p.brand ? <div className="cg-card-brand">{p.brand}</div> : (p.category ? <div className="cg-card-brand">{p.category}</div> : null)}
                <div className="cg-card-title" title={p.title}>{p.title}</div>
                {p.reason ? <div className="cg-card-reason">{p.reason}</div> : null}
                <div className="cg-card-actions">
                  {noPrice ? (
                    <button type="button" className="cg-btn cg-btn-primary" style={{ background: accent }} onClick={() => (onAsk ? onAsk(p) : onOpen(p))}>{s.askPrice}</button>
                  ) : p.hasOptions ? (
                    <LinkOrButton asLink={openAsLink} href={p.url} className="cg-btn cg-btn-primary" style={{ background: accent }} onClick={() => onOpen(p)}>{s.hasOptions}</LinkOrButton>
                  ) : (
                    <button type="button" className="cg-btn cg-btn-primary" style={{ background: accent }} disabled={!p.inStock} onClick={() => onAdd(p)}>{p.inStock ? s.addToCart : s.outOfStock}</button>
                  )}
                  {p.url ? <LinkOrButton asLink={openAsLink} href={p.url} className="cg-btn cg-btn-icon" title={s.open} onClick={() => onOpen(p)}><OpenIcon /></LinkOrButton> : null}
                </div>
              </div>
            </div>
          );
        })}
      </Carousel>
    </div>
  );
}

export function PostCards({ data, s, onOpen, openAsLink = false }: { data: { title?: string; items: PostCardData[] }; s: WidgetStrings; onOpen: (p: PostCardData) => void; accent: string; openAsLink?: boolean }) {
  const items = data.items || [];
  return (
    <div className="cg-block cg-block-cards">
      {data.title ? <div className="cg-block-title">{data.title}</div> : null}
      <Carousel count={items.length}>
        {items.map((p) => (
          React.createElement(openAsLink ? 'a' : 'div', { className: 'cg-post', key: p.id, role: 'button', ...(openAsLink ? { href: p.url, target: '_blank', rel: 'noopener noreferrer' } : {}), onClick: () => onOpen(p) },
            <div className="cg-post-img" key="img">
              {p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" /> : <div className="cg-post-noimg">{SOURCE_NAME[p.source] || p.source}</div>}
              <div className="cg-card-shade" />
              <div className="cg-card-badges"><span className="cg-chip-src">{SOURCE_NAME[p.source] || p.source}</span>{p.isVideo ? <span className="cg-chip-src">{s.video}</span> : null}</div>
              {p.isVideo ? <PlayIcon /> : null}
              {p.takenAt ? <span className="cg-post-date">{new Date(p.takenAt).toLocaleDateString()}</span> : null}
            </div>,
            <div className="cg-post-body" key="body">
              <div className="cg-post-text">{p.text}</div>
              {p.reason ? <div className="cg-card-reason">{p.reason}</div> : null}
              <span className="cg-btn cg-btn-ghost cg-btn-wide">{s.openPost} <OpenIcon /></span>
            </div>,
          )
        ))}
      </Carousel>
    </div>
  );
}

interface ComparisonProps { data: { title?: string; items: ProductCardData[]; rows: Array<{ label: string; values: string[] }>; recommendation?: string }; s: WidgetStrings; onAdd: (p: ProductCardData) => void; accent: string }

export function Comparison({ data, s, onAdd, accent }: ComparisonProps) {
  return (
    <div className="cg-block">
      <div className="cg-block-title">{data.title || s.compare}</div>
      <div className="cg-table-wrap">
        <table className="cg-table">
          <thead>
            <tr><th></th>{data.items.map((p) => <th key={p.id}><div className="cg-th">{p.imageUrl ? <img src={p.imageUrl} alt="" /> : null}<span>{p.title}</span></div></th>)}</tr>
          </thead>
          <tbody>
            <tr><td className="cg-td-label">{money(0, data.items[0]?.currency).replace(/[\d.,\s]/g, '') || '€'}</td>{data.items.map((p) => <td key={p.id}><b>{Number(p.price) > 0 ? money(p.price, p.currency) : s.priceOnRequest}</b></td>)}</tr>
            {data.rows.map((r) => <tr key={r.label}><td className="cg-td-label">{r.label}</td>{r.values.map((v, i) => <td key={i}>{v}</td>)}</tr>)}
            <tr><td></td>{data.items.map((p) => <td key={p.id}><button type="button" className="cg-btn cg-btn-primary cg-btn-sm" style={{ background: accent }} disabled={!p.inStock || p.hasOptions || !(Number(p.price) > 0)} onClick={() => onAdd(p)}>{s.addToCart}</button></td>)}</tr>
          </tbody>
        </table>
      </div>
      {data.recommendation ? <div className="cg-note"><b>{s.recommendation}:</b> {data.recommendation}</div> : null}
    </div>
  );
}

interface CheckoutProps { data: { items: Array<{ product_id: string; title: string; price: number; quantity: number; url?: string | null }>; subtotal: number; currency: string; note?: string; checkoutUrl?: string | null }; s: WidgetStrings; onCheckout: (url: string | null) => void; accent: string; href?: string | null }

export function CheckoutCard({ data, s, onCheckout, accent, href }: CheckoutProps) {
  return (
    <div className="cg-block cg-checkout">
      <div className="cg-block-title">{s.checkout}</div>
      <div className="cg-lines">
        {data.items.map((i) => <div className="cg-line" key={i.product_id}><span className="cg-line-title">{i.title}</span><span className="cg-line-qty">× {i.quantity}</span><span className="cg-line-sum">{money(i.price * i.quantity, data.currency)}</span></div>)}
      </div>
      <div className="cg-total"><span>{s.subtotal}</span><b>{money(data.subtotal, data.currency)}</b></div>
      {data.note ? <div className="cg-note">{data.note}</div> : null}
      <LinkOrButton asLink={!!href} href={href} className="cg-btn cg-btn-primary cg-btn-wide" style={{ background: accent }} onClick={() => onCheckout(data.checkoutUrl || null)}>{s.checkout}</LinkOrButton>
      <div className="cg-hint">{s.checkoutHint}</div>
    </div>
  );
}

interface LeadFormProps { data: { reason?: string }; s: WidgetStrings; accent: string; onSubmit: (v: { name: string; phone: string; email: string; note: string }) => Promise<boolean> }

export function LeadForm({ data, s, accent, onSubmit }: LeadFormProps) {
  const [v, setV] = React.useState({ name: '', phone: '', email: '', note: '' });
  const [state, setState] = React.useState<'idle' | 'busy' | 'sent' | 'error'>('idle');
  if (state === 'sent') return <div className="cg-block cg-lead"><div className="cg-lead-sent">✓ {s.leadSent}</div></div>;
  return (
    <form className="cg-block cg-lead" onSubmit={async (e) => { e.preventDefault(); if (!v.phone && !v.email) { setState('error'); return; } setState('busy'); const ok = await onSubmit(v); setState(ok ? 'sent' : 'error'); }}>
      <div className="cg-block-title">{s.leadTitle}</div>
      {data.reason ? <div className="cg-note">{data.reason}</div> : null}
      <input className="cg-input" placeholder={s.leadName} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      <input className="cg-input" placeholder={s.leadPhone} value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} inputMode="tel" />
      <input className="cg-input" placeholder={s.leadEmail} value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} inputMode="email" />
      <input className="cg-input" placeholder={s.leadNote} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
      {state === 'error' ? <div className="cg-error">{s.leadError}</div> : null}
      <button type="submit" className="cg-btn cg-btn-primary cg-btn-wide" style={{ background: accent }} disabled={state === 'busy'}>{s.leadSend}</button>
    </form>
  );
}

export function Suggestions({ chips, onPick, accent }: { chips: string[]; onPick: (c: string) => void; accent: string }) {
  return <div className="cg-chips">{chips.map((c) => <button type="button" key={c} className="cg-chip" style={{ borderColor: accent, color: accent }} onClick={() => onPick(c)}>{c}</button>)}</div>;
}

// ── кабинет владельца (подписи через t из пространства commerce; запасной — английский) ──
export type CabinetT = (key: string, params?: Record<string, string | number>) => string;
const EN_LABELS: Record<string, string> = { 'components.apply': 'Apply', 'components.discard': 'Discard', 'components.staged': 'awaiting approval', 'components.appliedStatus': 'applied', 'components.discardedStatus': 'discarded', 'components.kind.listing_update': 'Listing edit', 'components.kind.price_update': 'Price change', 'components.kind.inventory_action': 'Stock / visibility', 'components.metricsTitle': 'Metrics for {{n}} days', 'components.before': 'before: {{v}}', 'components.digestTitle': 'What needs attention', 'common.yes': 'yes', 'common.no': 'no' };
const fallbackT: CabinetT = (k, p) => fill(EN_LABELS[k] || k, p || {});

export function MetricsCard({ data, t = fallbackT }: { data: { title?: string; periodDays: number; currency?: string; tiles: Array<{ metric: string; label: string; value: number | null; previous: number | null }> }; t?: CabinetT }) {
  return (
    <div className="cg-block">
      <div className="cg-block-title">{data.title || t('components.metricsTitle', { n: data.periodDays })}</div>
      <div className="cg-tiles">
        {data.tiles.map((x) => {
          const delta = x.previous != null && x.previous > 0 && x.value != null ? Math.round(((x.value - x.previous) / x.previous) * 100) : null;
          const isMoney = x.metric === 'revenue';
          return (
            <div className="cg-tile" key={x.metric}>
              <div className="cg-tile-label">{x.label}</div>
              <div className="cg-tile-value">{isMoney ? money(x.value, data.currency) : (x.value ?? '—')}</div>
              <div className="cg-tile-prev">{x.previous != null ? t('components.before', { v: isMoney ? money(x.previous, data.currency) : x.previous }) : ''}{delta != null ? <span className={delta >= 0 ? 'cg-up' : 'cg-down'}> {delta >= 0 ? '+' : ''}{delta}%</span> : null}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DigestCard({ data, onAction, t = fallbackT }: { data: { title?: string; entries: Array<{ kind: string; headline: string; detail?: string; action?: string; listingId?: string | null }> }; onAction?: (text: string) => void; t?: CabinetT }) {
  const icon: Record<string, string> = { stock: '📦', demand: '🔎', catalog: '🗂', pricing: '🏷', change: '✏️', note: '•' };
  return (
    <div className="cg-block">
      <div className="cg-block-title">{data.title || t('components.digestTitle')}</div>
      <div className="cg-digest">
        {data.entries.map((e, i) => (
          <div className="cg-digest-row" key={i}>
            <div className="cg-digest-icon">{icon[e.kind] || '•'}</div>
            <div className="cg-digest-body">
              <div className="cg-digest-head">{e.headline}</div>
              {e.detail ? <div className="cg-digest-detail">{e.detail}</div> : null}
              {e.action && onAction ? <button type="button" className="cg-link" onClick={() => onAction(e.action!)}>{e.action} →</button> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChangePreview({ data, onApply, onDiscard, busy, t = fallbackT }: { data: { changeId: string; kind: string; status: string; note?: string | null; headline?: string; items: Array<{ target: string; target_title?: string; field: string; before: unknown; after: unknown }> }; onApply?: (id: string) => void; onDiscard?: (id: string) => void; busy?: boolean; t?: CabinetT }) {
  const fmt = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'boolean' ? (v ? t('common.yes') : t('common.no')) : String(v).length > 160 ? String(v).slice(0, 160) + '…' : String(v));
  const kindLabel = t(`components.kind.${data.kind}`);
  return (
    <div className="cg-block cg-change">
      <div className="cg-block-title">{data.headline || (kindLabel !== `components.kind.${data.kind}` ? kindLabel : data.kind)} <span className={`cg-status cg-status-${data.status}`}>{data.status === 'staged' ? t('components.staged') : data.status === 'applied' ? t('components.appliedStatus') : t('components.discardedStatus')}</span></div>
      <div className="cg-change-items">
        {data.items.map((it, i) => (
          <div className="cg-change-item" key={i}>
            <div className="cg-change-target">{it.target_title || it.target} <span className="cg-change-field">{it.field}</span></div>
            <div className="cg-change-diff"><span className="cg-before">{fmt(it.before)}</span><span className="cg-arrow">→</span><span className="cg-after">{fmt(it.after)}</span></div>
          </div>
        ))}
      </div>
      {data.note ? <div className="cg-note">{data.note}</div> : null}
      {data.status === 'staged' && onApply && onDiscard ? (
        <div className="cg-change-actions">
          <button type="button" className="cg-btn cg-btn-primary" disabled={busy} onClick={() => onApply(data.changeId)}>{t('components.apply')}</button>
          <button type="button" className="cg-btn cg-btn-ghost" disabled={busy} onClick={() => onDiscard(data.changeId)}>{t('components.discard')}</button>
        </div>
      ) : null}
    </div>
  );
}

/** Общие стили компонентов (виджет и кабинет). Вставляются один раз страницей. */
export const AGENT_CSS = `
.cg-block{border:1px solid var(--cg-border);border-radius:18px;padding:12px;background:var(--cg-surface);margin:6px 0;max-width:100%}
.cg-block-cards{padding:12px 0 8px}
.cg-block-cards .cg-block-title{padding:0 12px}
.cg-block-title{font-weight:600;font-size:13px;letter-spacing:.01em;margin-bottom:8px;color:var(--cg-text);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cg-carousel{position:relative}
.cg-cards{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;padding:2px 12px 6px;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.cg-cards::-webkit-scrollbar{display:none}
.cg-arrow{position:absolute;top:38%;width:32px;height:32px;border-radius:50%;border:1px solid var(--cg-border);background:var(--cg-bg);color:var(--cg-text);font-size:22px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.18);opacity:.92;transition:opacity .15s}
.cg-arrow:disabled{opacity:0;pointer-events:none}
.cg-arrow-l{left:2px}.cg-arrow-r{right:2px}
.cg-dots{display:flex;justify-content:center;gap:5px;margin-top:2px}
.cg-dot-i{width:6px;height:6px;border-radius:50%;background:var(--cg-muted);opacity:.3;transition:all .2s}
.cg-dot-i.on{opacity:1;width:16px;border-radius:4px;background:var(--cg-accent)}
.cg-card{flex:0 0 228px;scroll-snap-align:start;border:1px solid var(--cg-border);border-radius:18px;overflow:hidden;background:var(--cg-bg);display:flex;flex-direction:column;box-shadow:0 6px 20px rgba(0,0,0,.06);transition:transform .15s ease,box-shadow .15s ease}
.cg-card:hover{transform:translateY(-2px);box-shadow:0 10px 28px rgba(0,0,0,.12)}
.cg-card-img{position:relative;aspect-ratio:4/5;background:var(--cg-muted-bg);cursor:pointer;overflow:hidden}
.cg-card-img img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .35s ease}
.cg-card:hover .cg-card-img img{transform:scale(1.04)}
.cg-card-noimg{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:44px;font-weight:700;color:var(--cg-muted);background:linear-gradient(135deg,var(--cg-muted-bg),var(--cg-surface))}
.cg-card-shade{position:absolute;inset:auto 0 0 0;height:56%;background:linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.55));pointer-events:none}
.cg-card-badges{position:absolute;left:8px;top:8px;display:flex;gap:4px;flex-wrap:wrap;max-width:calc(100% - 16px)}
.cg-chip-src{background:rgba(255,255,255,.92);color:#111827;font-size:10.5px;font-weight:600;padding:3px 8px;border-radius:999px;letter-spacing:.02em;box-shadow:0 1px 4px rgba(0,0,0,.15)}
.cg-badge{position:absolute;right:8px;top:8px;background:rgba(17,24,39,.85);color:#fff;font-size:11px;padding:3px 7px;border-radius:999px}
.cg-badge-sale{background:#dc2626}
.cg-badge-oos{right:auto;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(17,24,39,.8);padding:6px 12px;font-size:12px}
.cg-play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.9);color:#111827;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,0,0,.3);pointer-events:none}
.cg-play svg{margin-left:3px}
.cg-price-pill{position:absolute;left:8px;bottom:8px;background:#fff;color:#111827;font-size:13.5px;font-weight:700;padding:5px 10px;border-radius:999px;display:flex;gap:6px;align-items:baseline;box-shadow:0 2px 8px rgba(0,0,0,.2);max-width:calc(100% - 16px)}
.cg-price-pill s{font-weight:400;color:#6b7280;font-size:11.5px}
.cg-price-req{font-weight:600;font-size:12px;color:#374151}
.cg-card-body{padding:10px 11px 11px;display:flex;flex-direction:column;gap:4px;flex:1}
.cg-card-brand{font-size:10.5px;color:var(--cg-muted);text-transform:uppercase;letter-spacing:.05em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cg-card-title{font-size:13.5px;font-weight:600;line-height:1.3;color:var(--cg-text);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cg-card-reason{font-size:12px;color:var(--cg-muted);line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cg-card-actions{margin-top:auto;display:flex;gap:6px;padding-top:8px}
.cg-btn{border:0;border-radius:11px;padding:9px 12px;font-size:12.5px;font-weight:600;cursor:pointer;line-height:1;transition:transform .12s ease,opacity .12s ease,filter .12s ease;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:6px}
a.cg-btn,a.cg-card-img,a.cg-post{text-decoration:none;color:inherit}
a.cg-card-img{display:block}
.cg-btn:hover{filter:brightness(1.05)}
.cg-btn:active{transform:scale(.97)}
.cg-btn:disabled{opacity:.45;cursor:default}
.cg-btn-primary{color:#fff;background:#111827;flex:1}
.cg-btn-ghost{background:transparent;color:var(--cg-text);border:1px solid var(--cg-border)}
.cg-btn-icon{width:36px;padding:0;background:var(--cg-muted-bg);color:var(--cg-text);flex:0 0 36px}
.cg-btn-sm{padding:6px 10px;font-size:12px}
.cg-btn-wide{width:100%;padding:11px 14px;font-size:13.5px}
.cg-post{flex:0 0 244px;scroll-snap-align:start;border:1px solid var(--cg-border);border-radius:18px;overflow:hidden;background:var(--cg-bg);cursor:pointer;display:flex;flex-direction:column;box-shadow:0 6px 20px rgba(0,0,0,.06);transition:transform .15s ease,box-shadow .15s ease}
.cg-post:hover{transform:translateY(-2px);box-shadow:0 10px 28px rgba(0,0,0,.12)}
.cg-post-img{position:relative;aspect-ratio:16/11;background:var(--cg-muted-bg);overflow:hidden}
.cg-post-img img{width:100%;height:100%;object-fit:cover;display:block}
.cg-post-noimg{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:var(--cg-muted);background:linear-gradient(135deg,var(--cg-muted-bg),var(--cg-surface))}
.cg-post-date{position:absolute;right:8px;bottom:8px;background:rgba(255,255,255,.92);color:#111827;font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px}
.cg-post-body{padding:10px 11px 11px;display:flex;flex-direction:column;gap:6px;flex:1}
.cg-post-text{font-size:13px;color:var(--cg-text);line-height:1.4;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;flex:1}
.cg-table-wrap{overflow-x:auto}
.cg-table{border-collapse:collapse;font-size:12.5px;min-width:100%}
.cg-table th,.cg-table td{padding:6px 8px;border-bottom:1px solid var(--cg-border);text-align:left;vertical-align:top;color:var(--cg-text)}
.cg-th{display:flex;flex-direction:column;gap:4px;min-width:110px}
.cg-th img{width:56px;height:56px;object-fit:cover;border-radius:8px}
.cg-td-label{color:var(--cg-muted);white-space:nowrap}
.cg-note{font-size:12.5px;color:var(--cg-muted);margin:8px 0 0;line-height:1.4}
.cg-hint{font-size:11px;color:var(--cg-muted);margin-top:6px;text-align:center}
.cg-lines{display:flex;flex-direction:column;gap:6px}
.cg-line{display:grid;grid-template-columns:1fr auto auto;gap:8px;font-size:13px;color:var(--cg-text)}
.cg-line-qty{color:var(--cg-muted)}
.cg-total{display:flex;justify-content:space-between;margin:10px 0;font-size:14px;color:var(--cg-text);border-top:1px solid var(--cg-border);padding-top:8px}
.cg-input{width:100%;box-sizing:border-box;border:1px solid var(--cg-border);border-radius:10px;padding:10px 12px;font-size:13.5px;margin-bottom:8px;background:var(--cg-bg);color:var(--cg-text);outline:none}
.cg-input:focus{border-color:var(--cg-accent)}
.cg-error{color:#dc2626;font-size:12px;margin-bottom:8px}
.cg-lead-sent{font-size:14px;color:var(--cg-text);padding:6px 0}
.cg-chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 2px}
.cg-chip{background:transparent;border:1px solid;border-radius:999px;padding:7px 12px;font-size:12.5px;cursor:pointer;line-height:1.1;transition:background .12s ease}
.cg-chip:hover{background:var(--cg-muted-bg)}
.cg-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px}
.cg-tile{border:1px solid var(--cg-border);border-radius:12px;padding:10px;background:var(--cg-bg)}
.cg-tile-label{font-size:11px;color:var(--cg-muted);text-transform:uppercase;letter-spacing:.04em}
.cg-tile-value{font-size:20px;font-weight:700;color:var(--cg-text);margin-top:2px;font-variant-numeric:tabular-nums}
.cg-tile-prev{font-size:11px;color:var(--cg-muted)}
.cg-up{color:#059669}.cg-down{color:#dc2626}
.cg-digest{display:flex;flex-direction:column;gap:8px}
.cg-digest-row{display:flex;gap:10px;align-items:flex-start}
.cg-digest-icon{width:26px;text-align:center;font-size:15px}
.cg-digest-head{font-size:13px;font-weight:600;color:var(--cg-text)}
.cg-digest-detail{font-size:12.5px;color:var(--cg-muted);margin-top:2px}
.cg-link{background:none;border:0;padding:0;color:var(--cg-accent);font-size:12.5px;cursor:pointer;margin-top:3px}
.cg-change-items{display:flex;flex-direction:column;gap:8px}
.cg-change-item{border:1px solid var(--cg-border);border-radius:10px;padding:8px 10px;background:var(--cg-bg)}
.cg-change-target{font-size:12.5px;font-weight:600;color:var(--cg-text)}
.cg-change-field{font-weight:400;color:var(--cg-muted);margin-left:6px;font-family:ui-monospace,monospace;font-size:11.5px}
.cg-change-diff{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;margin-top:4px;flex-wrap:wrap}
.cg-before{color:#b91c1c;text-decoration:line-through;opacity:.8}.cg-after{color:#047857;font-weight:600}.cg-arrow{color:var(--cg-muted)}
.cg-change-actions{display:flex;gap:8px;margin-top:10px}
.cg-status{font-size:11px;font-weight:500;padding:2px 8px;border-radius:999px;background:var(--cg-muted-bg);color:var(--cg-muted)}
.cg-status-applied{background:#d1fae5;color:#065f46}.cg-status-discarded{background:#fee2e2;color:#991b1b}
@media (max-width:420px){.cg-card{flex-basis:206px}.cg-post{flex-basis:224px}}
`;
