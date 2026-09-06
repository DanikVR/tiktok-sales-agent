/**
 * Commerce Agents — каталог тенанта: CRUD, поиск, импорт из CSV/XLSX/JSON.
 *
 * Поиск: Postgres full-text ('simple') + пословное ILIKE (без морфологии, зато находит любые
 * языки), ранг = число совпавших слов + бонус за точную фразу; фильтры цены/категории/наличия.
 * Модель никогда не видит каталог целиком — только результаты инструментов (blueprint: «tool
 * results are context»), и только id из этих результатов принимаются в корзину.
 */

import { randomUUID } from 'crypto';
import * as XLSX from 'xlsx';
import pool, { isFallbackActive } from '../db.js';
import type { CommerceProduct, ProductInput } from './types.js';

const memProducts = new Map<string, CommerceProduct[]>(); // fallback-режим

const COLS = `id, tenant_id, external_id, sku, title, brand, description, price, currency, compare_at_price, in_stock, stock,
  image_url, url, category, attributes, options, option_values, variant_of, active, created_at, updated_at`;

function j(v: any, dflt: any) {
  if (v == null) return dflt;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return dflt; } }
  return v;
}

export function mapProduct(r: any): CommerceProduct {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    external_id: r.external_id || null,
    sku: r.sku || null,
    title: r.title || '',
    brand: r.brand || null,
    description: r.description || null,
    price: Number(r.price || 0),
    currency: r.currency || 'RUB',
    compare_at_price: r.compare_at_price != null ? Number(r.compare_at_price) : null,
    in_stock: r.in_stock !== false,
    stock: r.stock != null ? Number(r.stock) : null,
    image_url: r.image_url || null,
    url: r.url || null,
    category: r.category || null,
    attributes: j(r.attributes, {}),
    options: j(r.options, {}),
    option_values: j(r.option_values, {}),
    variant_of: r.variant_of || null,
    active: r.active !== false,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at || ''),
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at || ''),
  };
}

function searchText(p: ProductInput): string {
  const attrs = Object.entries(p.attributes || {}).map(([k, v]) => `${k} ${v}`).join(' ');
  const opts = Object.entries(p.options || {}).map(([k, v]) => `${k} ${(v || []).join(' ')}`).join(' ');
  return [p.title, p.brand, p.sku, p.category, p.description, attrs, opts].filter(Boolean).join(' \n ').slice(0, 20_000);
}

function normalizeInput(input: ProductInput): Required<Pick<ProductInput, 'title'>> & ProductInput {
  const title = String(input.title || '').trim().slice(0, 300);
  if (!title) throw new Error('title обязателен');
  const price = Number(input.price ?? 0);
  return {
    ...input,
    title,
    external_id: input.external_id ? String(input.external_id).slice(0, 300) : null,
    sku: input.sku ? String(input.sku).slice(0, 120) : null,
    brand: input.brand ? String(input.brand).slice(0, 120) : null,
    description: input.description ? String(input.description).slice(0, 12_000) : null,
    price: Number.isFinite(price) && price >= 0 ? Math.round(price * 100) / 100 : 0,
    currency: (input.currency || 'RUB').toString().toUpperCase().slice(0, 8),
    compare_at_price: input.compare_at_price != null && Number.isFinite(Number(input.compare_at_price)) ? Number(input.compare_at_price) : null,
    in_stock: input.in_stock !== false,
    stock: input.stock != null && Number.isFinite(Number(input.stock)) ? Math.max(0, Math.round(Number(input.stock))) : null,
    image_url: input.image_url ? String(input.image_url).slice(0, 1000) : null,
    url: input.url ? String(input.url).slice(0, 1000) : null,
    category: input.category ? String(input.category).slice(0, 160) : null,
    attributes: sanitizeAttrs(input.attributes),
    options: sanitizeOptions(input.options),
    option_values: sanitizeAttrs(input.option_values),
    variant_of: input.variant_of || null,
    active: input.active !== false,
  };
}

function sanitizeAttrs(a: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (a && typeof a === 'object' && !Array.isArray(a)) {
    for (const [k, v] of Object.entries(a).slice(0, 40)) {
      const key = String(k).trim().slice(0, 60);
      if (key && v != null && String(v).trim()) out[key] = String(v).trim().slice(0, 300);
    }
  }
  return out;
}
function sanitizeOptions(o: any): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o).slice(0, 8)) {
      const key = String(k).trim().slice(0, 60);
      const vals = Array.isArray(v) ? v.map((x) => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, 40) : [];
      if (key && vals.length) out[key] = vals;
    }
  }
  return out;
}

