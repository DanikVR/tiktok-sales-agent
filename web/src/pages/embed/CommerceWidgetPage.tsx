/**
 * Commerce Agents — чат-виджет покупателя. Живёт в iframe на сайте клиента (/embed/commerce/:slug,
 * загружается public/comag.js) и как хостед-страница для пересылки (/c/:slug, prop hosted).
 *
 * Премиум-дизайн: изолированная тема (светлая/тёмная/авто, акцент из кабинета), карточки товаров,
 * сравнение, сводка чекаута, форма контакта, посты, чипы, стриминг, микрофон. Строки интерфейса —
 * на языке посетителя: словарь приходит с сервера в конфиге (108 языков), встроенные ru/en запасные.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { readSse, type AgentSseEvent } from '../commerce/api';
import { AGENT_CSS, ProductCards, Comparison, CheckoutCard, LeadForm, Suggestions, PostCards, strings, fill, money, type ProductCardData, type PostCardData, type WidgetStrings } from '../../components/commerce/AgentComponents';

interface PublicConfig {
  slug: string; brandName: string; assistantName: string; greeting: string; accent: string; theme: 'light' | 'dark' | 'auto'; logoUrl: string | null;
  language: string; currency: string; platform: string; checkoutUrl: string | null; siteUrl: string | null; enabled: boolean; voiceEnabled: boolean; ready: boolean;
  shareTitle?: string; shareDescription?: string; shareCoverUrl?: string | null; shareUrl?: string; starters?: string[] | null; strings?: WidgetStrings | null; lang?: string;
}

type Block = { id: number; kind: 'text'; role: 'user' | 'assistant'; text: string } | { id: number; kind: 'component'; component: string; data: any } | { id: number; kind: 'progress'; text: string };
type NewBlock = Block extends infer B ? (B extends Block ? Omit<B, 'id'> : never) : never;

const SPEECH: Record<string, string> = { ru: 'ru-RU', en: 'en-US', pl: 'pl-PL', de: 'de-DE', uk: 'uk-UA', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', pt: 'pt-PT', tr: 'tr-TR', cs: 'cs-CZ', nl: 'nl-NL', sv: 'sv-SE', kk: 'kk-KZ', he: 'he-IL', ar: 'ar-SA', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', hi: 'hi-IN', ro: 'ro-RO', hu: 'hu-HU', el: 'el-GR', bg: 'bg-BG', fi: 'fi-FI', da: 'da-DK', no: 'nb-NO', vi: 'vi-VN', th: 'th-TH', id: 'id-ID', ms: 'ms-MY', lt: 'lt-LT', lv: 'lv-LV', et: 'et-EE', sk: 'sk-SK', sl: 'sl-SI', hr: 'hr-HR', sr: 'sr-RS', ka: 'ka-GE', hy: 'hy-AM', az: 'az-AZ', uz: 'uz-UZ', fa: 'fa-IR', ur: 'ur-PK', bn: 'bn-BD', ta: 'ta-IN', te: 'te-IN', ml: 'ml-IN', mr: 'mr-IN', gu: 'gu-IN', sw: 'sw-KE', am: 'am-ET' };

function genVisitor(): string { const a = 'abcdefghijklmnopqrstuvwxyz0123456789'; let s = 'v'; for (let i = 0; i < 24; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
function hexToRgb(hex: string): string { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '17,24,39'; const n = parseInt(m[1], 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; }

export default function CommerceWidgetPage({ hosted = false }: { hosted?: boolean }) {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const lang = (params.get('lang') || navigator.language || 'en').slice(0, 2).toLowerCase();
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const [draft, setDraft] = useState<Partial<PublicConfig> | null>(null);
  const view = useMemo<PublicConfig | null>(() => (cfg || draft ? ({ ...(cfg || ({} as PublicConfig)), ...(draft || {}) } as PublicConfig) : null), [cfg, draft]);
  const s = useMemo(() => strings(lang, cfg?.strings || null), [lang, cfg?.strings]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [cart, setCart] = useState<{ items: any[]; subtotal: number; currency: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [hasHost, setHasHost] = useState(false);
  const visitorRef = useRef<string>(params.get('vid') || '');
  const convRef = useRef<string | null>(params.get('conv') || null);
  const pageRef = useRef<any>(null);
  const hostRef = useRef(false);
  const idRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<any>(null);
  const isDark = useMemo(() => view?.theme === 'dark' || (view?.theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches), [view?.theme]);

  useEffect(() => {
    if (!visitorRef.current) { try { visitorRef.current = localStorage.getItem('comag_vid') || genVisitor(); localStorage.setItem('comag_vid', visitorRef.current); } catch { visitorRef.current = genVisitor(); } }
    if (!convRef.current) { try { convRef.current = (hosted ? localStorage : sessionStorage).getItem(`comag_conv_${slug}`); } catch { /* ignore */ } }
    fetch(`/api/commerce/w/${encodeURIComponent(slug)}/config?lang=${encodeURIComponent(lang)}`).then((r) => r.json()).then((c: PublicConfig) => { setCfg(c); if (c?.shareTitle && hosted) document.title = c.shareTitle; }).catch(() => setCfg(null));
    document.documentElement.classList.add('vibevox-embed');
    document.documentElement.lang = lang;
    const onMsg = (e: MessageEvent) => {
      const d = e.data || {};
      if (d?.type !== 'comag') return;
      if (d.action === 'context') { hostRef.current = true; setHasHost(true); pageRef.current = d.page || null; if (d.visitorId) visitorRef.current = d.visitorId; }
      if (d.action === 'host' && d.kind === 'added') showToast(s.added);
      if (d.action === 'preview' && d.config && typeof d.config === 'object') setDraft((prev) => ({ ...(prev || {}), ...d.config }));
    };
    window.addEventListener('message', onMsg);
    try { window.parent?.postMessage({ type: 'comag', action: 'ready' }, '*'); } catch { /* ignore */ }
    return () => { window.removeEventListener('message', onMsg); document.documentElement.classList.remove('vibevox-embed'); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [blocks, busy]);

  const showToast = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(null), 1800); };
  // ── PWA хостед-страницы (/c/:slug): установка на телефон и push-уведомления ──
  const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true);
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const inApp = /Telegram|Instagram|FBAN|FBAV|FB_IAB|Line\/|TikTok|Snapchat/i.test(ua);
  const [installEvt, setInstallEvt] = useState<any>(() => (typeof window !== 'undefined' ? (window as any).__comagInstall || null : null));
  const [installHidden, setInstallHidden] = useState<boolean>(() => { try { return Number(localStorage.getItem(`comag_install_hide_${slug}`) || 0) > Date.now(); } catch { return false; } });
  const [pushState, setPushState] = useState<'na' | 'idle' | 'on' | 'denied' | 'busy'>('na');
  const swRef = useRef<ServiceWorkerRegistration | null>(null);
  useEffect(() => {
    if (!hosted) return;
    const onBip = (e: Event) => { e.preventDefault(); setInstallEvt(e); };
    const onInstalled = () => { setInstallEvt(null); setInstallHidden(true); };
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    const canPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && (!isIOS || standalone);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/c/sw.js', { scope: '/c/' }).then(async (reg) => {
        swRef.current = reg;
        if (!canPush) return;
        if (Notification.permission === 'denied') { setPushState('denied'); return; }
        const sub = await reg.pushManager.getSubscription().catch(() => null);
        setPushState(sub ? 'on' : 'idle');
      }).catch(() => { /* без service worker — без установки и push */ });
    }
    return () => { window.removeEventListener('beforeinstallprompt', onBip); window.removeEventListener('appinstalled', onInstalled); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hosted, slug]);
  const hideInstall = () => { setInstallHidden(true); try { localStorage.setItem(`comag_install_hide_${slug}`, String(Date.now() + 7 * 86_400_000)); } catch { /* ignore */ } };
  const doInstall = async () => { const ev = installEvt; if (!ev) return; try { ev.prompt(); const r = await ev.userChoice; if (r?.outcome === 'accepted') { setInstallEvt(null); setInstallHidden(true); } } catch { /* ignore */ } };
  const bindPush = async (sub: PushSubscription, convId: string | null) => {
    await fetch(`/api/commerce/w/${encodeURIComponent(slug)}/push/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), visitorId: visitorRef.current || null, conversationId: convId, lang }) }).catch(() => {});
  };
  const enablePush = async () => {
    const reg = swRef.current || (await navigator.serviceWorker?.ready.catch(() => null));
    if (!reg) return;
    setPushState('busy');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setPushState(perm === 'denied' ? 'denied' : 'idle'); return; }
      const k = await fetch(`/api/commerce/w/${encodeURIComponent(slug)}/push/key`).then((r) => r.json()).catch(() => null);
      if (!k?.key) { setPushState('idle'); return; }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(k.key) as unknown as BufferSource });
      await bindPush(sub, convRef.current);
      setPushState('on');
      setToast(s.push?.on || 'OK');
    } catch { setPushState('idle'); }
  };

  const post = (msg: any) => { try { window.parent?.postMessage({ type: 'comag', ...msg }, '*'); } catch { /* ignore */ } };
  const track = (kind: string, productId?: string) => { fetch(`/api/commerce/w/${encodeURIComponent(slug)}/event`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, productId, conversationId: convRef.current }) }).catch(() => {}); };
  const push = (b: NewBlock) => { const id = idRef.current++; setBlocks((prev) => [...prev, { ...(b as any), id }]); return id; };

  const send = useCallback(async (text: string) => {
    const msg = text.trim();
    if (!msg || busy || !cfg) return;
    setInput('');
    push({ kind: 'text', role: 'user', text: msg });
    setBusy(true);
    let assistantId: number | null = null;
    let progressId: number | null = null;
    const setText = (id: number, delta: string) => setBlocks((prev) => prev.map((b) => (b.id === id && b.kind === 'text' ? { ...b, text: b.text + delta } : b)));
    const removeBlock = (id: number) => setBlocks((prev) => prev.filter((b) => b.id !== id));
    try {
      const res = await fetch(`/api/commerce/w/${encodeURIComponent(slug)}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId: visitorRef.current, conversationId: convRef.current, message: msg, lang, page: pageRef.current ? { url: pageRef.current.url, title: pageRef.current.title } : (hosted ? null : { url: document.referrer || null }) }),
      });
      await readSse(res, (ev: AgentSseEvent) => {
        if (ev.type === 'meta' && ev.data?.conversationId) { convRef.current = ev.data.conversationId; try { (hosted ? localStorage : sessionStorage).setItem(`comag_conv_${slug}`, ev.data.conversationId); } catch { /* ignore */ }
          // Push-подписка следует за диалогом: привяжем к новому id.
          try { swRef.current?.pushManager.getSubscription().then((sub) => { if (sub) void bindPush(sub, ev.data.conversationId); }).catch(() => {}); } catch { /* ignore */ } post({ action: 'conversation', conversationId: ev.data.conversationId }); }
        else if (ev.type === 'progress') { const label = (s.progress || {})[ev.text] || s.progress?.think || '…'; if (progressId == null) progressId = push({ kind: 'progress', text: label }); else setBlocks((prev) => prev.map((b) => (b.id === progressId ? { ...b, text: label } as Block : b))); }
        else if (ev.type === 'text') { if (progressId != null) { removeBlock(progressId); progressId = null; } if (assistantId == null) assistantId = push({ kind: 'text', role: 'assistant', text: '' }); setText(assistantId, ev.delta); }
        else if (ev.type === 'component') { if (progressId != null) { removeBlock(progressId); progressId = null; } assistantId = null; push({ kind: 'component', component: ev.component, data: ev.data }); }
        else if (ev.type === 'cart') setCart(ev.data);
        else if (ev.type === 'error') { if (progressId != null) { removeBlock(progressId); progressId = null; } push({ kind: 'text', role: 'assistant', text: ev.message === 'assistant_not_configured' ? s.notReady : s.error }); }
      });
    } catch {
      push({ kind: 'text', role: 'assistant', text: s.error });
    } finally {
      if (progressId != null) removeBlock(progressId);
      setBusy(false);
    }
  }, [busy, cfg, slug, lang, hosted, s]);

  const openAsLink = hosted || !hasHost;
  const onAdd = (p: ProductCardData) => { track('add_to_cart', p.id); if (hostRef.current && !hosted) post({ action: 'addToCart', url: p.url, productId: p.id, quantity: 1 }); void send(fill(s.addMessage, { title: p.title })); };
  const onOpen = (p: ProductCardData) => { track('card_click', p.id); if (!openAsLink && p.url) post({ action: 'open', url: p.url }); };
  const onAsk = (p: ProductCardData) => { track('card_click', p.id); void send(fill(s.askMessage, { title: p.title })); };
  const onCheckout = (url: string | null) => { track('checkout_click'); const target = url || cfg?.checkoutUrl || cfg?.siteUrl; if (!openAsLink && target) post({ action: 'open', url: target }); };
  const onOpenPost = (p: PostCardData) => { track('card_click'); if (!openAsLink && p.url) post({ action: 'open', url: p.url }); };
  const onLead = async (v: { name: string; phone: string; email: string; note: string }) => {
    try { const r = await fetch(`/api/commerce/w/${encodeURIComponent(slug)}/lead`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...v, conversationId: convRef.current, visitorId: visitorRef.current }) }); return r.ok; } catch { return false; }
  };

  const speechSupported = typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const startListening = () => {
    if (!speechSupported || listening) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SR(); rec.lang = SPEECH[lang] || (navigator.language.toLowerCase().startsWith(lang) ? navigator.language : lang); rec.interimResults = true; rec.continuous = false;
    let finalText = '';
    rec.onresult = (e: any) => { let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript; } setInput((finalText + interim).trim()); };
    rec.onend = () => { setListening(false); recRef.current = null; if (finalText.trim()) void send(finalText); };
    rec.onerror = () => { setListening(false); recRef.current = null; };
    recRef.current = rec; setListening(true);
    try { rec.start(); } catch { setListening(false); }
  };
  const stopListening = () => { try { recRef.current?.stop(); } catch { /* ignore */ } };

  const accent = view?.accent || '#111827';
  const vars: React.CSSProperties = {
    ['--cg-accent' as any]: accent,
    ['--cg-accent-rgb' as any]: hexToRgb(accent),
    ['--cg-bg' as any]: isDark ? '#0f1115' : '#ffffff',
    ['--cg-surface' as any]: isDark ? '#171a21' : '#f7f7f8',
    ['--cg-text' as any]: isDark ? '#f3f4f6' : '#111827',
    ['--cg-muted' as any]: isDark ? '#9ca3af' : '#6b7280',
    ['--cg-muted-bg' as any]: isDark ? '#1f2330' : '#eef0f3',
    ['--cg-border' as any]: isDark ? 'rgba(255,255,255,.09)' : 'rgba(17,24,39,.09)',
  };

  const empty = blocks.length === 0;
  const starters = view?.starters?.length ? view.starters.slice(0, 4) : [s.starters?.empty1, s.starters?.empty2, s.starters?.empty3].filter(Boolean) as string[];
  const rtl = ['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi'].includes(lang);

  return (
    <div className={`cg-root ${hosted ? 'cg-hosted' : ''}`} style={vars} dir={rtl ? 'rtl' : 'ltr'}>
      <style>{AGENT_CSS}{CSS}</style>
      <header className="cg-header">
        {view?.logoUrl ? <img className="cg-logo" src={view.logoUrl} alt="" /> : <div className="cg-logo cg-logo-fallback" style={{ background: accent }}>{(view?.brandName || view?.assistantName || 'A').slice(0, 1).toUpperCase()}</div>}
        <div className="cg-header-text">
          <div className="cg-brand">{view?.assistantName || view?.brandName || '…'}</div>
          <div className="cg-sub">{view?.brandName || ''}{view ? <span className="cg-online" /> : null}</div>
        </div>
        {cart && cart.items.length ? <button type="button" className="cg-cart-pill" onClick={() => void send(s.showCart)} title={s.cart}>🛒 {cart.items.reduce((n, i) => n + i.quantity, 0)} · {money(cart.subtotal, cart.currency)}</button> : null}
        {hosted && pushState !== 'na' && pushState !== 'denied' ? (
          pushState === 'on'
            ? <span className="cg-bell cg-bell-on" title={s.push?.on}>🔔</span>
            : <button type="button" className="cg-bell" onClick={() => void enablePush()} disabled={pushState === 'busy'} title={s.push?.button} aria-label={s.push?.button}>🔔</button>
        ) : null}
        {!hosted ? <button type="button" className="cg-close" aria-label="close" onClick={() => post({ action: 'close' })}>×</button> : null}
      </header>
      {hosted && !standalone && !installHidden && (installEvt || isIOS || inApp) ? (
        <div className="cg-install">
          {view?.logoUrl ? <img src={view.logoUrl} alt="" className="cg-install-icon" /> : null}
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{s.install?.title}</b>
            <small>{installEvt ? String(s.install?.text || '').replace('{{brand}}', view?.brandName || '') : inApp ? s.install?.inapp : s.install?.ios}</small>
          </div>
          {installEvt ? <button type="button" className="cg-install-btn" style={{ background: accent }} onClick={() => void doInstall()}>{s.install?.button}</button> : null}
          <button type="button" className="cg-install-x" onClick={hideInstall} aria-label={s.install?.later}>×</button>
        </div>
      ) : null}
      <div className="cg-scroll" ref={scrollRef}>
        {empty ? (
          <div className="cg-empty">
            {hosted && view?.shareCoverUrl ? <img className="cg-cover" src={view.shareCoverUrl} alt="" /> : null}
            <div className="cg-greeting">{view?.greeting || s.greetingDefault}</div>
            {cfg && !cfg.ready ? <div className="cg-notready">{s.notReady}</div> : null}
            <Suggestions chips={starters} onPick={(c) => void send(c)} accent={accent} />
          </div>
        ) : null}
        {blocks.map((b) => {
          if (b.kind === 'text') return <div key={b.id} className={`cg-msg ${b.role === 'user' ? 'cg-msg-user' : 'cg-msg-assistant'}`} style={b.role === 'user' ? { background: accent } : undefined}>{b.text}</div>;
          if (b.kind === 'progress') return <div key={b.id} className="cg-progress"><span className="cg-dot" /><span className="cg-dot" /><span className="cg-dot" />{b.text}</div>;
          switch (b.component) {
            case 'products': return <ProductCards key={b.id} data={b.data} s={s} onAdd={onAdd} onOpen={onOpen} onAsk={onAsk} accent={accent} openAsLink={openAsLink} />;
            case 'comparison': return <Comparison key={b.id} data={b.data} s={s} onAdd={onAdd} accent={accent} />;
            case 'checkout': return <CheckoutCard key={b.id} data={b.data} s={s} onCheckout={onCheckout} accent={accent} href={openAsLink ? (b.data?.checkoutUrl || view?.checkoutUrl || view?.siteUrl || null) : null} />;
            case 'lead_form': return <LeadForm key={b.id} data={b.data} s={s} accent={accent} onSubmit={onLead} />;
            case 'posts': return <PostCards key={b.id} data={b.data} s={s} onOpen={onOpenPost} accent={accent} openAsLink={openAsLink} />;
            case 'suggestions': return <Suggestions key={b.id} chips={b.data?.chips || []} onPick={(c) => void send(c)} accent={accent} />;
            default: return null;
          }
        })}
        {busy && !blocks.some((b) => b.kind === 'progress') && blocks[blocks.length - 1]?.kind === 'text' && (blocks[blocks.length - 1] as any).role === 'user' ? <div className="cg-progress"><span className="cg-dot" /><span className="cg-dot" /><span className="cg-dot" /></div> : null}
      </div>
      <form className="cg-composer" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        {view?.voiceEnabled !== false && speechSupported ? (
          <button type="button" className={`cg-mic ${listening ? 'cg-mic-on' : ''}`} aria-label={s.mic} title={s.mic}
            onMouseDown={(e) => { e.preventDefault(); startListening(); }} onMouseUp={stopListening} onTouchStart={(e) => { e.preventDefault(); startListening(); }} onTouchEnd={stopListening}
            style={listening ? { background: accent, color: '#fff' } : undefined}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></svg>
          </button>
        ) : null}
        <input className="cg-field" value={input} onChange={(e) => setInput(e.target.value)} placeholder={listening ? s.listening : s.placeholder} disabled={busy} autoComplete="off" />
        <button type="submit" className="cg-send" style={{ background: accent }} disabled={busy || !input.trim()} aria-label={s.send}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
        </button>
      </form>
      <div className="cg-footer">{s.poweredBy}</div>
      {toast ? <div className="cg-toast">{toast}</div> : null}
    </div>
  );
}

