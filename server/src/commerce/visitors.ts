/**
 * Профиль посетителя витрины без авторизации: устройство и браузер (User-Agent), язык, часовой пояс,
 * город по IP (geoip-lite, база GeoLite2 внутри пакета), источник перехода (?src / utm_* / referrer),
 * число визитов, установлено ли приложение. Ключ — постоянный visitor_id из localStorage покупателя.
 */
import geoip from 'geoip-lite';
import pool, { isFallbackActive } from '../db.js';

export interface VisitorClient { ua?: string; lang?: string; tz?: string; screen?: string; standalone?: boolean; inApp?: string | null; touch?: boolean; referrer?: string }
export interface VisitorGeo { country?: string; region?: string; city?: string; tz?: string }
export interface VisitorProfile { visitor_id: string; first_seen_at: string; last_seen_at: string; visits: number; client: VisitorClient; geo: VisitorGeo | null; source: string | null; installed: boolean }

const mem = new Map<string, VisitorProfile>();

/** Источник первого перехода: ?src= → utm_source[/utm_campaign] → домен referrer. */
export function detectSource(pageUrl: string | null | undefined, referrer: string | null | undefined): string | null {
  try {
    if (pageUrl) {
      const u = new URL(pageUrl);
      const src = u.searchParams.get('src') || u.searchParams.get('utm_source');
      if (src) { const camp = u.searchParams.get('utm_campaign'); return (camp ? `${src} / ${camp}` : src).slice(0, 80); }
    }
  } catch { /* ignore */ }
  try {
    if (referrer) { const h = new URL(referrer).hostname.replace(/^www\./, ''); if (h) return h.slice(0, 80); }
  } catch { /* ignore */ }
  return null;
}

export function lookupGeo(ip: string | null | undefined): VisitorGeo | null {
  if (!ip) return null;
  const clean = ip.replace(/^::ffff:/, '');
  if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd)/i.test(clean)) return null;
  try {
    const g = geoip.lookup(clean);
    if (!g) return null;
    return { country: g.country || undefined, region: g.region || undefined, city: g.city || undefined, tz: g.timezone || undefined };
  } catch { return null; }
}

function sanitizeClient(c: any): VisitorClient {
  if (!c || typeof c !== 'object') return {};
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  return {
    ua: str(c.ua, 300), lang: str(c.lang, 16), tz: str(c.tz, 64), screen: str(c.screen, 16), referrer: str(c.referrer, 300),
    standalone: !!c.standalone, touch: !!c.touch, inApp: typeof c.inApp === 'string' ? c.inApp.slice(0, 24) : null,
  };
}

function mapRow(r: any): VisitorProfile {
  const iso = (v: any) => (v instanceof Date ? v.toISOString() : String(v || ''));
  const j = (v: any) => (typeof v === 'string' ? JSON.parse(v) : v) || null;
  return { visitor_id: r.visitor_id, first_seen_at: iso(r.first_seen_at), last_seen_at: iso(r.last_seen_at), visits: Number(r.visits || 0), client: j(r.client) || {}, geo: j(r.geo), source: r.source || null, installed: !!r.installed };
}

/** Отметить визит: новый визит — если прошлый был больше 30 минут назад. Источник — только первый (first touch). */
export async function touchVisitor(tenantId: string, visitorId: string, input: { client?: any; ip?: string | null; pageUrl?: string | null; installed?: boolean }): Promise<void> {
  const vid = String(visitorId || '').slice(0, 64);
  if (!vid) return;
  const client = sanitizeClient(input.client);
  const geo = lookupGeo(input.ip);
  const source = detectSource(input.pageUrl, client.referrer);
  const installed = !!(input.installed || client.standalone);
  if (isFallbackActive()) {
    const k = `${tenantId}:${vid}`;
    const prev = mem.get(k);
    const now = new Date().toISOString();
    const newVisit = !prev || Date.now() - +new Date(prev.last_seen_at) > 30 * 60_000;
    mem.set(k, { visitor_id: vid, first_seen_at: prev?.first_seen_at || now, last_seen_at: now, visits: (prev?.visits || 0) + (newVisit ? 1 : 0), client: { ...(prev?.client || {}), ...client }, geo: geo || prev?.geo || null, source: prev?.source || source, installed: installed || !!prev?.installed });
    return;
  }
  await pool.query(
    `INSERT INTO commerce_visitors (tenant_id, visitor_id, first_seen_at, last_seen_at, visits, client, geo, source, installed)
     VALUES ($1, $2, now(), now(), 1, $3::jsonb, $4::jsonb, $5, $6)
     ON CONFLICT (tenant_id, visitor_id) DO UPDATE SET
       visits = commerce_visitors.visits + CASE WHEN commerce_visitors.last_seen_at < now() - interval '30 minutes' THEN 1 ELSE 0 END,
       last_seen_at = now(),
       client = commerce_visitors.client || EXCLUDED.client,
       geo = coalesce(EXCLUDED.geo, commerce_visitors.geo),
       source = coalesce(commerce_visitors.source, EXCLUDED.source),
       installed = commerce_visitors.installed OR EXCLUDED.installed`,
    [tenantId, vid, JSON.stringify(client), geo ? JSON.stringify(geo) : null, source, installed],
  ).catch((e: Error) => console.warn('[commerce/visitors] touch failed:', e.message));
}

export async function getVisitor(tenantId: string, visitorId: string | null | undefined): Promise<VisitorProfile | null> {
  if (!visitorId) return null;
  if (isFallbackActive()) return mem.get(`${tenantId}:${visitorId}`) || null;
  const r = await pool.query(`SELECT * FROM commerce_visitors WHERE tenant_id = $1 AND visitor_id = $2`, [tenantId, visitorId]).catch(() => null);
  const row = (r?.rows as any[] | undefined)?.[0];
  return row ? mapRow(row) : null;
}

/** IP клиента за nginx (trust proxy включён) — для geoip. */
export function clientIp(req: { ip?: string; headers: Record<string, unknown>; socket?: { remoteAddress?: string } }): string | null {
  const xf = req.headers['x-forwarded-for'];
  const first = typeof xf === 'string' ? xf.split(',')[0].trim() : Array.isArray(xf) ? String(xf[0]) : '';
  return first || req.ip || req.socket?.remoteAddress || null;
}
