/** Настройки: профиль бизнеса и условия, магазин и чекаут, ключи ИИ (Anthropic и Gemini, свои у пользователя), модели, уведомления. i18n `commerce`. */
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, KeyRound, Loader2, Trash2, ExternalLink } from 'lucide-react';
import { api } from './api';
import { Card, Btn, Input, Textarea, Field, Select, useToast, useConfirm } from './ui';
import TelegramNotifyCard from './TelegramNotifyCard';
import SiteAnalyzePanel from './SiteAnalyzePanel';
import SocialImportCard from './SocialImportCard';

const SECTIONS = ['sources', 'business', 'store', 'keys', 'telegram', 'danger'];

const CURRENCY_GROUPS: Array<{ key: 'eu' | 'europe' | 'cis' | 'world'; items: Array<[string, string]> }> = [
  { key: 'eu', items: [['EUR', 'Euro'], ['PLN', 'Złoty'], ['CZK', 'Koruna'], ['HUF', 'Forint'], ['RON', 'Leu'], ['BGN', 'Lev'], ['SEK', 'Krona'], ['DKK', 'Krone']] },
  { key: 'europe', items: [['GBP', 'Pound'], ['CHF', 'Franc'], ['NOK', 'Krone'], ['ISK', 'Króna'], ['RSD', 'Dinar'], ['BAM', 'Mark'], ['MKD', 'Denar'], ['ALL', 'Lek']] },
  { key: 'cis', items: [['UAH', 'Hryvnia'], ['RUB', 'Ruble'], ['BYN', 'Ruble'], ['KZT', 'Tenge'], ['UZS', 'Som'], ['KGS', 'Som'], ['TJS', 'Somoni'], ['TMT', 'Manat'], ['AZN', 'Manat'], ['AMD', 'Dram'], ['GEL', 'Lari'], ['MDL', 'Leu']] },
  { key: 'world', items: [['USD', 'US Dollar'], ['TRY', 'Lira'], ['AED', 'Dirham'], ['ILS', 'Shekel'], ['CNY', 'Yuan'], ['JPY', 'Yen'], ['INR', 'Rupee'], ['CAD', 'Dollar'], ['AUD', 'Dollar'], ['SAR', 'Riyal'], ['EGP', 'Pound'], ['BRL', 'Real'], ['MXN', 'Peso'], ['KRW', 'Won'], ['THB', 'Baht'], ['SGD', 'Dollar'], ['HKD', 'Dollar'], ['ZAR', 'Rand']] },
];

function currencyName(code: string, fallback: string): string {
  try { return (new Intl.DisplayNames([navigator.language], { type: 'currency' }).of(code) as string) || fallback; } catch { return fallback; }
}

function CurrencySelect({ value, onChange, t }: { value: string; onChange: (v: string) => void; t: (k: string, p?: any) => string }) {
  const known = new Set(CURRENCY_GROUPS.flatMap((g) => g.items.map(([c]) => c)));
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {value && !known.has(value) ? <option value={value}>{t('settings.currencyDetected', { c: value })}</option> : null}
      {CURRENCY_GROUPS.map((g) => (
        <optgroup key={g.key} label={t(`settings.currencyGroups.${g.key}`)}>
          {g.items.map(([code, name]) => <option key={code} value={code}>{code} · {currencyName(code, name)}</option>)}
        </optgroup>
      ))}
    </Select>
  );
}

function ModelSelect({ value, onChange, models, defaultId, t }: { value: string; onChange: (v: string) => void; models: { models: Array<{ id: string; name: string; note?: string }> } | null; defaultId: string; t: (k: string, p?: any) => string }) {
  const list = models?.models || [];
  const def = list.find((m) => m.id === defaultId);
  const known = new Set(list.map((m) => m.id));
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t('settings.modelDefault', { name: def ? def.name : defaultId })}</option>
      {value && !known.has(value) ? <option value={value}>{t('settings.modelManual', { id: value })}</option> : null}
      {list.map((m) => <option key={m.id} value={m.id}>{m.name}{m.note ? ` — ${m.note}` : ''} · {m.id}</option>)}
    </Select>
  );
}

