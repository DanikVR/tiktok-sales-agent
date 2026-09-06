/** Виджет: оформление (живой предпросмотр), подсказки, указания агенту, код для сайта, пиксель, ссылка для пересылки с обложкой. i18n `commerce`. */
import { useEffect, useRef, useState } from 'react';
import WidgetPreview, { useIsDesktop } from '../../components/commerce/WidgetPreview';
import { postPreview, refreshPreview } from '../../components/commerce/widgetPreviewStore';
import { useTranslation } from 'react-i18next';
import { Upload, Check, ExternalLink, Loader2 } from 'lucide-react';
import { api } from './api';
import { Card, Btn, Input, Textarea, Field, Select, CopyRow, useToast } from './ui';

const ACCENTS = ['#111827', '#2563eb', '#0d9488', '#7c3aed', '#16a34a', '#ea580c', '#db2777'];
const LANGS: Array<[string, string]> = [['auto', ''], ['ru', 'Русский'], ['en', 'English'], ['pl', 'Polski'], ['de', 'Deutsch'], ['es', 'Español'], ['fr', 'Français'], ['it', 'Italiano'], ['pt', 'Português'], ['tr', 'Türkçe'], ['uk', 'Українська'], ['kk', 'Қазақша'], ['cs', 'Čeština'], ['nl', 'Nederlands'], ['ro', 'Română'], ['hu', 'Magyar'], ['el', 'Ελληνικά'], ['bg', 'Български'], ['sv', 'Svenska'], ['ar', 'العربية'], ['he', 'עברית'], ['hi', 'हिन्दी'], ['zh', '中文'], ['ja', '日本語'], ['ko', '한국어'], ['vi', 'Tiếng Việt'], ['id', 'Bahasa Indonesia']];