const CSS = `
.cg-root{position:fixed;inset:0;display:flex;flex-direction:column;background:var(--cg-bg);color:var(--cg-text);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;-webkit-font-smoothing:antialiased}
.cg-install{margin:10px 12px 0;padding:10px 12px;border-radius:14px;background:var(--cg-surface);border:1px solid var(--cg-border);display:flex;gap:10px;align-items:center;color:var(--cg-text)}
.cg-install b{display:block;font-size:13px;font-weight:700}
.cg-install small{display:block;color:var(--cg-muted);font-size:11px;line-height:1.3;margin-top:2px}
.cg-install-icon{width:36px;height:36px;border-radius:10px;object-fit:cover;flex-shrink:0}
.cg-install-btn{border:0;border-radius:10px;color:#fff;font-weight:700;font-size:12px;padding:8px 12px;cursor:pointer;flex-shrink:0}
.cg-install-x{border:0;background:transparent;color:var(--cg-muted);font-size:18px;line-height:1;cursor:pointer;padding:4px}
.cg-bell{border:1px solid var(--cg-border);background:var(--cg-surface);border-radius:999px;width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:15px;margin-inline-start:6px;flex-shrink:0}
.cg-bell-on{border-color:transparent;opacity:.85;cursor:default}
.cg-hosted{position:relative;min-height:100dvh;max-width:560px;margin:0 auto;box-shadow:0 0 0 1px var(--cg-border)}
.cg-header{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--cg-border);background:var(--cg-bg)}
.cg-logo{width:38px;height:38px;border-radius:12px;object-fit:cover;flex-shrink:0}
.cg-logo-fallback{display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:16px}
.cg-header-text{flex:1;min-width:0}
.cg-brand{font-weight:600;font-size:14.5px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cg-sub{font-size:12px;color:var(--cg-muted);display:flex;align-items:center;gap:6px}
.cg-online{width:7px;height:7px;border-radius:50%;background:#10b981;display:inline-block}
.cg-cart-pill{border:1px solid var(--cg-border);background:var(--cg-surface);color:var(--cg-text);border-radius:999px;padding:6px 10px;font-size:12px;cursor:pointer;white-space:nowrap}
.cg-close{background:transparent;border:0;font-size:24px;line-height:1;color:var(--cg-muted);cursor:pointer;padding:4px 6px}
.cg-scroll{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:6px;overscroll-behavior:contain}
.cg-empty{display:flex;flex-direction:column;gap:12px;padding:10px 0}
.cg-cover{width:100%;border-radius:16px;object-fit:cover;max-height:220px}
.cg-greeting{font-size:15px;line-height:1.45}
.cg-notready{font-size:12.5px;color:#b45309;background:rgba(245,158,11,.12);border-radius:10px;padding:8px 10px}
.cg-msg{max-width:88%;padding:10px 13px;border-radius:16px;line-height:1.45;white-space:pre-wrap;word-break:break-word;font-size:14px}
.cg-msg-user{align-self:flex-end;color:#fff;border-bottom-right-radius:6px}
.cg-msg-assistant{align-self:flex-start;background:var(--cg-surface);border-bottom-left-radius:6px}
[dir=rtl] .cg-msg-user{align-self:flex-start;border-bottom-right-radius:16px;border-bottom-left-radius:6px}
[dir=rtl] .cg-msg-assistant{align-self:flex-end;border-bottom-left-radius:16px;border-bottom-right-radius:6px}
.cg-progress{align-self:flex-start;display:flex;align-items:center;gap:4px;font-size:12.5px;color:var(--cg-muted);padding:6px 2px}
.cg-dot{width:6px;height:6px;border-radius:50%;background:var(--cg-muted);opacity:.5;animation:cgb 1.2s infinite ease-in-out}
.cg-dot:nth-child(2){animation-delay:.2s}.cg-dot:nth-child(3){animation-delay:.4s;margin-right:6px}
@keyframes cgb{0%,80%,100%{transform:scale(.7);opacity:.35}40%{transform:scale(1);opacity:1}}
.cg-composer{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid var(--cg-border);background:var(--cg-bg);padding-bottom:max(10px,env(safe-area-inset-bottom))}
.cg-field{flex:1;min-width:0;border:1px solid var(--cg-border);background:var(--cg-surface);color:var(--cg-text);border-radius:14px;padding:11px 14px;font-size:14px;outline:none}
.cg-field:focus{border-color:var(--cg-accent);box-shadow:0 0 0 3px rgba(var(--cg-accent-rgb),.15)}
.cg-send,.cg-mic{width:42px;height:42px;border-radius:13px;border:0;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:transform .12s ease}
.cg-send:active,.cg-mic:active{transform:scale(.95)}
.cg-send:disabled{opacity:.4}
[dir=rtl] .cg-send svg{transform:scaleX(-1)}
.cg-mic{background:var(--cg-surface);color:var(--cg-text);border:1px solid var(--cg-border);touch-action:none;user-select:none;-webkit-user-select:none}
.cg-mic-on{animation:cgp 1.2s infinite}
@keyframes cgp{0%{box-shadow:0 0 0 0 rgba(var(--cg-accent-rgb),.45)}100%{box-shadow:0 0 0 12px rgba(var(--cg-accent-rgb),0)}}
.cg-footer{font-size:10.5px;color:var(--cg-muted);text-align:center;padding:0 0 6px;letter-spacing:.02em}
.cg-toast{position:absolute;left:50%;bottom:84px;transform:translateX(-50%);background:#111827;color:#fff;padding:8px 14px;border-radius:999px;font-size:12.5px;box-shadow:0 8px 24px rgba(0,0,0,.25)}
@media (max-width:640px){.cg-msg{max-width:92%}}
`;

/** VAPID public key (base64url) → BufferSource для pushManager.subscribe. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
