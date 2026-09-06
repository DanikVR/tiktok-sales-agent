/**
 * Commerce Agents — автоматическая обложка 1200×630 для превью ссылки в мессенджерах, когда владелец
 * не загрузил свою: градиент в акцентном цвете, логотип (или аватар из соцсети) и до трёх фото
 * товаров из каталога. Без текста — заголовок и описание мессенджер берёт из og:title/og:description,
 * а шрифты на сервере ненадёжны. Кэш в uploads/commerce/<tenant>/cover-auto.png на 1 час.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { safeFetch } from '../safe_fetch.js';
import { listProducts } from './catalog.js';
import type { CommerceSettings } from './types.js';

const __dirname_c = path.dirname(fileURLToPath(import.meta.url));
const uploadsRoot = path.resolve(__dirname_c, '../../../../uploads/commerce');
const W = 1200; const H = 630;

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0x111827;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade([r, g, b]: [number, number, number], k: number): string {
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/** Локальный файл для /api/uploads/... или скачивание по https. */
export async function loadImage(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const m = /^\/api\/uploads\/commerce\/(.+)$/.exec(url);
    if (m) { const p = path.join(uploadsRoot, m[1].replace(/\.\./g, '')); return fs.existsSync(p) ? fs.readFileSync(p) : null; }
    if (/^https?:\/\//i.test(url)) {
      const r = await safeFetch(url, { timeoutMs: 10_000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VibeVoxCommerceBot/1.0)' } });
      if (!r.ok) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      return buf.length && buf.length < 12 * 1024 * 1024 ? buf : null;
    }
  } catch { /* ignore */ }
  return null;
}

async function rounded(buf: Buffer, size: number, radius: number): Promise<Buffer> {
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`);
  return sharp(buf).resize(size, size, { fit: 'cover' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

/** Собирает обложку (или отдаёт кэш). Возвращает путь к PNG. */
export async function buildAutoCover(s: CommerceSettings): Promise<string> {
  const dir = path.join(uploadsRoot, String(s.tenant_id).replace(/[^a-zA-Z0-9_-]/g, ''));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'cover-auto.png');
  const stampFile = path.join(dir, 'cover-auto.stamp');
  const stamp = `${s.accent}|${s.logo_url || ''}|${s.updated_at}`;
  try {
    if (fs.existsSync(file) && fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8') === stamp && Date.now() - fs.statSync(file).mtimeMs < 60 * 60_000) return file;
  } catch { /* rebuild */ }

  const rgb = hexToRgb(s.accent);
  const bg = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(rgb, 1.25)}"/><stop offset="1" stop-color="${shade(rgb, 0.65)}"/></linearGradient>
      <radialGradient id="r" cx="0.85" cy="0.15" r="0.7"><stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <rect width="${W}" height="${H}" fill="url(#r)"/>
    <circle cx="140" cy="520" r="260" fill="#ffffff" fill-opacity="0.06"/>
    <rect x="70" y="70" width="${W - 140}" height="${H - 140}" rx="36" fill="#ffffff" fill-opacity="0.10" stroke="#ffffff" stroke-opacity="0.25" stroke-width="2"/>
  </svg>`);
  const layers: sharp.OverlayOptions[] = [];

  const logo = await loadImage(s.logo_url);
  if (logo) {
    try { layers.push({ input: await rounded(logo, 200, 44), left: 120, top: 215 }); } catch { /* skip */ }
  } else {
    // Без логотипа — крупный мягкий знак чата вместо буквы (буквам нужны шрифты).
    layers.push({ input: Buffer.from(`<svg width="200" height="200"><rect width="200" height="200" rx="44" fill="#ffffff" fill-opacity="0.92"/><path d="M60 70h80a20 20 0 0 1 20 20v30a20 20 0 0 1-20 20H95l-25 22v-22h-10a20 20 0 0 1-20-20V90a20 20 0 0 1 20-20z" fill="${shade(rgb, 0.9)}"/><circle cx="85" cy="105" r="7" fill="#fff"/><circle cx="110" cy="105" r="7" fill="#fff"/><circle cx="135" cy="105" r="7" fill="#fff"/></svg>`), left: 120, top: 215 });
  }

  // До трёх фото товаров справа.
  let x = 400;
  try {
    const { items } = await listProducts(s.tenant_id, { page: 1, limit: 24, includeInactive: false });
    const withImg = items.filter((p) => p.image_url).slice(0, 3);
    for (const p of withImg) {
      const buf = await loadImage(p.image_url);
      if (!buf) continue;
      try { layers.push({ input: await rounded(buf, 230, 32), left: x, top: 200 }); x += 250; } catch { /* skip */ }
    }
  } catch { /* каталог недоступен */ }

  const out = await sharp(bg).composite(layers).png({ compressionLevel: 8 }).toBuffer();
  fs.writeFileSync(file, out);
  fs.writeFileSync(stampFile, stamp);
  return file;
}
