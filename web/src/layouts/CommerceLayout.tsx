/**
 * CommerceLayout — кабинет Commerce Agents (comag.vibevox.pro и /commerce на vibevox.pro).
 * Мобильная основа: шапка с названием и гамбургером справа (шторка с разделами), главная —
 * сценарий и иконки. На десктопе левое меню. Гейт по тарифу; баннер, если не задан ключ Anthropic.
 * Все строки — из пространства i18n `commerce` (108 языков).
 */
import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate, Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Home, Package, MessageSquareText, MessagesSquare, Inbox, Bot, Settings, LogOut, ShoppingBag, KeyRound, Menu, X, PanelRightClose, PanelRightOpen, ExternalLink } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { setLanguage } from '../config/i18n';
import { api } from '../pages/commerce/api';
import WidgetPreview, { useIsDesktop } from '../components/commerce/WidgetPreview';
import { subscribePreviewRefresh } from '../components/commerce/widgetPreviewStore';

interface Access { commerce: boolean; tier: string | null; superadmin: boolean; hasKey: boolean; keySource: string | null }
export const CommerceAccessContext = React.createContext<Access | null>(null);

const NAV = [
  { to: '/commerce', end: true, icon: Home, key: 'nav.home' },
  { to: '/commerce/catalog', icon: Package, key: 'nav.catalog' },
  { to: '/commerce/widget', icon: MessageSquareText, key: 'nav.widget' },
  { to: '/commerce/dialogs', icon: MessagesSquare, key: 'nav.dialogs' },
  { to: '/commerce/leads', icon: Inbox, key: 'nav.leads' },
  { to: '/commerce/agent', icon: Bot, key: 'nav.agent' },
  { to: '/commerce/settings', icon: Settings, key: 'nav.settings' },
];
/** Подпункты «Настроек» — быстрый переход к разделам страницы (якоря). */
const SETTINGS_SECTIONS = ['sources', 'business', 'store', 'keys', 'telegram', 'danger'];

