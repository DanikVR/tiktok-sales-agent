/**
 * PWA витрины (/c/:slug): каждая витрина — отдельное приложение на телефоне покупателя.
 * Манифест на витрину (id/scope/start_url со слагом — ставится именно этот чат), иконки из загруженного
 * логотипа (192/512, обычная и maskable), короткое имя под иконкой (одно слово, до 12 знаков),
 * service worker для /c/ (нужен для установки в части браузеров и для push).
 */
import sharp from 'sharp';
import type { CommerceSettings } from './types.js';
import { loadImage } from './cover.js';

const iconCache = new Map<string, Buffer>();

/** Короткое имя под иконкой: своё (до 12 знаков) или первое осмысленное слово названия магазина. */
export function shortAppName(s: Pick<CommerceSettings, 'app_name' | 'brand_name' | 'assistant_name'>): string {
  const own = String(s.app_name || '').trim();
  if (own) return own.slice(0, 12);
  const src = String(s.brand_name || s.assistant_name || '').trim();
  const words = src.split(/[\s|—–\-:·•,/\\()"'«»]+/).map((w) => w.trim()).filter((w) => /[\p{L}\p{N}]{2,}/u.test(w));
  const first = words[0] || 'Agent';
  return first.length > 12 ? first.slice(0, 12) : first;
}

export function buildManifest(s: CommerceSettings): Record<string, unknown> {
  const base = `/api/commerce/w/${s.slug}`;
  const name = (s.brand_name || s.assistant_name || 'Commerce Agents').slice(0, 45);
  return {
    id: `/c/${s.slug}`,
    name,
    short_name: shortAppName(s),
    description: (s.share_description || s.greeting || '').slice(0, 200) || undefined,
    start_url: `/c/${s.slug}?pwa=1`,
    scope: `/c/${s.slug}`,
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: /^#[0-9a-f]{6}$/i.test(s.accent || '') ? s.accent : '#111827',
    lang: s.language && s.language !== 'auto' ? s.language : undefined,
    icons: [
      { src: `${base}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${base}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${base}/icon-512.png?maskable=1`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

function escapeXml(t: string): string { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

async function letterIcon(s: CommerceSettings, size: number, accent: string): Promise<Buffer> {
  const letter = (s.brand_name || s.assistant_name || 'A').trim().slice(0, 1).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="${accent}"/><text x="50%" y="50%" dy=".36em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${Math.round(size * 0.5)}" fill="#ffffff">${escapeXml(letter)}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Иконка приложения: логотип по центру на белом (maskable — с запасом под скругление), без логотипа — буква на акценте. */
export async function buildIcon(s: CommerceSettings, size: number, maskable: boolean): Promise<Buffer> {
  const key = `${s.slug}:${size}:${maskable ? 'm' : 'a'}:${s.logo_url || ''}:${s.accent || ''}:${s.brand_name || ''}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const accent = /^#[0-9a-f]{6}$/i.test(s.accent || '') ? String(s.accent) : '#111827';
  const logo = await loadImage(s.logo_url);
  const inner = Math.round(size * (maskable ? 0.6 : 0.78));
  let out: Buffer | null = null;
  if (logo) {
    try {
      const fg = await sharp(logo).resize(inner, inner, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
      out = await sharp({ create: { width: size, height: size, channels: 4, background: '#ffffff' } }).composite([{ input: fg, gravity: 'centre' }]).png().toBuffer();
    } catch { out = null; }
  }
  if (!out) out = await letterIcon(s, size, accent);
  if (iconCache.size > 300) iconCache.clear();
  iconCache.set(key, out);
  return out;
}

/** Сброс кэша иконок витрины (после смены логотипа/цвета/названия). */
export function invalidateIcons(slug: string): void {
  for (const k of Array.from(iconCache.keys())) if (k.startsWith(`${slug}:`)) iconCache.delete(k);
}

/** Service worker для /c/: установка, push и клик по уведомлению. Сеть — как обычно, ничего не кэшируем. */
export const SERVICE_WORKER_JS = `/* Commerce Agents storefront service worker */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () { /* network as usual; handler needed for installability */ });
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  var title = d.title || 'Message';
  e.waitUntil(self.registration.showNotification(title, { body: d.body || '', icon: d.icon, badge: d.badge || d.icon, data: { url: d.url || '/' }, tag: d.tag, renotify: !!d.tag }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    var path = url.split('?')[0];
    for (var i = 0; i < list.length; i++) { var c = list[i]; if (c.url.indexOf(path) !== -1 && 'focus' in c) { try { c.navigate(url); } catch (err) {} return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
`;
