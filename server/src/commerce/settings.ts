/**
 * Commerce Agents — per-tenant настройки: slug виджета, бренд, тема, профиль бизнеса, политики,
 * свой ключ Anthropic (шифрован AES-256-GCM тем же механизмом, что ключи Gemini/Chatwoot).
 * tenant_id — VARCHAR: суперадмин ('global_admin') тоже может завести витрину для демо.
 */

import { randomBytes } from 'crypto';
import { normalizeLang } from './i18n.js';
import pool, { isFallbackActive } from '../db.js';
import { encryptSecret, decryptSecret } from '../encryption.js';
import type { CommerceSettings, CrawlStatus } from './types.js';

const memSettings = new Map<string, any>(); // fallback-режим (dev без PG)

function slugifyBase(name: string): string {
  const translit: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  let out = '';
  for (const ch of (name || '').toLowerCase().trim()) out += translit[ch] ?? ch;
  out = out.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  return out || 'shop';
}

function newSlug(name: string): string {
  return `${slugifyBase(name)}-${randomBytes(3).toString('hex')}`;
}

const COLS = `tenant_id, slug, brand_name, assistant_name, brand_voice, greeting, accent, theme, logo_url, position,
  language, business_profile, policies, currency, site_url, checkout_url, platform, enabled, voice_enabled,
  proactive_enabled, (anthropic_key_encrypted IS NOT NULL AND anthropic_key_encrypted <> '') AS has_anthropic_key,
  (gemini_key_encrypted IS NOT NULL AND gemini_key_encrypted <> '') AS has_gemini_key,
  shopping_model, merchant_model, crawl_status, share_title, share_description, share_cover_url, starters, agent_notes, owner_lang, app_name, pixels, consent_enabled, privacy_url, owner_email, email_notify, digest_enabled, created_at, updated_at`;

function mapRow(r: any): CommerceSettings {
  return {
    tenant_id: r.tenant_id,
    slug: r.slug,
    brand_name: r.brand_name || '',
    assistant_name: r.assistant_name || 'Ассистент',
    brand_voice: r.brand_voice || '',
    greeting: r.greeting || '',
    accent: r.accent || '#111827',
    theme: r.theme || 'auto',
    logo_url: r.logo_url || null,
    position: r.position || 'bottom-right',
    language: r.language || 'auto',
    business_profile: r.business_profile || '',
    policies: r.policies || '',
    currency: r.currency || 'EUR',
    site_url: r.site_url || null,
    checkout_url: r.checkout_url || null,
    platform: r.platform || 'other',
    enabled: r.enabled !== false,
    voice_enabled: r.voice_enabled !== false,
    proactive_enabled: !!r.proactive_enabled,
    has_anthropic_key: !!r.has_anthropic_key,
    has_gemini_key: !!r.has_gemini_key,
    shopping_model: r.shopping_model || null,
    merchant_model: r.merchant_model || null,
    crawl_status: (typeof r.crawl_status === 'string' ? safeJson(r.crawl_status) : r.crawl_status) || null,
    agent_notes: r.agent_notes || '',
    owner_lang: r.owner_lang || null,
    app_name: r.app_name || null,
    pixels: (typeof r.pixels === 'string' ? safeJson(r.pixels) : r.pixels) || null,
    consent_enabled: !!r.consent_enabled,
    privacy_url: r.privacy_url || null,
    owner_email: r.owner_email || null,
    email_notify: r.email_notify !== false,
    digest_enabled: r.digest_enabled !== false,
    starters: (() => { const v = typeof r.starters === 'string' ? safeJson(r.starters) : r.starters; return Array.isArray(v) && v.length ? v.map(String).slice(0, 4) : null; })(),
    share_title: r.share_title || '',
    share_description: r.share_description || '',
    share_cover_url: r.share_cover_url || null,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at || ''),
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at || ''),
  };
}

function safeJson(s: string): any { try { return JSON.parse(s); } catch { return null; } }