export default function CommerceWidgetSettingsPage() {
  const { t } = useTranslation('commerce');
  const [s, setS] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const isDesktop = useIsDesktop();
  const [voiceCustom, setVoiceCustom] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const [toast, show] = useToast();

  useEffect(() => { api('/api/commerce/settings').then((r) => setS(r.settings)).catch((e) => show(e?.message, 'error')); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const patch = (p: any) => setS((prev: any) => ({ ...prev, ...p }));
  const pushPreview = () => {
    if (!s) return;
    postPreview({ brandName: s.brand_name || '', assistantName: s.assistant_name || '', greeting: s.greeting || '', accent: s.accent || '#111827', theme: s.theme || 'auto', logoUrl: s.logo_url || null, voiceEnabled: s.voice_enabled !== false, shareCoverUrl: s.share_cover_url || null, starters: (s.starters && s.starters.length) ? s.starters : null });
  };
  useEffect(() => {
    const tm = window.setTimeout(pushPreview, 120);
    return () => window.clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.brand_name, s?.assistant_name, s?.greeting, s?.accent, s?.theme, s?.logo_url, s?.voice_enabled, s?.share_cover_url, s?.starters]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await api('/api/commerce/settings', { method: 'PUT', body: JSON.stringify({ brand_name: s.brand_name, assistant_name: s.assistant_name, app_name: s.app_name || null, greeting: s.greeting, brand_voice: s.brand_voice, accent: s.accent, theme: s.theme, position: s.position, language: s.language, enabled: s.enabled, voice_enabled: s.voice_enabled, share_title: s.share_title, share_description: s.share_description, agent_notes: s.agent_notes || '', logo_url: s.logo_url || null, share_cover_url: s.share_cover_url || null, starters: (s.starters && s.starters.length) ? s.starters : null }) });
      setS(r.settings); refreshPreview(); show(t('common.saved'));
    } catch (e: any) { show(e?.message, 'error'); }
    setSaving(false);
  };
  const upload = async (f: File, kind: 'logo' | 'cover') => {
    const fd = new FormData(); fd.append('image', f);
    try { const r = await api(`/api/commerce/logo?kind=${kind}`, { method: 'POST', body: fd }); setS(r.settings); refreshPreview(); show(t('widget.uploaded')); } catch (e: any) { show(e?.message, 'error'); }
  };

  if (!s) return <div className="py-10 text-center"><Loader2 className="animate-spin inline" /></div>;
  // Имя под иконкой на телефоне по умолчанию — первое слово названия (как на сервере в pwa.ts).
  const derivedApp = (String(s.brand_name || s.assistant_name || '').split(/[\s|—–\-:·•,/\\()"'«»]+/).find((w: string) => /[\p{L}\p{N}]{2,}/u.test(w)) || 'Agent').slice(0, 12);
  const mono: React.CSSProperties = { background: 'var(--bg-tertiary)', color: 'var(--text-primary)' };

  return (
    <div className="space-y-5">
      {toast}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-700" style={{ fontFamily: 'Space Grotesk, sans-serif', color: 'var(--text-primary)' }}>{t('widget.title')}</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-primary)' }}><input type="checkbox" checked={s.enabled !== false} onChange={(e) => patch({ enabled: e.target.checked })} /> {t('widget.enabled')}</label>
          <Btn onClick={() => void save()} disabled={saving}>{saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {t('common.save')}</Btn>
        </div>
      </div>

      <div className="grid xl:grid-cols-2 gap-5 items-start">
        <div className="space-y-4">
          <Card title={t('widget.design')}>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label={t('widget.brand')} hint={t('widget.brandHint')}><Input value={s.brand_name || ''} onChange={(e) => patch({ brand_name: e.target.value })} placeholder={t('widget.brandPlaceholder')} /></Field>
              <Field label={t('widget.assistant')}><Input value={s.assistant_name || ''} onChange={(e) => patch({ assistant_name: e.target.value })} placeholder={t('widget.assistantPlaceholder')} /></Field>
              <div className="sm:col-span-2"><Field label={t('widget.appName')} hint={t('widget.appNameHint', { n: (s.app_name || '').length })}><Input value={s.app_name || ''} maxLength={12} onChange={(e) => patch({ app_name: e.target.value.slice(0, 12) })} placeholder={derivedApp} /></Field></div>
              <div className="sm:col-span-2"><Field label={t('widget.greeting')} hint={t('widget.greetingHint')}><Textarea value={s.greeting || ''} onChange={(e) => patch({ greeting: e.target.value })} style={{ minHeight: 64 }} placeholder={t('widget.greetingPlaceholder')} /></Field></div>
              <div className="sm:col-span-2"><Field label={t('widget.starters')} hint={t('widget.startersHint')}><Textarea value={(s.starters || []).join('\n')} onChange={(e) => patch({ starters: e.target.value.split('\n').map((x: string) => x.trim()).filter(Boolean).slice(0, 4) })} style={{ minHeight: 64 }} placeholder={t('widget.startersPlaceholder')} /></Field></div>
              <div className="sm:col-span-2"><Field label={t('widget.notes')} hint={t('widget.notesHint')}><Textarea value={s.agent_notes || ''} onChange={(e) => patch({ agent_notes: e.target.value })} style={{ minHeight: 96 }} placeholder={t('widget.notesPlaceholder')} /></Field></div>
              <div className="sm:col-span-2"><Field label={t('widget.voice')} hint={t('widget.voiceHint')}>
                {(() => {
                  const raw = t('widget.voicePresets', { returnObjects: true }) as unknown;
                  const presets = Array.isArray(raw) ? (raw as string[]) : [];
                  const cur = s.brand_voice || '';
                  const isPreset = !voiceCustom && (!cur || presets.includes(cur));
                  return (
                    <div className="grid sm:grid-cols-2 gap-2">
                      <Select value={isPreset ? cur : '__custom'} onChange={(e) => { if (e.target.value === '__custom') { setVoiceCustom(true); if (presets.includes(cur)) patch({ brand_voice: '' }); } else { setVoiceCustom(false); patch({ brand_voice: e.target.value }); } }}>
                        <option value="">{t('widget.voicePlaceholder')}</option>
                        {presets.map((v) => <option key={v} value={v}>{v}</option>)}
                        <option value="__custom">{t('widget.voiceCustom')}</option>
                      </Select>
                      {!isPreset ? <Input value={cur} onChange={(e) => patch({ brand_voice: e.target.value })} placeholder={t('widget.voicePlaceholder')} autoFocus /> : null}
                    </div>
                  );
                })()}
              </Field></div>
              <Field label={t('widget.accent')}>
                <div className="flex items-center gap-2 flex-wrap">
                  {ACCENTS.map((c) => <button key={c} type="button" onClick={() => patch({ accent: c })} className="w-7 h-7 rounded-full" style={{ background: c, outline: s.accent === c ? '2px solid var(--text-primary)' : '2px solid transparent', outlineOffset: 2 }} aria-label={c} />)}
                  <input type="color" value={s.accent || '#111827'} onChange={(e) => patch({ accent: e.target.value })} className="w-9 h-7 rounded cursor-pointer bg-transparent border-0" />
                  <Input value={s.accent || ''} onChange={(e) => { const v = e.target.value.trim().replace(/[^#0-9a-fA-F]/g, ''); patch({ accent: v.startsWith('#') ? v : `#${v}` }); }} placeholder="#111827" maxLength={7} autoComplete="off" style={{ width: 112, fontFamily: 'ui-monospace, monospace' }} />
                </div>
              </Field>
              <Field label={t('widget.theme')}><Select value={s.theme || 'auto'} onChange={(e) => patch({ theme: e.target.value })}><option value="auto">{t('widget.themeAuto')}</option><option value="light">{t('widget.themeLight')}</option><option value="dark">{t('widget.themeDark')}</option></Select></Field>
              <Field label={t('widget.position')}><Select value={s.position || 'bottom-right'} onChange={(e) => patch({ position: e.target.value })}><option value="bottom-right">{t('widget.positionRight')}</option><option value="bottom-left">{t('widget.positionLeft')}</option></Select></Field>
              <Field label={t('widget.language')} hint={t('widget.languageHint')}><Select value={s.language || 'auto'} onChange={(e) => patch({ language: e.target.value })}>{LANGS.map(([v, l]) => <option key={v} value={v}>{v === 'auto' ? t('widget.languageAuto') : l}</option>)}</Select></Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-2" style={{ color: 'var(--text-primary)' }}><input type="checkbox" checked={s.voice_enabled !== false} onChange={(e) => patch({ voice_enabled: e.target.checked })} /> {t('widget.mic')}</label>
              <div className="sm:col-span-2 flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl overflow-hidden flex items-center justify-center" style={{ background: 'var(--bg-tertiary)' }}>{s.logo_url ? <img src={s.logo_url} alt="" className="w-full h-full object-cover" /> : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('widget.logoEmpty')}</span>}</div>
                <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f, 'logo'); e.currentTarget.value = ''; }} />
                <Btn variant="ghost" onClick={() => logoRef.current?.click()}><Upload size={14} /> {t('widget.logo')}</Btn>
                {s.logo_url ? <Btn variant="ghost" onClick={() => patch({ logo_url: null })}>{t('widget.logoRemove')}</Btn> : null}
              </div>
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title={t('widget.code')}>
            <CopyRow text={s.embedSnippet} />
            <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>{t('widget.codeHint')}</p>
          </Card>

          <Card title={t('widget.pixel')}>
            <CopyRow text={s.pixelSnippet} />
            <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>{t('widget.pixelHint')}</p>
          </Card>

          <Card title={t('widget.share')} right={<a href={s.shareUrl} target="_blank" rel="noreferrer" className="text-xs flex items-center gap-1" style={{ color: 'var(--text-muted)' }}><ExternalLink size={13} /> {t('common.open')}</a>}>
            <CopyRow text={s.shareUrl} className="mb-3" />
            <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>{t('widget.shareHint')}</p>
            <div className="grid sm:grid-cols-[160px_1fr] gap-3">
              <div>
                <div className="rounded-xl overflow-hidden aspect-[1.91/1] flex items-center justify-center" style={{ background: 'var(--bg-tertiary)' }}>{s.share_cover_url ? <img src={s.share_cover_url} alt="" className="w-full h-full object-cover" /> : s.coverAutoUrl ? <img src={s.coverAutoUrl} alt="" className="w-full h-full object-cover" /> : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>1200×630</span>}</div>
                <input ref={coverRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f, 'cover'); e.currentTarget.value = ''; }} />
                <Btn variant="ghost" className="mt-2 w-full justify-center" onClick={() => coverRef.current?.click()}><Upload size={14} /> {s.share_cover_url ? t('widget.coverReplace') : t('widget.cover')}</Btn>
                <div className="text-[10px] mt-1 text-center" style={{ color: 'var(--text-muted)' }}>{s.share_cover_url ? t('widget.coverOwn') : t('widget.coverAuto')}</div>
              </div>
              <div className="space-y-2">
                <Field label={t('widget.shareTitle')} hint={t('widget.shareTitleHint')}><Input value={s.share_title || ''} onChange={(e) => patch({ share_title: e.target.value })} placeholder={s.brand_name || t('widget.brandPlaceholder')} /></Field>
                <Field label={t('widget.shareDescription')} hint={t('widget.shareDescriptionHint')}><Input value={s.share_description || ''} onChange={(e) => patch({ share_description: e.target.value })} placeholder={t('widget.shareDescriptionPlaceholder')} /></Field>
              </div>
            </div>
          </Card>
        </div>

        {!isDesktop ? <WidgetPreview slug={s.slug} language={s.language} /> : null}
      </div>
    </div>
  );
}
