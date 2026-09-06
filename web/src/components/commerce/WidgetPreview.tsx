/**
 * WidgetPreview — «телефон» с живым виджетом (iframe /embed/commerce/:slug?preview=1).
 * На десктопе живёт в правой колонке кабинета (CommerceLayout) на всех разделах, на телефоне —
 * под формой на странице «Виджет». Перезагружается по refreshPreview(), черновик — postPreview().
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { registerPreviewFrame, onPreviewReady, subscribePreviewRefresh } from './widgetPreviewStore';

/** true при ширине ≥ 1024px (Tailwind lg) — чтобы не держать два iframe одновременно. */
export function useIsDesktop(): boolean {
  const q = '(min-width: 1024px)';
  const [is, setIs] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(q).matches : true));
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setIs(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return is;
}

export default function WidgetPreview({ slug, language, compact = false }: { slug: string | null; language?: string | null; compact?: boolean }) {
  const { t, i18n } = useTranslation('commerce');
  const [key, setKey] = useState(0);
  useEffect(() => subscribePreviewRefresh(() => setKey((k) => k + 1)), []);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => { if (e.data?.type === 'comag' && e.data.action === 'ready') onPreviewReady(); };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  useEffect(() => () => registerPreviewFrame(null), []);
  if (!slug) return null;
  const lang = language && language !== 'auto' ? language : (i18n.language || 'en').slice(0, 2);
  const src = `/embed/commerce/${slug}?lang=${lang}&preview=1`;
  const height = compact ? 'min(640px, calc(100dvh - 140px))' : 640;
  return (
    <div>
      <div className="text-[11px] font-600 uppercase mb-2" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>{t('widget.preview')}</div>
      <div className="mx-auto rounded-[28px] overflow-hidden" style={{ width: 360, height, maxWidth: '100%', boxShadow: '0 24px 64px rgba(0,0,0,.35)', border: '1px solid var(--border-medium)' }}>
        <iframe ref={registerPreviewFrame} key={key} title="preview" src={src} className="w-full h-full" style={{ border: 0, background: '#fff' }} />
      </div>
      <p className="text-[11px] mt-2 text-center" style={{ color: 'var(--text-muted)' }}>{t('widget.previewHint')}</p>
    </div>
  );
}