/** Настройки тенанта; создаются с дефолтами при первом обращении. */
export async function getSettings(tenantId: string, brandHint?: string): Promise<CommerceSettings> {
  if (isFallbackActive()) {
    let m = memSettings.get(tenantId);
    if (!m) {
      m = { tenant_id: tenantId, slug: newSlug(brandHint || 'shop'), brand_name: brandHint || '', created_at: new Date(), updated_at: new Date() };
      memSettings.set(tenantId, m);
    }
    return mapRow(m);
  }
  const r = await pool.query(`SELECT ${COLS} FROM commerce_settings WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
  if ((r.rows as any[]).length) return mapRow((r.rows as any[])[0]);
  const ins = await pool.query(
    `INSERT INTO commerce_settings (tenant_id, slug, brand_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id) DO UPDATE SET updated_at = now()
     RETURNING ${COLS}`,
    [tenantId, newSlug(brandHint || 'shop'), brandHint || ''],
  );
  return mapRow((ins.rows as any[])[0]);
}

export async function getSettingsBySlug(slug: string): Promise<CommerceSettings | null> {
  if (!slug || !/^[a-z0-9-]{3,64}$/.test(slug)) return null;
  if (isFallbackActive()) {
    for (const m of memSettings.values()) if (m.slug === slug) return mapRow(m);
    return null;
  }
  const r = await pool.query(`SELECT ${COLS} FROM commerce_settings WHERE slug = $1 LIMIT 1`, [slug]);
  const row = (r.rows as any[])[0];
  return row ? mapRow(row) : null;
}

const EDITABLE: Array<keyof CommerceSettings> = [
  'app_name', 'pixels', 'consent_enabled', 'privacy_url', 'email_notify', 'digest_enabled',
  'brand_name', 'assistant_name', 'brand_voice', 'greeting', 'accent', 'theme', 'logo_url', 'position', 'language',
  'business_profile', 'policies', 'currency', 'site_url', 'checkout_url', 'platform', 'enabled', 'voice_enabled',
  'proactive_enabled', 'shopping_model', 'merchant_model', 'share_title', 'share_description', 'share_cover_url', 'starters', 'agent_notes',
];
const LIMITS: Partial<Record<keyof CommerceSettings, number>> = {
  app_name: 12,
  brand_name: 120, assistant_name: 60, brand_voice: 300, greeting: 300, accent: 16, logo_url: 500, language: 8,
  business_profile: 20_000, policies: 60_000, currency: 8, site_url: 500, checkout_url: 500, shopping_model: 80, merchant_model: 80,
  share_title: 120, share_description: 300, share_cover_url: 500, agent_notes: 6000,
};
const NULLABLE_URLS = new Set<string>(['site_url', 'checkout_url', 'logo_url', 'share_cover_url', 'shopping_model', 'merchant_model', 'privacy_url']);

export async function updateSettings(tenantId: string, patch: Partial<CommerceSettings>): Promise<CommerceSettings> {
  await getSettings(tenantId); // гарантируем строку
  const sets: string[] = [];
  const vals: any[] = [];
  for (const key of EDITABLE) {
    if (!(key in patch)) continue;
    let v: any = (patch as any)[key];
    if (typeof v === 'string') {
      v = v.trim();
      const lim = LIMITS[key];
      if (lim && v.length > lim) v = v.slice(0, lim);
      if (key === 'accent' && !/^#[0-9a-fA-F]{6}$/.test(v)) v = '#111827';
      if (key === 'theme' && !['light', 'dark', 'auto'].includes(v)) v = 'auto';
      if (key === 'position' && !['bottom-right', 'bottom-left'].includes(v)) v = 'bottom-right';
      if (key === 'platform' && !['shopify', 'woocommerce', 'magento', 'prestashop', 'opencart', 'squarespace', 'wix', 'bitrix', 'insales', 'tilda', 'other'].includes(v)) v = 'other';
      if ((key === 'site_url' || key === 'checkout_url' || key === 'logo_url' || key === 'share_cover_url' || key === 'privacy_url') && v && !/^(https?:\/\/|\/api\/uploads\/)/i.test(v)) v = null;
      if (v === '' && NULLABLE_URLS.has(key)) v = null;
    } else if (typeof v === 'boolean') {
      /* ok */
    } else if (key === 'pixels' && (v === null || (v && typeof v === 'object'))) {
      // Только id нужного формата; пустой набор — NULL.
      const clean = (x: unknown, re: RegExp) => { const t = String(x || '').trim(); return re.test(t) ? t : ''; };
      const px = v ? { meta: clean((v as any).meta, /^\d{10,20}$/), tiktok: clean((v as any).tiktok, /^[A-Z0-9]{10,40}$/i), google: clean((v as any).google, /^(G|AW|GT|DC)-[A-Z0-9]{5,20}$/i) } : null;
      vals.push(px && (px.meta || px.tiktok || px.google) ? JSON.stringify(px) : null);
      sets.push(`pixels = $${vals.length}::jsonb`);
      continue;
    } else if (key === 'starters' && (v === null || Array.isArray(v))) {
      const list = Array.isArray(v) ? v.map((x) => String(x || '').trim().slice(0, 60)).filter(Boolean).slice(0, 4) : [];
      vals.push(list.length ? JSON.stringify(list) : null);
      sets.push(`starters = $${vals.length}::jsonb`);
      continue;
    } else if (v === null && NULLABLE_URLS.has(key)) {
      /* ok */
    } else {
      continue;
    }
    vals.push(v);
    sets.push(`${key} = $${vals.length}`);
  }
  if (isFallbackActive()) {
    const m = memSettings.get(tenantId) || {};
    for (const key of EDITABLE) if (key in patch) m[key] = (patch as any)[key];
    m.updated_at = new Date();
    memSettings.set(tenantId, m);
    return mapRow(m);
  }
  if (!sets.length) return getSettings(tenantId);
  vals.push(tenantId);
  const r = await pool.query(
    `UPDATE commerce_settings SET ${sets.join(', ')}, updated_at = now() WHERE tenant_id = $${vals.length} RETURNING ${COLS}`,
    vals,
  );
  return mapRow((r.rows as any[])[0]);
}

export async function setCrawlStatus(tenantId: string, status: CrawlStatus | null): Promise<void> {
  if (isFallbackActive()) { const m = memSettings.get(tenantId); if (m) m.crawl_status = status; return; }
  await pool.query(`UPDATE commerce_settings SET crawl_status = $2::jsonb, updated_at = now() WHERE tenant_id = $1`, [tenantId, status ? JSON.stringify(status) : null]).catch(() => {});
}

// ── Ключ Anthropic тенанта ──────────────────────────────────────────────────────────────────

export async function getTenantAnthropicKey(tenantId: string): Promise<string | null> {
  if (isFallbackActive()) return memSettings.get(tenantId)?.anthropic_key || null;
  const r = await pool.query(`SELECT anthropic_key_encrypted FROM commerce_settings WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
  const row = (r.rows as any[])[0];
  if (!row?.anthropic_key_encrypted) return null;
  return decryptSecret(row.anthropic_key_encrypted);
}

export async function setTenantAnthropicKey(tenantId: string, rawKey: string | null): Promise<void> {
  await getSettings(tenantId);
  if (isFallbackActive()) { const m = memSettings.get(tenantId); if (m) m.anthropic_key = rawKey; return; }
  await pool.query(
    `UPDATE commerce_settings SET anthropic_key_encrypted = $2, updated_at = now() WHERE tenant_id = $1`,
    [tenantId, rawKey ? encryptSecret(rawKey) : null],
  );
}

export async function getTenantGeminiKey(tenantId: string): Promise<string | null> {
  if (isFallbackActive()) return memSettings.get(tenantId)?.gemini_key || null;
  const r = await pool.query(`SELECT gemini_key_encrypted FROM commerce_settings WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
  const row = (r.rows as any[])[0];
  if (!row?.gemini_key_encrypted) return null;
  return decryptSecret(row.gemini_key_encrypted);
}

export async function setTenantGeminiKey(tenantId: string, rawKey: string | null): Promise<void> {
  await getSettings(tenantId);
  if (isFallbackActive()) { const m = memSettings.get(tenantId); if (m) m.gemini_key = rawKey; return; }
  await pool.query(
    `UPDATE commerce_settings SET gemini_key_encrypted = $2, updated_at = now() WHERE tenant_id = $1`,
    [tenantId, rawKey ? encryptSecret(rawKey) : null],
  );
}

/** Публичный конфиг виджета (без секретов и внутренних полей). */
export function toPublicConfig(s: CommerceSettings) {
  return {
    slug: s.slug,
    pixels: s.pixels || null,
    consentEnabled: !!s.consent_enabled,
    privacyUrl: s.privacy_url || null,
    brandName: s.brand_name,
    assistantName: s.assistant_name,
    greeting: s.greeting,
    accent: s.accent,
    theme: s.theme,
    logoUrl: s.logo_url,
    position: s.position,
    language: s.language,
    currency: s.currency,
    platform: s.platform,
    checkoutUrl: s.checkout_url,
    siteUrl: s.site_url,
    enabled: s.enabled,
    voiceEnabled: s.voice_enabled,
    proactiveEnabled: s.proactive_enabled,
    shareTitle: s.share_title || s.brand_name,
    shareDescription: s.share_description || s.greeting,
    shareCoverUrl: s.share_cover_url,
    starters: s.starters,
  };
}

// ── Соцсети: статус анализа и подключённые аккаунты (JSONB-колонки commerce_settings) ──────
const memSocial = new Map<string, { status: CrawlStatus | null; accounts: Record<string, unknown> }>();
export async function getSocialStatus(tenantId: string): Promise<CrawlStatus | null> {
  if (isFallbackActive()) return memSocial.get(tenantId)?.status || null;
  const r = await pool.query(`SELECT social_status FROM commerce_settings WHERE tenant_id = $1`, [tenantId]).catch(() => ({ rows: [] as any[] }));
  return (r.rows as any[])[0]?.social_status || null;
}
export async function setSocialStatus(tenantId: string, status: CrawlStatus | null): Promise<void> {
  if (isFallbackActive()) { const m = memSocial.get(tenantId) || { status: null, accounts: {} }; m.status = status; memSocial.set(tenantId, m); return; }
  await pool.query(`UPDATE commerce_settings SET social_status = $2::jsonb, updated_at = now() WHERE tenant_id = $1`, [tenantId, status ? JSON.stringify(status) : null]).catch(() => {});
}
export async function getSocialAccounts(tenantId: string): Promise<Record<string, any>> {
  if (isFallbackActive()) return memSocial.get(tenantId)?.accounts || {};
  const r = await pool.query(`SELECT social_accounts FROM commerce_settings WHERE tenant_id = $1`, [tenantId]).catch(() => ({ rows: [] as any[] }));
  return (r.rows as any[])[0]?.social_accounts || {};
}
export async function setSocialAccounts(tenantId: string, patch: Record<string, unknown>): Promise<void> {
  if (isFallbackActive()) { const m = memSocial.get(tenantId) || { status: null, accounts: {} }; m.accounts = { ...m.accounts, ...patch }; memSocial.set(tenantId, m); return; }
  await pool.query(`UPDATE commerce_settings SET social_accounts = COALESCE(social_accounts, '{}'::jsonb) || $2::jsonb, updated_at = now() WHERE tenant_id = $1`, [tenantId, JSON.stringify(patch)]).catch(() => {});
}

/** Запомнить язык интерфейса владельца (заголовок X-Lang кабинета). Пишем только при смене. */
const ownerLangCache = new Map<string, string>();
export async function rememberOwnerLang(tenantId: string, raw: unknown): Promise<void> {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string' || !v.trim()) return;
  const lang = normalizeLang(v);
  if (ownerLangCache.get(tenantId) === lang) return;
  ownerLangCache.set(tenantId, lang);
  if (isFallbackActive()) { const m = memSettings.get(tenantId); if (m) m.owner_lang = lang; return; }
  await pool.query(`UPDATE commerce_settings SET owner_lang = $2 WHERE tenant_id = $1 AND owner_lang IS DISTINCT FROM $2`, [tenantId, lang]).catch(() => {});
}

/** Запомнить почту владельца (из JWT при входе в кабинет) — для копий уведомлений и ежедневной сводки. */
const ownerEmailCache = new Map<string, string>();
export async function rememberOwnerEmail(tenantId: string, raw: unknown): Promise<void> {
  const email = typeof raw === 'string' ? raw.trim().toLowerCase().slice(0, 200) : '';
  if (!email || !/.+@.+\..+/.test(email) || ownerEmailCache.get(tenantId) === email) return;
  ownerEmailCache.set(tenantId, email);
  if (isFallbackActive()) { const m = memSettings.get(tenantId); if (m) m.owner_email = email; return; }
  await pool.query(`UPDATE commerce_settings SET owner_email = $2 WHERE tenant_id = $1 AND owner_email IS DISTINCT FROM $2`, [tenantId, email]).catch(() => {});
}