// ── CRUD ────────────────────────────────────────────────────────────────────────────────────

export async function listProducts(tenantId: string, opts: { q?: string; page?: number; limit?: number; includeInactive?: boolean } = {}): Promise<{ items: CommerceProduct[]; total: number }> {
  const limit = Math.min(200, Math.max(1, opts.limit || 50));
  const page = Math.max(1, opts.page || 1);
  if (isFallbackActive()) {
    let all = (memProducts.get(tenantId) || []).filter((p) => opts.includeInactive || p.active);
    if (opts.q) { const q = opts.q.toLowerCase(); all = all.filter((p) => `${p.title} ${p.sku} ${p.brand} ${p.category}`.toLowerCase().includes(q)); }
    return { items: all.slice((page - 1) * limit, page * limit), total: all.length };
  }
  const where: string[] = ['tenant_id = $1'];
  const vals: any[] = [tenantId];
  if (!opts.includeInactive) where.push('active = true');
  if (opts.q) { vals.push(`%${opts.q}%`); where.push(`(title ILIKE $${vals.length} OR sku ILIKE $${vals.length} OR brand ILIKE $${vals.length} OR category ILIKE $${vals.length})`); }
  const w = where.join(' AND ');
  const total = await pool.query(`SELECT count(*)::int AS n FROM commerce_products WHERE ${w}`, vals);
  vals.push(limit, (page - 1) * limit);
  const r = await pool.query(`SELECT ${COLS} FROM commerce_products WHERE ${w} ORDER BY updated_at DESC LIMIT $${vals.length - 1} OFFSET $${vals.length}`, vals);
  return { items: (r.rows as any[]).map(mapProduct), total: (total.rows as any[])[0]?.n || 0 };
}

export async function countProducts(tenantId: string): Promise<number> {
  if (isFallbackActive()) return (memProducts.get(tenantId) || []).length;
  const r = await pool.query(`SELECT count(*)::int AS n FROM commerce_products WHERE tenant_id = $1 AND active = true`, [tenantId]).catch(() => ({ rows: [] }));
  return (r.rows as any[])[0]?.n || 0;
}

export async function getProduct(tenantId: string, id: string): Promise<CommerceProduct | null> {
  if (!id) return null;
  if (isFallbackActive()) return (memProducts.get(tenantId) || []).find((p) => p.id === id) || null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await pool.query(`SELECT ${COLS} FROM commerce_products WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [tenantId, id]);
  const row = (r.rows as any[])[0];
  return row ? mapProduct(row) : null;
}

export async function getProductsByIds(tenantId: string, ids: string[]): Promise<CommerceProduct[]> {
  const clean = Array.from(new Set(ids.filter((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)))).slice(0, 50);
  if (!clean.length) return [];
  if (isFallbackActive()) return (memProducts.get(tenantId) || []).filter((p) => clean.includes(p.id));
  const r = await pool.query(`SELECT ${COLS} FROM commerce_products WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, clean]);
  const byId = new Map((r.rows as any[]).map((row) => [row.id, mapProduct(row)]));
  return clean.map((id) => byId.get(id)).filter(Boolean) as CommerceProduct[];
}

export async function getVariants(tenantId: string, familyId: string): Promise<CommerceProduct[]> {
  if (isFallbackActive()) return (memProducts.get(tenantId) || []).filter((p) => p.variant_of === familyId);
  const r = await pool.query(`SELECT ${COLS} FROM commerce_products WHERE tenant_id = $1 AND variant_of = $2 AND active = true ORDER BY price ASC LIMIT 60`, [tenantId, familyId]);
  return (r.rows as any[]).map(mapProduct);
}