export default function CommerceLayout() {
  const { t } = useTranslation('commerce');
  const { user, logout, login } = useAppStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [access, setAccess] = useState<Access | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  // Живой виджет в правой колонке на всех разделах (десктоп). Сворачивание запоминается в браузере.
  const isDesktop = useIsDesktop();
  const [store, setStore] = useState<{ slug: string | null; language: string | null } | null>(null);
  const [previewOpen, setPreviewOpen] = useState<boolean>(() => { try { return localStorage.getItem('comag_preview_open') !== '0'; } catch { return true; } });
  const togglePreview = () => setPreviewOpen((v) => { try { localStorage.setItem('comag_preview_open', v ? '0' : '1'); } catch { /* ignore */ } return !v; });
  useEffect(() => {
    if (!access?.commerce) return;
    const load = () => api('/api/commerce/settings').then((r) => setStore({ slug: r.settings?.slug || null, language: r.settings?.language || null })).catch(() => {});
    void load();
    return subscribePreviewRefresh(load);
  }, [access?.commerce]);

  useEffect(() => {
    const refresh = () => api<Access>('/api/commerce/access').then(setAccess).catch((e) => setError(e?.message || t('common.error')));
    void refresh();
    window.addEventListener('comag:access', refresh);
    return () => window.removeEventListener('comag:access', refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);
  useEffect(() => { setMenu(false); }, [location.pathname]);

  const linkCls = ({ isActive }: { isActive: boolean }) => `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${isActive ? 'font-600' : ''}`;
  const linkStyle = ({ isActive }: { isActive: boolean }): React.CSSProperties => (isActive
    ? { background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }
    : { color: 'var(--text-muted)', border: '1px solid transparent' });

  const jumpTo = (id: string) => {
    navigate(`/commerce/settings#${id}`);
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    setMenu(false);
  };
  const navItems = NAV.map((n) => (
    <React.Fragment key={n.to}>
      <NavLink to={n.to} end={n.end} className={linkCls} style={linkStyle}>
        {({ isActive }) => (<><n.icon size={18} strokeWidth={isActive ? 2 : 1.5} /><span>{t(n.key)}</span></>)}
      </NavLink>
      {n.to === '/commerce/settings' && location.pathname.startsWith('/commerce/settings') ? (
        <div className="ml-8 flex flex-col gap-0.5 mb-1">
          {SETTINGS_SECTIONS.map((id) => (
            <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); jumpTo(id); }} className="px-3 py-1.5 rounded-lg text-xs" style={{ color: location.hash === `#${id}` ? 'var(--text-primary)' : 'var(--text-muted)' }}>{t(`nav.sub.${id}`)}</a>
          ))}
        </div>
      ) : null}
    </React.Fragment>
  ));
  // Низ меню как в основном VibeVox: переход в VibeVox, «Установить приложение», пользователь + тариф + баланс, выход.
  const footer = (
    <div className="border-t flex flex-col" style={{ borderColor: 'var(--border-subtle)' }}>
      <div className="px-3 pt-3">
        <a href="https://comag.vibevox.pro/?utm_source=github&utm_medium=console&utm_campaign=tiktok-sales-agent" target="_blank" rel="noopener" className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm" style={{ color: 'var(--text-primary)', background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}>
          <ExternalLink size={16} /><span>Hosted edition · comag.vibevox.pro</span>
        </a>
      </div>
      <div className="px-3 pt-3 flex gap-1">
        {['en', 'ru'].map((l) => (
          <button key={l} type="button" onClick={() => setLanguage(l)} className="px-3 py-1.5 rounded-lg text-xs uppercase" style={{ color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>{l}</button>
        ))}
      </div>
      <div className="p-3 flex flex-col gap-1">
        <button type="button" onClick={() => { logout(); }} className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-left" style={{ color: 'var(--text-muted)' }}><LogOut size={16} /><span>{t('nav.logout', { defaultValue: 'Sign out' })}</span></button>
        <div className="px-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>effective-commerce-agents · self-hosted</div>
      </div>
    </div>
  );

  if (!user) return <TokenGate onSubmit={(v) => login(v)} />;

  return (
    <CommerceAccessContext.Provider value={access}>
      <div className="flex flex-col lg:flex-row min-h-[100dvh] lg:h-[100dvh] lg:overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
        <aside className="hidden lg:flex flex-col w-64 border-r flex-shrink-0" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center gap-3 px-5 py-5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#f59e0b,#ef4444)' }}><ShoppingBag size={18} color="#fff" /></div>
            <div className="min-w-0">
              <div className="text-base font-700 leading-tight" style={{ fontFamily: 'Space Grotesk, sans-serif', color: 'var(--text-primary)' }}>{t('nav.brand')}</div>
              <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{user?.email}</div>
            </div>
          </div>
          <nav className="flex-1 flex flex-col gap-1 p-3">{navItems}</nav>
          {footer}
        </aside>

        <div className="flex-1 flex flex-col min-w-0">
          <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-secondary)', paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
            <Link to="/commerce" className="flex items-center gap-2 min-w-0">
              <span className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#f59e0b,#ef4444)' }}><ShoppingBag size={16} color="#fff" /></span>
              <span className="text-sm font-700 truncate" style={{ fontFamily: 'Space Grotesk, sans-serif', color: 'var(--text-primary)' }}>{t('nav.brand')}</span>
            </Link>
            <button type="button" onClick={() => setMenu(true)} className="p-2 rounded-xl" style={{ color: 'var(--text-primary)', background: 'var(--bg-tertiary)' }} aria-label={t('nav.menu')}><Menu size={20} /></button>
          </header>

          {menu ? (
            <div className="lg:hidden fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,.5)' }} onClick={() => setMenu(false)}>
              <div className="w-[82%] max-w-sm h-full flex flex-col" style={{ background: 'var(--bg-secondary)', paddingTop: 'env(safe-area-inset-top)' }} onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-4 py-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="min-w-0">
                    <div className="text-sm font-700" style={{ color: 'var(--text-primary)' }}>{t('nav.brand')}</div>
                    <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{user?.email}</div>
                  </div>
                  <button type="button" onClick={() => setMenu(false)} className="p-2 rounded-xl" style={{ color: 'var(--text-muted)' }} aria-label={t('nav.close')}><X size={18} /></button>
                </div>
                <nav className="flex-1 flex flex-col gap-1 p-3 overflow-y-auto">{navItems}</nav>
                {footer}
              </div>
            </div>
          ) : null}

          <main className="flex-1 lg:overflow-y-auto">
            <div className="max-w-[1600px] mx-auto px-4 py-4 lg:px-8 lg:py-7">
              {access && !access.commerce ? (
                <Paywall tier={access.tier} />
              ) : (
                <>
                  {access && !access.hasKey && location.pathname !== '/commerce' && (
                    <div className="mb-5 flex items-start gap-3 rounded-2xl px-4 py-3 text-sm" style={{ background: 'rgba(245,158,11,.12)', color: 'var(--text-primary)', border: '1px solid rgba(245,158,11,.35)' }}>
                      <KeyRound size={18} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 2 }} />
                      <div>{t('banner.noKey')} <Link to="/commerce/settings" className="underline">{t('banner.settings')}</Link>{false ? <> {t('banner.orAdmin')} <Link to="/admin/config" className="underline">{t('banner.admin')}</Link></> : null}.</div>
                    </div>
                  )}
                  {error && <div className="mb-4 text-sm" style={{ color: '#ef4444' }}>{error}</div>}
                  <div className={isDesktop && previewOpen ? 'grid gap-6 items-start lg:grid-cols-[minmax(0,1fr)_360px]' : 'grid gap-6 items-start lg:grid-cols-[minmax(0,1fr)_44px]'}>
                    <div className="min-w-0"><Outlet /></div>
                    {isDesktop ? (
                      previewOpen ? (
                        <div className="relative lg:sticky lg:top-0">
                          <button type="button" onClick={togglePreview} className="absolute right-0 -top-1 p-1.5 rounded-lg" title={t('common.hide')} style={{ color: 'var(--text-muted)' }}><PanelRightClose size={16} /></button>
                          <WidgetPreview slug={store?.slug || null} language={store?.language} compact />
                        </div>
                      ) : (
                        <div className="lg:sticky lg:top-0 flex justify-end">
                          <button type="button" onClick={togglePreview} className="p-2.5 rounded-xl" title={t('widget.preview')} style={{ color: 'var(--text-muted)', border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}><PanelRightOpen size={18} /></button>
                        </div>
                      )
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </main>
        </div>
      </div>
    </CommerceAccessContext.Provider>
  );
}

function Paywall({ tier }: { tier: string | null }) {
  const { t } = useTranslation('commerce');
  return (
    <div className="max-w-xl mx-auto mt-10 rounded-3xl p-8 text-center" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
      <div className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg,#f59e0b,#ef4444)' }}><ShoppingBag size={26} color="#fff" /></div>
      <h2 className="text-xl font-700 mb-2" style={{ fontFamily: 'Space Grotesk, sans-serif', color: 'var(--text-primary)' }}>{t('paywall.title')}</h2>
      <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>{t('paywall.text')}{tier ? ` (${t('paywall.now', { tier })})` : ''}</p>
      <Link to="/billing" className="inline-block px-5 py-3 rounded-xl text-sm font-600" style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}>{t('paywall.open')}</Link>
    </div>
  );
}

function TokenGate({ onSubmit }: { onSubmit: (token: string) => void }) {
  const [v, setV] = useState('');
  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-6" style={{ background: 'var(--bg-primary)' }}>
      <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) onSubmit(v.trim()); }} className="w-full max-w-sm rounded-3xl p-6 flex flex-col gap-3" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#f59e0b,#ef4444)' }}><ShoppingBag size={22} color="#fff" /></div>
        <h1 className="text-lg font-700" style={{ fontFamily: 'Space Grotesk, sans-serif', color: 'var(--text-primary)' }}>Owner console</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Paste the <code>ADMIN_TOKEN</code> from your <code>.env</code>. It is stored in this browser only.</p>
        <input value={v} onChange={(e) => setV(e.target.value)} type="password" placeholder="ADMIN_TOKEN" className="px-3 py-2.5 rounded-xl text-sm" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }} />
        <button type="submit" className="px-4 py-2.5 rounded-xl text-sm font-600" style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}>Open console</button>
        <a href="https://comag.vibevox.pro/?utm_source=github&utm_medium=console&utm_campaign=tiktok-sales-agent" target="_blank" rel="noopener" className="text-xs underline" style={{ color: 'var(--text-muted)' }}>No server to run? Use the hosted edition at comag.vibevox.pro</a>
      </form>
    </div>
  );
}