/** Поле ключа с проверкой, показом префикса и подсказкой, где взять. */
function KeyField({ vendor, expected, placeholder, configured, source, howKey, textKey, path, t, onDone }: { vendor: string; expected: string; placeholder: string; configured: boolean; source: string | null; howKey: string; textKey: string; path: string; t: (k: string, p?: any) => string; onDone: () => void }) {
  const [val, setVal] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, show] = useToast();
  const clean = val.replace(/\s+/g, '');
  const ok = new RegExp(`^${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(clean);
  const save = async () => { setBusy(true); try { await api(path, { method: 'PUT', body: JSON.stringify({ apiKey: clean }) }); setVal(''); show(t('settings.keySaved')); onDone(); } catch (e: any) { show(e?.message, 'error'); } setBusy(false); };
  const drop = async () => { setBusy(true); try { await api(path, { method: 'DELETE' }); show(t('settings.keyDeleted')); onDone(); } catch (e: any) { show(e?.message, 'error'); } setBusy(false); };
  const link = vendor === 'Anthropic' ? 'https://console.anthropic.com/settings/keys' : 'https://aistudio.google.com/api-keys';
  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}>
      {toast}
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <div className="text-sm font-700" style={{ color: 'var(--text-primary)' }}>{t(vendor === 'Anthropic' ? 'settings.anthropic' : 'settings.gemini')}</div>
        {configured ? <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,.12)', color: '#10b981' }}>{t('settings.connected')} ({source === 'tenant' ? t('settings.ownKey') : t('settings.platformKey')})</span> : <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,.12)', color: '#ef4444' }}>{t('settings.notSet')}</span>}
      </div>
      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{t(textKey)}</p>
      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>{t(howKey)} <a href={link} target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-1">{link.replace(/^https:\/\//, '')} <ExternalLink size={11} /></a></p>
      <div className="flex gap-2 flex-wrap">
        <div className="flex-1 min-w-[240px] relative">
          <Input type="text" value={val} onChange={(e) => setVal(e.target.value)} placeholder={placeholder} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} name={`comag_key_${vendor}`} data-lpignore="true" data-1p-ignore="true" className="pr-20" style={{ WebkitTextSecurity: showKey ? 'none' : 'disc', fontFamily: 'ui-monospace, monospace' } as React.CSSProperties} />
          <button type="button" onClick={() => setShowKey((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-2 py-1 rounded-lg" style={{ color: 'var(--text-muted)' }}>{showKey ? t('settings.hideKey') : t('settings.show')}</button>
        </div>
        <Btn onClick={() => void save()} disabled={busy || clean.length < 20}>{busy ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />} {t('settings.checkSave')}</Btn>
        {source === 'tenant' ? <Btn variant="danger" onClick={() => void drop()} disabled={busy}><Trash2 size={15} /> {t('settings.keyDelete')}</Btn> : null}
      </div>
      {clean ? (
        <div className="text-xs mt-2" style={{ color: ok ? 'var(--text-muted)' : '#ef4444' }}>
          {ok ? t('settings.willSend', { prefix: clean.slice(0, 14), n: clean.length }) : t('settings.notLikeKey', { vendor, prefix: clean.slice(0, 6), n: clean.length, expected })}
        </div>
      ) : null}
    </div>
  );
}

export default function CommerceSettingsPage() {
  const { t } = useTranslation('commerce');
  const [s, setS] = useState<any>(null);
  const [key, setKey] = useState<any>(null);
  const [gkey, setGkey] = useState<any>(null);
  const [models, setModels] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [toast, show] = useToast();
  const [confirmNode, askConfirm] = useConfirm();
  const location = useLocation();
  const navigate = useNavigate();
  const jump = (id: string) => { navigate(`/commerce/settings#${id}`); window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30); };
  // Переход по якорю из меню/ссылки: скроллим к секции после загрузки настроек.
  useEffect(() => {
    const id = location.hash.replace('#', '');
    if (!id || !s) return;
    const tm = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    return () => window.clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.hash, !!s]);

  const load = () => api('/api/commerce/settings').then((r) => { setS(r.settings); setKey(r.key); setGkey(r.geminiKey || null); }).catch((e) => show(e?.message, 'error'));
  const loadModels = () => api('/api/commerce/models').then(setModels).catch(() => {});
  const accessChanged = () => window.dispatchEvent(new Event('comag:access'));
  useEffect(() => { void load(); void loadModels(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const patch = (p: any) => setS((prev: any) => ({ ...prev, ...p }));

  const save = async () => {
    setSaving(true);
    try { const r = await api('/api/commerce/settings', { method: 'PUT', body: JSON.stringify({ business_profile: s.business_profile, policies: s.policies, currency: s.currency, site_url: s.site_url, checkout_url: s.checkout_url, platform: s.platform, shopping_model: s.shopping_model, merchant_model: s.merchant_model }) }); setS(r.settings); show(t('common.saved')); } catch (e: any) { show(e?.message, 'error'); }
    setSaving(false);
  };
  const wipe = async () => { if (!(await askConfirm({ title: t('settings.wipeTitle'), message: t('settings.wipeText'), confirmText: t('settings.wipeConfirm'), danger: true }))) return; try { const r = await api('/api/commerce/products?confirm=all', { method: 'DELETE' }); show(t('settings.wiped', { n: r.deleted })); } catch (e: any) { show(e?.message, 'error'); } };

  if (!s) return <div className="py-10 text-center"><Loader2 className="animate-spin inline" /></div>;
  const platforms: Array<[string, string]> = [['other', t('settings.platformAuto')], ['shopify', 'Shopify'], ['woocommerce', 'WooCommerce (WordPress)'], ['magento', 'Magento / Adobe Commerce'], ['prestashop', 'PrestaShop'], ['opencart', 'OpenCart'], ['squarespace', 'Squarespace'], ['wix', 'Wix'], ['bitrix', '1C-Bitrix'], ['insales', 'InSales'], ['tilda', 'Tilda']];

  return (
    <div className="space-y-5">
      {toast}
      {confirmNode}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-700" style={{ fontFamily: 'Space Grotesk, sans-serif', color: 'var(--text-primary)' }}>{t('settings.title')}</h1>
        <Btn onClick={() => void save()} disabled={saving}>{saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {t('common.save')}</Btn>
      </div>

      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span style={{ color: 'var(--text-muted)' }}>{t('settings.jump')}:</span>
        {SECTIONS.map((id) => <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); jump(id); }} className="px-3 py-1.5 rounded-full" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}>{t(`nav.sub.${id}`)}</a>)}
      </div>

      <div className="grid xl:grid-cols-2 gap-5 items-start">
      <div className="space-y-5">
      <div id="sources" className="scroll-mt-4">
        <Card title={t('settings.sources')}>
          <div className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>{t('settings.sourcesHint')}</div>
          <SiteAnalyzePanel onChanged={() => void load()} />
        </Card>
        <div className="mt-5"><SocialImportCard onProductsChanged={() => void load()} /></div>
      </div>
      <div id="business" className="scroll-mt-4 space-y-5">
      <Card title={t('settings.business')}>
        <Field label={t('settings.profile')} hint={t('settings.profileHint')}>
          <Textarea value={s.business_profile || ''} onChange={(e) => patch({ business_profile: e.target.value })} style={{ minHeight: 140 }} placeholder={t('settings.profilePlaceholder')} />
        </Field>
      </Card>

      <Card title={t('settings.terms')}>
        <Field label={t('settings.termsLabel')} hint={t('settings.termsHint')}>
          <Textarea value={s.policies || ''} onChange={(e) => patch({ policies: e.target.value })} style={{ minHeight: 220 }} placeholder={t('settings.termsPlaceholder')} />
        </Field>
      </Card>

      </div>
      </div>
      <div className="space-y-5">
      <div id="store" className="scroll-mt-4">
      <Card title={t('settings.store')}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('settings.siteUrl')}><Input value={s.site_url || ''} onChange={(e) => patch({ site_url: e.target.value })} placeholder="https://your-shop.pl" autoComplete="off" name="comag_site_url" /></Field>
          <Field label={t('settings.platform')}><Select value={s.platform || 'other'} onChange={(e) => patch({ platform: e.target.value })}>{platforms.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label={t('settings.checkoutUrl')} hint={t('settings.checkoutHint')}><Input value={s.checkout_url || ''} onChange={(e) => patch({ checkout_url: e.target.value })} placeholder="https://your-shop.pl/cart" autoComplete="off" name="comag_checkout_url" inputMode="url" /></Field>
          <Field label={t('settings.currency')} hint={t('settings.currencyHint')}><CurrencySelect value={s.currency || 'EUR'} onChange={(v) => patch({ currency: v })} t={t} /></Field>
        </div>
      </Card>

      </div>
      <div id="keys" className="scroll-mt-4">
      <Card title={t('settings.keys')}>
        <div className="grid lg:grid-cols-2 gap-3">
          <KeyField vendor="Anthropic" expected="sk-ant-api" placeholder={t('settings.keyPlaceholderAnthropic')} configured={!!key?.configured} source={key?.source || null} howKey="settings.anthropicHow" textKey="settings.anthropicText" path="/api/commerce/anthropic-key" t={t} onDone={() => { void load(); void loadModels(); accessChanged(); }} />
          <KeyField vendor="Gemini" expected="AIza" placeholder={t('settings.keyPlaceholderGemini')} configured={!!gkey?.configured} source={gkey?.source || null} howKey="settings.geminiHow" textKey="settings.geminiText" path="/api/commerce/gemini-key" t={t} onDone={() => void load()} />
        </div>
        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <Field label={t('settings.modelShopping')} hint={t('settings.modelShoppingHint')}>
            <ModelSelect value={s.shopping_model || ''} onChange={(v) => patch({ shopping_model: v || null })} models={models} defaultId={models?.defaults?.shopping || 'claude-sonnet-5'} t={t} />
          </Field>
          <Field label={t('settings.modelMerchant')} hint={t('settings.modelMerchantHint')}>
            <ModelSelect value={s.merchant_model || ''} onChange={(v) => patch({ merchant_model: v || null })} models={models} defaultId={models?.defaults?.merchant || 'claude-opus-5'} t={t} />
          </Field>
          {models ? <div className="sm:col-span-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>{models.source === 'api' ? t('settings.modelsFromApi', { n: models.models.length }) : t('settings.modelsStatic')}</div> : null}
        </div>
      </Card>

      </div>
      <div id="telegram" className="scroll-mt-4"><TelegramNotifyCard /></div>

      <div id="danger" className="scroll-mt-4">
      <Card title={t('settings.danger')}>
        <Btn variant="danger" onClick={() => void wipe()}><Trash2 size={15} /> {t('settings.wipe')}</Btn>
      </Card>
      </div>
      </div>
      </div>
    </div>
  );
}