export async function createProduct(tenantId: string, input: ProductInput): Promise<CommerceProduct> {
  const p = normalizeInput(input);
  if (isFallbackActive()) {
    const row: CommerceProduct = { ...(p as any), id: randomUUID(), tenant_id: tenantId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    memProducts.set(tenantId, [row, ...(memProducts.get(tenantId) || [])]);
    return row;
  }
  const r = await pool.query(
    `INSERT INTO commerce_products (tenant_id, external_id, sku, title, brand, description, price, currency, compare_at_price, in_stock, stock,
       image_url, url, category, attributes, options, option_values, variant_of, active, search_text)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18,$19,$20)
     RETURNING ${COLS}`,
    [tenantId, p.external_id, p.sku, p.title, p.brand, p.description, p.price, p.currency, p.compare_at_price, p.in_stock, p.stock,
      p.image_url, p.url, p.category, JSON.stringify(p.attributes || {}), JSON.stringify(p.options || {}), JSON.stringify(p.option_values || {}),
      p.variant_of, p.active, searchText(p)],
  );
  return mapProduct((r.rows as any[])[0]);
}

/** Upsert по external_id (импорт/краулер): существующая запись обновляется, иначе создаётся. */
export async function upsertProductByExternalId(tenantId: string, input: ProductInput): Promise<{ product: CommerceProduct; created: boolean }> {
  const p = normalizeInput(input);
  if (!p.external_id) return { product: await createProduct(tenantId, p), created: true };
  if (isFallbackActive()) {
    const list = memProducts.get(tenantId) || [];
    const idx = list.findIndex((x) => x.external_id === p.external_id);
    if (idx >= 0) { list[idx] = { ...list[idx], ...(p as any), updated_at: new Date().toISOString() }; return { product: list[idx], created: false }; }
    return { product: await createProduct(tenantId, p), created: true };
  }
  const r = await pool.query(
    `INSERT INTO commerce_products (tenant_id, external_id, sku, title, brand, description, price, currency, compare_at_price, in_stock, stock,
       image_url, url, category, attributes, options, option_values, variant_of, active, search_text)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18,$19,$20)
     ON CONFLICT (tenant_id, external_id) WHERE external_id IS NOT NULL DO UPDATE SET
       sku = EXCLUDED.sku, title = EXCLUDED.title, brand = EXCLUDED.brand, description = EXCLUDED.description,
       price = EXCLUDED.price, currency = EXCLUDED.currency, compare_at_price = EXCLUDED.compare_at_price,
       in_stock = EXCLUDED.in_stock, stock = EXCLUDED.stock, image_url = EXCLUDED.image_url, url = EXCLUDED.url,
       category = EXCLUDED.category, attributes = EXCLUDED.attributes, options = EXCLUDED.options,
       option_values = EXCLUDED.option_values, variant_of = EXCLUDED.variant_of, active = EXCLUDED.active,
       search_text = EXCLUDED.search_text, updated_at = now()
     RETURNING ${COLS}, (xmax = 0) AS inserted`,
    [tenantId, p.external_id, p.sku, p.title, p.brand, p.description, p.price, p.currency, p.compare_at_price, p.in_stock, p.stock,
      p.image_url, p.url, p.category, JSON.stringify(p.attributes || {}), JSON.stringify(p.options || {}), JSON.stringify(p.option_values || {}),
      p.variant_of, p.active, searchText(p)],
  );
  const row = (r.rows as any[])[0];
  return { product: mapProduct(row), created: !!row.inserted };
}

export async function updateProduct(tenantId: string, id: string, patch: Partial<ProductInput>): Promise<CommerceProduct | null> {
  const cur = await getProduct(tenantId, id);
  if (!cur) return null;
  const merged = normalizeInput({ ...cur, ...patch, title: patch.title ?? cur.title } as ProductInput);
  if (isFallbackActive()) {
    const list = memProducts.get(tenantId) || [];
    const idx = list.findIndex((x) => x.id === id);
    if (idx >= 0) list[idx] = { ...list[idx], ...(merged as any), updated_at: new Date().toISOString() };
    return list[idx] || null;
  }
  const r = await pool.query(
    `UPDATE commerce_products SET external_id=$3, sku=$4, title=$5, brand=$6, description=$7, price=$8, currency=$9, compare_at_price=$10,
       in_stock=$11, stock=$12, image_url=$13, url=$14, category=$15, attributes=$16::jsonb, options=$17::jsonb, option_values=$18::jsonb,
       variant_of=$19, active=$20, search_text=$21, updated_at=now()
     WHERE tenant_id=$1 AND id=$2 RETURNING ${COLS}`,
    [tenantId, id, merged.external_id, merged.sku, merged.title, merged.brand, merged.description, merged.price, merged.currency, merged.compare_at_price,
      merged.in_stock, merged.stock, merged.image_url, merged.url, merged.category, JSON.stringify(merged.attributes || {}), JSON.stringify(merged.options || {}),
      JSON.stringify(merged.option_values || {}), merged.variant_of, merged.active, searchText(merged)],
  );
  const row = (r.rows as any[])[0];
  return row ? mapProduct(row) : null;
}

export async function deleteProduct(tenantId: string, id: string): Promise<boolean> {
  if (isFallbackActive()) {
    const list = memProducts.get(tenantId) || [];
    const n = list.length;
    memProducts.set(tenantId, list.filter((x) => x.id !== id));
    return n !== (memProducts.get(tenantId) || []).length;
  }
  const r = await pool.query(`DELETE FROM commerce_products WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return (r.rowCount || 0) > 0;
}

export async function deleteAllProducts(tenantId: string): Promise<number> {
  if (isFallbackActive()) { const n = (memProducts.get(tenantId) || []).length; memProducts.set(tenantId, []); return n; }
  const r = await pool.query(`DELETE FROM commerce_products WHERE tenant_id = $1`, [tenantId]);
  return r.rowCount || 0;
}

// ── Поиск для агента ────────────────────────────────────────────────────────────────────────

export interface SearchFilters {
  category?: string;
  min_price?: number;
  max_price?: number;
  in_stock_only?: boolean;
  attributes?: Record<string, string>;
  sort?: 'relevance' | 'price_asc' | 'price_desc';
}

function tokens(q: string): string[] {
  return Array.from(new Set(String(q || '').toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 2))).slice(0, 8);
}

export async function searchProducts(tenantId: string, query: string, filters: SearchFilters = {}, limit = 8): Promise<CommerceProduct[]> {
  const lim = Math.min(20, Math.max(1, limit));
  const toks = tokens(query);
  if (isFallbackActive()) {
    const all = (memProducts.get(tenantId) || []).filter((p) => p.active && !p.variant_of);
    const scored = all.map((p) => {
      const hay = `${p.title} ${p.brand} ${p.category} ${p.description} ${Object.values(p.attributes).join(' ')}`.toLowerCase();
      const score = toks.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0) + (hay.includes(String(query).toLowerCase()) ? 2 : 0);
      return { p, score };
    }).filter((x) => x.score > 0 || !toks.length);
    return scored.sort((a, b) => b.score - a.score).slice(0, lim).map((x) => x.p);
  }
  const where: string[] = ['tenant_id = $1', 'active = true', 'variant_of IS NULL'];
  const vals: any[] = [tenantId];
  const scoreParts: string[] = [];
  for (const t of toks) {
    vals.push(`%${t}%`);
    scoreParts.push(`(CASE WHEN search_text ILIKE $${vals.length} THEN 1 ELSE 0 END)`);
  }
  if (toks.length) {
    vals.push(String(query).trim());
    scoreParts.push(`(CASE WHEN to_tsvector('simple', search_text) @@ plainto_tsquery('simple', $${vals.length}) THEN 2 ELSE 0 END)`);
    vals.push(`%${String(query).trim()}%`);
    scoreParts.push(`(CASE WHEN title ILIKE $${vals.length} THEN 3 ELSE 0 END)`);
  }
  if (filters.category) { vals.push(`%${String(filters.category)}%`); where.push(`category ILIKE $${vals.length}`); }
  if (filters.min_price != null && Number.isFinite(Number(filters.min_price))) { vals.push(Number(filters.min_price)); where.push(`price >= $${vals.length}`); }
  if (filters.max_price != null && Number.isFinite(Number(filters.max_price))) { vals.push(Number(filters.max_price)); where.push(`price <= $${vals.length}`); }
  if (filters.in_stock_only) where.push('in_stock = true');
  for (const [k, v] of Object.entries(filters.attributes || {}).slice(0, 5)) {
    if (!k || !v) continue;
    vals.push(`%${String(v)}%`);
    where.push(`(attributes::text ILIKE $${vals.length} OR options::text ILIKE $${vals.length} OR search_text ILIKE $${vals.length})`);
  }
  const score = scoreParts.length ? scoreParts.join(' + ') : '0';
  const order = filters.sort === 'price_asc' ? 'price ASC' : filters.sort === 'price_desc' ? 'price DESC' : `score DESC, in_stock DESC, updated_at DESC`;
  const having = toks.length ? `AND (${score}) > 0` : '';
  vals.push(lim);
  const r = await pool.query(
    `SELECT ${COLS}, (${score}) AS score FROM commerce_products
     WHERE ${where.join(' AND ')} ${having}
     ORDER BY ${order} LIMIT $${vals.length}`,
    vals,
  );
  return (r.rows as any[]).map(mapProduct);
}

// ── Импорт из файла ─────────────────────────────────────────────────────────────────────────

const HEADER_ALIASES: Record<string, string[]> = {
  title: ['title', 'name', 'название', 'наименование', 'товар', 'product', 'product name'],
  price: ['price', 'цена', 'стоимость', 'sale price', 'regular price'],
  compare_at_price: ['compare_at_price', 'old price', 'старая цена', 'цена до скидки', 'compare at price'],
  description: ['description', 'описание', 'body', 'body (html)', 'desc'],
  sku: ['sku', 'артикул', 'код', 'variant sku', 'id товара'],
  external_id: ['external_id', 'id', 'handle', 'внешний id'],
  url: ['url', 'ссылка', 'link', 'страница', 'product url'],
  image_url: ['image', 'image_url', 'картинка', 'фото', 'изображение', 'image src', 'photo'],
  category: ['category', 'категория', 'раздел', 'type', 'product type', 'product category'],
  brand: ['brand', 'бренд', 'vendor', 'производитель', 'manufacturer'],
  stock: ['stock', 'остаток', 'наличие', 'quantity', 'qty', 'inventory', 'variant inventory qty'],
  currency: ['currency', 'валюта'],
};

function pickHeader(headers: string[], key: string): string | null {
  const aliases = HEADER_ALIASES[key] || [];
  for (const h of headers) {
    const hl = h.toLowerCase().trim();
    if (aliases.includes(hl)) return h;
  }
  return null;
}

function toNumber(v: any): number | null {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Разбирает CSV/XLSX/JSON → массив ProductInput. Лишние колонки уходят в attributes. */
export function parseImportBuffer(buffer: Buffer, filename: string): ProductInput[] {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.json')) {
    const data = JSON.parse(buffer.toString('utf-8'));
    const arr = Array.isArray(data) ? data : Array.isArray(data?.products) ? data.products : Array.isArray(data?.items) ? data.items : [];
    return arr.slice(0, 5000).map((x: any) => ({
      external_id: x.external_id || x.id || x.handle || null,
      sku: x.sku || null, title: x.title || x.name || '', brand: x.brand || x.vendor || null,
      description: x.description || x.body_html || null, price: toNumber(x.price) ?? 0,
      currency: x.currency || undefined, compare_at_price: toNumber(x.compare_at_price ?? x.old_price),
      in_stock: x.in_stock != null ? !!x.in_stock : (toNumber(x.stock) == null ? true : Number(toNumber(x.stock)) > 0),
      stock: toNumber(x.stock ?? x.quantity), image_url: x.image_url || x.image || null, url: x.url || null,
      category: x.category || x.product_type || null, attributes: x.attributes || {},
    })).filter((x: ProductInput) => x.title);
  }
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false });
  const out: ProductInput[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (!rows.length) continue;
    const headers = Object.keys(rows[0]);
    const map: Record<string, string | null> = {};
    for (const key of Object.keys(HEADER_ALIASES)) map[key] = pickHeader(headers, key);
    if (!map.title) continue;
    const used = new Set(Object.values(map).filter(Boolean) as string[]);
    for (const row of rows.slice(0, 5000)) {
      const title = String(row[map.title!] ?? '').trim();
      if (!title) continue;
      const attributes: Record<string, string> = {};
      for (const h of headers) {
        if (used.has(h)) continue;
        const v = row[h];
        if (v != null && String(v).trim()) attributes[h] = String(v).trim().slice(0, 300);
      }
      const stock = map.stock ? toNumber(row[map.stock]) : null;
      out.push({
        title,
        external_id: map.external_id ? String(row[map.external_id] || '').trim() || null : (map.sku ? String(row[map.sku] || '').trim() || null : null),
        sku: map.sku ? String(row[map.sku] || '').trim() || null : null,
        price: (map.price ? toNumber(row[map.price]) : null) ?? 0,
        compare_at_price: map.compare_at_price ? toNumber(row[map.compare_at_price]) : null,
        description: map.description ? String(row[map.description] || '').trim() || null : null,
        brand: map.brand ? String(row[map.brand] || '').trim() || null : null,
        url: map.url ? String(row[map.url] || '').trim() || null : null,
        image_url: map.image_url ? String(row[map.image_url] || '').trim() || null : null,
        category: map.category ? String(row[map.category] || '').trim() || null : null,
        currency: map.currency ? String(row[map.currency] || '').trim() || undefined : undefined,
        stock,
        in_stock: stock == null ? true : stock > 0,
        attributes,
      });
    }
  }
  return out;
}

export async function importProducts(tenantId: string, items: ProductInput[], defaultCurrency: string): Promise<{ created: number; updated: number; skipped: number }> {
  let created = 0, updated = 0, skipped = 0;
  for (const item of items) {
    try {
      const input: ProductInput = { ...item, currency: item.currency || defaultCurrency };
      if (!input.external_id) input.external_id = input.sku || input.url || null;
      const r = await upsertProductByExternalId(tenantId, input);
      if (r.created) created++; else updated++;
    } catch {
      skipped++;
    }
  }
  return { created, updated, skipped };
}

/** Сводка каталога для карточки «Анализ завершён»: полнота данных, категории, диапазон цен. */
export interface CatalogSummary {
  total: number; in_stock: number; with_image: number; with_description: number; with_price: number; variants: number; services: number;
  min_price: number | null; max_price: number | null; currency: string | null; categories: Array<{ name: string; count: number }>;
}
export async function catalogSummary(tenantId: string): Promise<CatalogSummary> {
  const empty: CatalogSummary = { total: 0, in_stock: 0, with_image: 0, with_description: 0, with_price: 0, variants: 0, services: 0, min_price: null, max_price: null, currency: null, categories: [] };
  if (isFallbackActive()) {
    const list = memProducts.get(tenantId) || [];
    return {
      ...empty, total: list.length, in_stock: list.filter((p) => p.in_stock).length, with_image: list.filter((p) => p.image_url).length,
      with_description: list.filter((p) => (p.description || '').length > 20).length, with_price: list.filter((p) => Number(p.price) > 0).length,
      variants: list.filter((p) => p.variant_of).length, services: list.filter((p) => /услуг|service/i.test(String(p.attributes?.['Тип'] || ''))).length, currency: list[0]?.currency || null,
    };
  }
  try {
    const r = await pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE in_stock)::int AS in_stock,
              count(*) FILTER (WHERE image_url IS NOT NULL AND image_url <> '')::int AS with_image,
              count(*) FILTER (WHERE description IS NOT NULL AND length(description) > 20)::int AS with_description,
              count(*) FILTER (WHERE price > 0)::int AS with_price,
              count(*) FILTER (WHERE variant_of IS NOT NULL)::int AS variants,
              count(*) FILTER (WHERE attributes->>'Тип' IN ('услуга', 'service'))::int AS services,
              (min(price) FILTER (WHERE price > 0))::float AS min_price,
              max(price)::float AS max_price,
              (SELECT currency FROM commerce_products WHERE tenant_id = $1 AND active = true GROUP BY currency ORDER BY count(*) DESC LIMIT 1) AS currency
         FROM commerce_products WHERE tenant_id = $1 AND active = true`,
      [tenantId],
    );
    const c = await pool.query(
      `SELECT category AS name, count(*)::int AS count FROM commerce_products
        WHERE tenant_id = $1 AND active = true AND category IS NOT NULL AND category <> '' GROUP BY category ORDER BY count DESC LIMIT 12`,
      [tenantId],
    );
    const row = (r.rows as any[])[0] || {};
    return { ...empty, ...row, categories: c.rows as Array<{ name: string; count: number }> };
  } catch {
    return empty;
  }
}

/** Удалить товары одного источника: 'site' — всё, что не из соцсетей; иначе метка из attributes.Источник (Telegram/Instagram/TikTok). */
export async function deleteProductsBySource(tenantId: string, source: string): Promise<number> {
  const label = source === 'site' ? null : ({ telegram: 'Telegram', instagram: 'Instagram', tiktok: 'TikTok' } as Record<string, string>)[source];
  if (source !== 'site' && !label) return 0;
  if (isFallbackActive()) {
    const list = memProducts.get(tenantId) || [];
    const keep = list.filter((p) => (label ? p.attributes?.['Источник'] !== label : !!p.attributes?.['Источник']));
    memProducts.set(tenantId, keep);
    return list.length - keep.length;
  }
  const r = label
    ? await pool.query(`DELETE FROM commerce_products WHERE tenant_id = $1 AND attributes->>'Источник' = $2`, [tenantId, label])
    : await pool.query(`DELETE FROM commerce_products WHERE tenant_id = $1 AND (attributes->>'Источник') IS NULL`, [tenantId]);
  return r.rowCount || 0;
}
