/**
 * Commerce Agents — краулер каталога с сайта клиента. Всё автоматически для владельца:
 * он вводит адрес сайта, мы собираем товары.
 *
 * Источники, по приоритету:
 *  1. Shopify `/products.json` (публичный JSON-каталог с вариантами и ценами);
 *  2. `sitemap.xml` (и sitemap-index) → страницы товаров → JSON-LD schema.org/Product
 *     (+ Open Graph как запасной вариант);
 *  3. если sitemap нет — ссылки с главной страницы (первый уровень).
 *
 * Всё через safeFetch (анти-SSRF), с лимитами страниц и параллелизмом 4. Прогресс — в памяти
 * и в commerce_settings.crawl_status (для баннера в кабинете).
 */

import { safeFetch } from '../safe_fetch.js';
import { upsertProductByExternalId } from './catalog.js';
import { fillStorefrontTexts } from './texts.js';
import { setCrawlStatus, updateSettings } from './settings.js';
import { setPhase, clearPhase, setMessage, pushTrace, errParts } from './i18n.js';
import type { MsgPart } from './i18n.js';
import type { CrawlStatus, ProductInput } from './types.js';

const running = new Map<string, CrawlStatus>();
const MAX_PAGES = 400;
const CONCURRENCY = 6;
const UA = 'Mozilla/5.0 (compatible; VibeVoxCommerceBot/1.0; +https://vibevox.pro)';
type CrawlSource = 'shopify' | 'woocommerce' | 'magento' | 'squarespace' | 'feed' | 'sitemap';
const API_SOURCES: CrawlSource[] = ['shopify', 'woocommerce', 'magento', 'squarespace'];
const PLATFORM_NAMES: Record<string, string> = {
  shopify: 'Shopify', woocommerce: 'WooCommerce', magento: 'Magento', squarespace: 'Squarespace', prestashop: 'PrestaShop', opencart: 'OpenCart',
  wix: 'Wix', bitrix: '1С-Битрикс', insales: 'InSales', tilda: 'Tilda', feed: 'товарный фид', sitemap: 'страницы с разметкой schema.org',
};

/** «1 299,00» / «1,299.00» / «12.99» → число. */
function parseNum(v: string | null | undefined): number | null {
  if (v == null) return null;
  let t = String(v).replace(/[^\d.,-]/g, '');
  if (!t) return null;
  if (t.includes(',') && t.includes('.')) t = t.replace(/,/g, '');
  else t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function getCrawlProgress(tenantId: string): CrawlStatus | null {
  return running.get(tenantId) || null;
}

function stripTags(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

function firstImage(img: any): string | null {
  if (!img) return null;
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return firstImage(img[0]);
  if (typeof img === 'object') return img.url || img.contentUrl || null;
  return null;
}

function offerOf(offers: any): { price: number | null; currency: string | null; inStock: boolean | null; url: string | null } {
  const o = Array.isArray(offers) ? offers[0] : offers;
  if (!o || typeof o !== 'object') return { price: null, currency: null, inStock: null, url: null };
  const price = o.price ?? o.lowPrice ?? o.priceSpecification?.price;
  const availability = String(o.availability || '').toLowerCase();
  return {
    price: price != null && Number.isFinite(Number(String(price).replace(',', '.'))) ? Number(String(price).replace(',', '.')) : null,
    currency: o.priceCurrency || o.priceSpecification?.priceCurrency || null,
    inStock: availability ? !/outofstock|soldout|discontinued/.test(availability) : null,
    url: typeof o.url === 'string' ? o.url : null,
  };
}

/** JSON-LD Product со страницы (учитывает @graph и массивы). */
export function extractJsonLdProducts(html: string, pageUrl: string): ProductInput[] {
  const out: ProductInput[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  const nodes: any[] = [];
  while ((m = re.exec(html)) && nodes.length < 50) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const stack: any[] = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (stack.length && nodes.length < 50) {
        const n = stack.shift();
        if (!n || typeof n !== 'object') continue;
        if (Array.isArray(n['@graph'])) stack.push(...n['@graph']);
        const t = n['@type'];
        const types = Array.isArray(t) ? t.map(String) : [String(t || '')];
        if (types.some((x) => /^(Product|ProductGroup|IndividualProduct)$/i.test(x))) nodes.push(n);
        if (Array.isArray(n.hasVariant)) stack.push(...n.hasVariant);
        if (Array.isArray(n.itemListElement)) for (const el of n.itemListElement) stack.push(el?.item || el);
      }
    } catch { /* невалидный JSON-LD — пропускаем */ }
  }
  for (const n of nodes) {
    const name = String(n.name || '').trim();
    if (!name) continue;
    const offer = offerOf(n.offers);
    const attributes: Record<string, string> = {};
    if (Array.isArray(n.additionalProperty)) {
      for (const p of n.additionalProperty.slice(0, 30)) if (p?.name && p?.value != null) attributes[String(p.name)] = String(p.value);
    }
    if (n.color) attributes['Цвет'] = String(n.color);
    if (n.material) attributes['Материал'] = String(n.material);
    if (n.size) attributes['Размер'] = String(n.size);
    out.push({
      external_id: pageUrl,
      sku: n.sku ? String(n.sku) : (n.mpn ? String(n.mpn) : null),
      title: name.slice(0, 300),
      brand: typeof n.brand === 'string' ? n.brand : (n.brand?.name ? String(n.brand.name) : null),
      description: n.description ? stripTags(String(n.description)).slice(0, 8000) : null,
      price: offer.price ?? 0,
      currency: offer.currency || undefined,
      in_stock: offer.inStock ?? true,
      image_url: firstImage(n.image),
      url: offer.url || pageUrl,
      category: n.category ? String(Array.isArray(n.category) ? n.category[0] : n.category).slice(0, 160) : null,
      attributes,
    });
  }
  return out;
}

/** Open Graph / meta как запасной источник, когда JSON-LD нет. */
function extractOgProduct(html: string, pageUrl: string): ProductInput | null {
  const meta = (prop: string): string | null => {
    const r = new RegExp(`<meta[^>]+(?:property|name)=["']${prop.replace(':', '\\:')}["'][^>]+content=["']([^"']*)["']`, 'i').exec(html)
      || new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop.replace(':', '\\:')}["']`, 'i').exec(html);
    return r ? r[1] : null;
  };
  const type = (meta('og:type') || '').toLowerCase();
  const price = meta('product:price:amount') || meta('og:price:amount');
  if (!/product/.test(type) && !price) return null;
  const title = meta('og:title') || (/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] || '');
  if (!title.trim()) return null;
  return {
    external_id: pageUrl,
    title: title.trim().slice(0, 300),
    description: (meta('og:description') || meta('description') || '').slice(0, 4000) || null,
    price: price ? Number(String(price).replace(',', '.')) || 0 : 0,
    currency: meta('product:price:currency') || meta('og:price:currency') || undefined,
    image_url: meta('og:image'),
    url: pageUrl,
    in_stock: !/out of stock|нет в наличии/i.test(meta('product:availability') || ''),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url: string, maxBytes = 2_500_000): Promise<string | null> {
  // Один повтор на сетевую ошибку/таймаут: медленные сайты иногда рвут соединение на первом запросе.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await safeFetch(url, { timeoutMs: 20_000, headers: { 'User-Agent': UA, Accept: 'text/html,application/xml,application/json;q=0.9,*/*;q=0.5' } });
      if (!r.ok) return null;
      const ct = r.headers.get('content-type') || '';
      if (/image|video|audio|octet-stream|pdf/i.test(ct)) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      return buf.subarray(0, maxBytes).toString('utf-8');
    } catch {
      if (attempt) return null;
      await sleep(800);
    }
  }
  return null;
}

async function tryShopify(origin: string, status?: CrawlStatus): Promise<ProductInput[] | null> {
  const out: ProductInput[] = [];
  for (let page = 1; page <= 20; page++) {
    if (status) { setPhase(status, 'srv.crawl.phase.api', { platform: 'Shopify', page, n: out.length }); status.pages_seen = page - 1; status.products_found = out.length; }
    const txt = await fetchText(`${origin}/products.json?limit=250&page=${page}`);
    if (!txt) break;
    let data: any;
    try { data = JSON.parse(txt); } catch { break; }
    const products: any[] = Array.isArray(data?.products) ? data.products : [];
    if (!products.length) break;
    for (const p of products) {
      const variants: any[] = Array.isArray(p.variants) ? p.variants : [];
      const first = variants[0] || {};
      const optionNames: string[] = Array.isArray(p.options) ? p.options.map((o: any) => (typeof o === 'string' ? o : o?.name)).filter(Boolean) : [];
      const options: Record<string, string[]> = {};
      if (variants.length > 1) {
        for (const [i, name] of optionNames.entries()) {
          const vals = Array.from(new Set(variants.map((v) => v[`option${i + 1}`]).filter(Boolean).map(String)));
          if (vals.length > 1) options[name] = vals;
        }
      }
      const inStockAny = variants.some((v) => v.available !== false);
      const prices = variants.map((v) => Number(v.price)).filter((n) => Number.isFinite(n));
      const familyId = `shopify:${p.id}`;
      out.push({
        external_id: familyId,
        sku: first.sku || null,
        title: String(p.title || '').slice(0, 300),
        brand: p.vendor || null,
        description: p.body_html ? stripTags(String(p.body_html)).slice(0, 8000) : null,
        price: prices.length ? Math.min(...prices) : 0,
        compare_at_price: first.compare_at_price ? Number(first.compare_at_price) : null,
        in_stock: inStockAny,
        image_url: p.images?.[0]?.src || p.image?.src || null,
        url: p.handle ? `${origin}/products/${p.handle}` : null,
        category: p.product_type || null,
        attributes: Array.isArray(p.tags) ? { 'Теги': p.tags.slice(0, 20).join(', ') } : {},
        options,
      });
      if (Object.keys(options).length) {
        for (const v of variants.slice(0, 60)) {
          const option_values: Record<string, string> = {};
          for (const [i, name] of optionNames.entries()) if (v[`option${i + 1}`]) option_values[name] = String(v[`option${i + 1}`]);
          out.push({
            external_id: `shopify:${p.id}:${v.id}`,
            sku: v.sku || null,
            title: `${p.title} — ${v.title || Object.values(option_values).join(' / ')}`.slice(0, 300),
            brand: p.vendor || null,
            price: Number(v.price) || 0,
            compare_at_price: v.compare_at_price ? Number(v.compare_at_price) : null,
            in_stock: v.available !== false,
            image_url: v.featured_image?.src || p.images?.[0]?.src || null,
            url: p.handle ? `${origin}/products/${p.handle}?variant=${v.id}` : null,
            category: p.product_type || null,
            option_values,
            variant_of: familyId, // временно external_id семьи; привяжем к uuid после upsert
          });
        }
      }
    }
    if (products.length < 250) break;
  }
  return out.length ? out : null;
}

/** Платформа по HTML главной (подсказка из настроек — приоритетнее). */
function detectPlatform(html: string | null, hint?: string | null): string {
  if (hint && hint !== 'other') return hint;
  if (!html) return 'other';
  const h = html.slice(0, 400_000);
  if (/cdn\.shopify\.com|Shopify\.theme|shopify-section/i.test(h)) return 'shopify';
  if (/woocommerce|wc-ajax|wp-content\/plugins\/woocommerce/i.test(h)) return 'woocommerce';
  if (/Magento_|data-mage-init|\/static\/version\d+\//i.test(h)) return 'magento';
  if (/prestashop|\/modules\/ps_|var prestashop/i.test(h)) return 'prestashop';
  if (/route=product|catalog\/view\/theme|index\.php\?route=/i.test(h)) return 'opencart';
  if (/squarespace/i.test(h)) return 'squarespace';
  if (/wix\.com|wixstatic|_wixCIDX/i.test(h)) return 'wix';
  if (/\/bitrix\/|bx-core|BX\.ready/i.test(h)) return 'bitrix';
  if (/insales/i.test(h)) return 'insales';
  if (/tilda(cdn|\.ws|copy)/i.test(h)) return 'tilda';
  if (/wp-content|wp-json/i.test(h)) return 'woocommerce'; // WordPress: наличие WooCommerce проверит Store API
  return 'other';
}

/**
 * WooCommerce Store API — публичный JSON-каталог (без ключей): /wp-json/wc/store/v1/products.
 * До 100 товаров за запрос, цены в минимальных единицах валюты, наличие, картинки, категории, атрибуты.
 * У вариативных товаров записываем варианты как options (выбор на сайте магазина).
 */
async function tryWooStore(origin: string, status?: CrawlStatus): Promise<ProductInput[] | null> {
  const out: ProductInput[] = [];
  for (let page = 1; page <= 40; page++) {
    if (status) { setPhase(status, 'srv.crawl.phase.api', { platform: 'WooCommerce (Store API)', page, n: out.length }); status.pages_seen = page - 1; status.products_found = out.length; }
    const txt = await fetchText(`${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`);
    if (!txt) break;
    let data: any;
    try { data = JSON.parse(txt); } catch { break; }
    if (!Array.isArray(data) || !data.length) break;
    for (const p of data) {
      if (!p || typeof p !== 'object' || !p.name) continue;
      const minor = Number(p?.prices?.currency_minor_unit ?? 2);
      const toNum = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v) / Math.pow(10, minor));
      const price = toNum(p?.prices?.price) ?? 0;
      const regular = toNum(p?.prices?.regular_price);
      const options: Record<string, string[]> = {};
      const attributes: Record<string, string> = {};
      if (Array.isArray(p.attributes)) {
        for (const a of p.attributes.slice(0, 30)) {
          const terms: string[] = Array.isArray(a?.terms) ? a.terms.map((t: any) => String(t?.name || '')).filter(Boolean) : [];
          if (!a?.name || !terms.length) continue;
          if (p.type === 'variable' && a.has_variations && terms.length > 1) options[String(a.name)] = terms.slice(0, 50);
          else attributes[String(a.name)] = terms.join(', ');
        }
      }
      out.push({
        external_id: `woo:${p.id}`,
        sku: p.sku ? String(p.sku) : null,
        title: stripTags(String(p.name)).slice(0, 300),
        brand: null,
        description: stripTags(String(p.description || p.short_description || '')).slice(0, 8000) || null,
        price,
        currency: p?.prices?.currency_code ? String(p.prices.currency_code) : undefined,
        compare_at_price: regular != null && regular > price ? regular : null,
        in_stock: p.is_in_stock !== false,
        image_url: p.images?.[0]?.src || null,
        url: p.permalink || null,
        category: Array.isArray(p.categories) && p.categories[0]?.name ? String(p.categories[0].name).slice(0, 160) : null,
        attributes,
        options,
      });
    }
    if (status) { status.products_found = out.length; status.pages_seen = page; }
    if (data.length < 100) break;
  }
  return out.length ? out : null;
}

/** Magento 2 / Adobe Commerce: публичный GraphQL (/graphql) — каталог без ключей. */
async function tryMagento(origin: string, status?: CrawlStatus): Promise<ProductInput[] | null> {
  const out: ProductInput[] = [];
  for (let page = 1; page <= 30; page++) {
    if (status) { setPhase(status, 'srv.crawl.phase.api', { platform: 'Magento (GraphQL)', page, n: out.length }); status.pages_seen = page - 1; status.products_found = out.length; }
    const query = `{ products(filter: { price: { from: "0" } }, pageSize: 100, currentPage: ${page}) { total_count items { sku name url_key url_suffix stock_status image { url } description { html } categories { name } price_range { minimum_price { regular_price { value currency } final_price { value currency } } } ... on ConfigurableProduct { configurable_options { label values { label } } } } } }`;
    let data: any;
    try {
      const r = await safeFetch(`${origin}/graphql`, { method: 'POST', timeoutMs: 20_000, headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA }, body: JSON.stringify({ query }) });
      if (!r.ok) break;
      data = await r.json();
    } catch { break; }
    const items: any[] = data?.data?.products?.items;
    if (!Array.isArray(items) || !items.length) break;
    for (const p of items) {
      if (!p?.name) continue;
      const fin = p.price_range?.minimum_price?.final_price;
      const reg = p.price_range?.minimum_price?.regular_price;
      const price = Number(fin?.value ?? reg?.value ?? 0) || 0;
      const regular = Number(reg?.value) || null;
      const options: Record<string, string[]> = {};
      for (const o of p.configurable_options || []) if (o?.label && Array.isArray(o.values) && o.values.length > 1) options[String(o.label)] = o.values.map((v: any) => String(v?.label || '')).filter(Boolean).slice(0, 50);
      out.push({
        external_id: `magento:${p.sku || p.url_key}`, sku: p.sku || null, title: stripTags(String(p.name)).slice(0, 300), brand: null,
        description: p.description?.html ? stripTags(String(p.description.html)).slice(0, 8000) : null,
        price, currency: fin?.currency || reg?.currency || undefined, compare_at_price: regular != null && regular > price ? regular : null,
        in_stock: p.stock_status !== 'OUT_OF_STOCK', image_url: p.image?.url || null,
        url: p.url_key ? `${origin}/${p.url_key}${p.url_suffix ?? '.html'}` : null,
        category: p.categories?.[0]?.name ? String(p.categories[0].name).slice(0, 160) : null, attributes: {}, options,
      });
    }
    if (status) { status.products_found = out.length; status.pages_seen = page; }
    const total = Number(data?.data?.products?.total_count) || 0;
    if (items.length < 100 || (total && out.length >= total)) break;
  }
  return out.length ? out : null;
}

/** Squarespace Commerce: любая страница магазина отдаёт JSON по ?format=json (товары с вариантами и ценами). */
async function trySquarespace(origin: string, home: string | null, status?: CrawlStatus): Promise<ProductInput[] | null> {
  const candidates = new Set<string>(['/shop', '/store', '/products', '/sklep']);
  if (home) {
    for (const m of home.matchAll(/href=["']([^"'#?]+)["']/gi)) {
      try { const u = new URL(m[1], origin); if (u.origin === origin && /^\/(shop|store|products?|sklep|catalog)\b/i.test(u.pathname) && u.pathname.split('/').filter(Boolean).length === 1) candidates.add(u.pathname); } catch { /* skip */ }
    }
  }
  const out: ProductInput[] = [];
  const seen = new Set<string>();
  const priceOf = (v: any): number => (v?.priceMoney?.value != null ? Number(v.priceMoney.value) : Number(v?.price) / 100);
  for (const path of Array.from(candidates).slice(0, 6)) {
    let next: string | null = `${path}?format=json`;
    for (let page = 1; next && page <= 30; page++) {
      if (status) { setPhase(status, 'srv.crawl.phase.api', { platform: `Squarespace ${path}`, page, n: out.length }); status.products_found = out.length; }
      const txt = await fetchText(new URL(next, origin).toString());
      if (!txt) break;
      let data: any;
      try { data = JSON.parse(txt); } catch { break; }
      const items: any[] = Array.isArray(data?.items) ? data.items : [];
      const products = items.filter((it) => Array.isArray(it?.variants) && it.variants.length);
      if (!products.length) break;
      const cur = data?.websiteSettings?.storeSettings?.selectedCurrency || data?.website?.storeSettings?.selectedCurrency || null;
      for (const p of products) {
        const id = String(p.id || p.fullUrl);
        if (seen.has(id)) continue;
        seen.add(id);
        const vs: any[] = p.variants;
        const prices = vs.map((v) => (v?.onSale && v?.salePriceMoney?.value != null ? Number(v.salePriceMoney.value) : v?.onSale && v?.salePrice != null ? Number(v.salePrice) / 100 : priceOf(v))).filter((n) => Number.isFinite(n));
        const price = prices.length ? Math.min(...prices) : 0;
        const regular = vs.length ? priceOf(vs[0]) : null;
        const options: Record<string, string[]> = {};
        if (vs.length > 1) for (const v of vs) for (const [k, val] of Object.entries(v?.attributes || {})) { options[k] ||= []; if (!options[k].includes(String(val))) options[k].push(String(val)); }
        for (const k of Object.keys(options)) if (options[k].length < 2) delete options[k];
        out.push({
          external_id: `squarespace:${id}`, sku: vs[0]?.sku || null, title: stripTags(String(p.title || '')).slice(0, 300), brand: null,
          description: stripTags(String(p.excerpt || p.body || '')).slice(0, 8000) || null, price,
          currency: vs[0]?.priceMoney?.currency || cur || undefined, compare_at_price: regular != null && Number.isFinite(regular) && regular > price ? regular : null,
          in_stock: vs.some((v) => v?.unlimited || Number(v?.qtyInStock) > 0), image_url: p.assetUrl || null,
          url: p.fullUrl ? new URL(p.fullUrl, origin).toString() : null,
          category: Array.isArray(p.categories) && p.categories[0] ? String(p.categories[0]).slice(0, 160) : null, attributes: {}, options,
        });
      }
      const np = data?.pagination?.nextPage && data?.pagination?.nextPageUrl ? String(data.pagination.nextPageUrl) : null;
      next = np ? (np.includes('format=json') ? np : np + (np.includes('?') ? '&format=json' : '?format=json')) : null;
    }
    if (out.length) break;
  }
  return out.length ? out : null;
}

// ── Товарные фиды: Google Merchant (RSS/Atom с g:-полями) и YML (Яндекс.Маркет, распространён в СНГ) ──
function xmlUnescape(v: string): string {
  return v.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}
function xmlTag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i').exec(block);
  if (!m) return null;
  let v = m[1].trim();
  const cd = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(v);
  if (cd) v = cd[1].trim();
  return xmlUnescape(v);
}
function parseMoney(v: string | null): { price: number | null; currency: string | null } {
  if (!v) return { price: null, currency: null };
  const m = /^\s*([\d\s.,]+)\s*([A-Za-z]{3})?\s*$/.exec(v);
  if (!m) return { price: parseNum(v), currency: null };
  return { price: parseNum(m[1]), currency: m[2] ? m[2].toUpperCase() : null };
}
export function looksLikeFeed(txt: string): boolean {
  return /<yml_catalog|<rss[\s>]|<feed[\s>]/i.test(txt.slice(0, 4000)) && /<offer\b|<item\b|<entry\b/i.test(txt);
}
export function parseFeed(xml: string): ProductInput[] | null {
  const out: ProductInput[] = [];
  if (/<yml_catalog/i.test(xml)) {
    const cats = new Map<string, string>();
    for (const m of xml.matchAll(/<category\s+[^>]*\bid="([^"]+)"[^>]*>([^<]*)<\/category>/gi)) cats.set(m[1], xmlUnescape(m[2]).trim());
    const defCur = /<currency\s+[^>]*\bid="([A-Za-z]{3})"/i.exec(xml)?.[1]?.toUpperCase() || null;
    for (const m of xml.matchAll(/<offer\b([^>]*)>([\s\S]*?)<\/offer>/gi)) {
      const attrs = m[1];
      const b = m[2];
      const id = /\bid="([^"]+)"/.exec(attrs)?.[1] || null;
      const name = xmlTag(b, 'name') || [xmlTag(b, 'vendor'), xmlTag(b, 'model')].filter(Boolean).join(' ');
      if (!name) continue;
      const attributes: Record<string, string> = {};
      for (const p of b.matchAll(/<param\s+[^>]*name="([^"]+)"[^>]*>([^<]*)<\/param>/gi)) attributes[xmlUnescape(p[1])] = xmlUnescape(p[2]).trim();
      const catId = xmlTag(b, 'categoryId');
      const price = parseNum(xmlTag(b, 'price')) ?? 0;
      const old = parseNum(xmlTag(b, 'oldprice'));
      out.push({
        external_id: `yml:${id || name}`, sku: xmlTag(b, 'vendorCode'), title: stripTags(name).slice(0, 300), brand: xmlTag(b, 'vendor'),
        description: stripTags(xmlTag(b, 'description') || '').slice(0, 8000) || null, price,
        currency: xmlTag(b, 'currencyId') || defCur || undefined, compare_at_price: old != null && old > price ? old : null,
        in_stock: !/available="false"/i.test(attrs), image_url: xmlTag(b, 'picture'), url: xmlTag(b, 'url'),
        category: catId ? cats.get(catId) || null : null, attributes,
      });
      if (out.length >= 5000) break;
    }
  } else {
    for (const m of xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const b = m[2];
      const g = (n: string) => xmlTag(b, `g:${n}`) ?? xmlTag(b, n);
      const title = g('title');
      if (!title) continue;
      const base = parseMoney(g('price'));
      const sale = parseMoney(g('sale_price'));
      const avail = (g('availability') || '').toLowerCase();
      const attributes: Record<string, string> = {};
      for (const k of ['color', 'size', 'material', 'gender', 'age_group', 'pattern', 'gtin', 'mpn']) { const v = g(k); if (v) attributes[k] = v; }
      const onSale = sale.price != null && base.price != null && sale.price < base.price;
      out.push({
        external_id: `feed:${g('id') || title}`, sku: g('mpn') || g('gtin'), title: stripTags(title).slice(0, 300), brand: g('brand'),
        description: stripTags(g('description') || '').slice(0, 8000) || null, price: onSale ? sale.price! : (base.price ?? 0),
        currency: sale.currency || base.currency || undefined, compare_at_price: onSale ? base.price : null,
        in_stock: avail ? /in[ _]stock|preorder|backorder/.test(avail) : true, image_url: g('image_link'), url: g('link'),
        category: (g('product_type') || g('google_product_category') || '').split('>').pop()?.trim().slice(0, 160) || null, attributes,
      });
      if (out.length >= 5000) break;
    }
  }
  return out.length ? out : null;
}

/** Микроданные schema.org (itemprop) — PrestaShop, OpenCart, Bitrix, старые темы; когда JSON-LD нет. */
function extractMicrodataProduct(html: string, pageUrl: string): ProductInput | null {
  const scope = /itemtype=["'][^"']*schema\.org\/Product["']/i.exec(html);
  if (!scope) return null;
  const h = html.slice(scope.index, scope.index + 300_000);
  const prop = (name: string): string | null => {
    const a = new RegExp(`<[^>]+\\bitemprop=["']${name}["'][^>]*\\b(?:content|href|src)=["']([^"']*)["']`, 'i').exec(h)
      || new RegExp(`<[^>]+\\b(?:content|href|src)=["']([^"']*)["'][^>]*\\bitemprop=["']${name}["']`, 'i').exec(h);
    if (a) return a[1];
    const t = new RegExp(`<([a-z0-9]+)\\b[^>]*\\bitemprop=["']${name}["'][^>]*>([\\s\\S]{0,4000}?)<\\/\\1>`, 'i').exec(h);
    return t ? stripTags(t[2]) : null;
  };
  const name = prop('name');
  if (!name) return null;
  const avail = (prop('availability') || '').toLowerCase();
  const image = prop('image');
  return {
    external_id: pageUrl, sku: prop('sku') || prop('mpn'), title: name.slice(0, 300), brand: prop('brand'),
    description: (prop('description') || '').slice(0, 8000) || null, price: parseNum(prop('price')) ?? 0,
    currency: prop('priceCurrency') || undefined, in_stock: avail ? !/outofstock|soldout|discontinued/.test(avail) : true,
    image_url: image ? (() => { try { return new URL(image, pageUrl).toString(); } catch { return image; } })() : null,
    url: pageUrl, category: prop('category'), attributes: {},
  };
}

/** Sitemap-ссылки из robots.txt (там же, где их публикует любая CMS). */
async function sitemapsFromRobots(origin: string): Promise<string[]> {
  const txt = await fetchText(`${origin}/robots.txt`, 200_000);
  if (!txt) return [];
  const out: string[] = [];
  for (const m of txt.matchAll(/^\s*sitemap:\s*(\S+)/gim)) { try { const u = new URL(m[1].trim(), origin); if (/^https?:$/.test(u.protocol)) out.push(u.toString()); } catch { /* skip */ } }
  return Array.from(new Set(out)).slice(0, 5);
}

/** Нет sitemap: ссылки с главной + второй уровень (разделы/категории) → ссылки на товары. */
async function discoverByLinks(origin: string, home: string, status: CrawlStatus): Promise<Set<string>> {
  const links = (html: string): string[] => {
    const out: string[] = [];
    for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
      try { const u = new URL(m[1], origin); if (u.origin === origin && !/\.(jpg|jpeg|png|gif|webp|svg|pdf|css|js|zip|xml|ico)$/i.test(u.pathname)) out.push(u.toString()); } catch { /* skip */ }
    }
    return Array.from(new Set(out));
  };
  const level1 = links(home);
  const acc = new Set<string>(level1);
  const sections = level1.filter((u) => !looksLikeProductUrl(u)).slice(0, 40);
  status.pages_total = sections.length;
  status.pages_seen = 0;
  await mapLimit(sections, CONCURRENCY, async (u) => {
    const html = await fetchText(u);
    status.pages_seen = (status.pages_seen || 0) + 1;
    if (!html) return;
    for (const l of links(html)) { if (acc.size >= MAX_PAGES * 3) break; acc.add(l); }
  });
  return acc;
}

/** Название магазина с главной: og:site_name → JSON-LD Organization/WebSite/Store → <title> (самый короткий осмысленный фрагмент). */
const GENERIC_TITLE = /^(главная|главная страница|home|homepage|start|strona główna|shop|магазин|sklep|интернет-магазин|online store|welcome)$/i;
export function detectSiteName(html: string | null): string | null {
  if (!html) return null;
  const h = html.slice(0, 400_000);
  const meta = (re: RegExp) => { const m = re.exec(h); return m ? xmlUnescape(m[1]).trim() : null; };
  const og = meta(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i) || meta(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
  if (og) return og.slice(0, 120);
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(h))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const stack: any[] = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (stack.length) {
        const n = stack.shift();
        if (!n || typeof n !== 'object') continue;
        if (Array.isArray(n['@graph'])) stack.push(...n['@graph']);
        const types = Array.isArray(n['@type']) ? n['@type'].map(String) : [String(n['@type'] || '')];
        if (types.some((t) => /^(Organization|WebSite|Store|OnlineStore|LocalBusiness|Corporation)$/i.test(t)) && typeof n.name === 'string' && n.name.trim()) return n.name.trim().slice(0, 120);
      }
    } catch { /* невалидный JSON-LD */ }
  }
  const app = meta(/<meta[^>]+name=["']application-name["'][^>]+content=["']([^"']+)["']/i);
  if (app) return app.slice(0, 120);
  const title = meta(/<title[^>]*>([^<]{1,200})<\/title>/i);
  if (!title) return null;
  const parts = title.split(/\s+[|–—-]\s+|\s+[·•»«]\s+/).map((p) => p.trim()).filter((p) => p && !GENERIC_TITLE.test(p));
  if (!parts.length) return null;
  parts.sort((a, b) => a.length - b.length);
  return parts[0].slice(0, 120);
}

async function collectSitemapUrls(origin: string, seed: string, depth = 0, acc: Set<string> = new Set()): Promise<Set<string>> {
  if (depth > 2 || acc.size >= MAX_PAGES * 3) return acc;
  const xml = await fetchText(seed, 5_000_000);
  if (!xml) return acc;
  const locs = Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)).map((m) => m[1].trim());
  const isIndex = /<sitemapindex/i.test(xml);
  if (isIndex) {
    // Сначала карты с товарами; посты/страницы/теги/авторов пропускаем — это экономит минуты на медленных сайтах.
    const productMaps = locs.filter((l) => /product|tovar|goods|catalog|item/i.test(l));
    const skip = /post-sitemap|page-sitemap|category|tag-sitemap|author|attachment|news|blog|local/i;
    const pick = (productMaps.length ? productMaps : locs.filter((l) => !skip.test(l))).slice(0, 20);
    for (const l of pick) await collectSitemapUrls(origin, l, depth + 1, acc);
  } else {
    for (const l of locs) {
      if (acc.size >= MAX_PAGES * 3) break;
      try { if (new URL(l).origin === origin) acc.add(l); } catch { /* skip */ }
    }
  }
  return acc;
}

function looksLikeProductUrl(u: string): boolean {
  return /\/(product|products|item|items|catalog|goods|tovar|shop|p|store|tproduct|produkt|produkty|sklep|artikel|produit|producto)\//i.test(u)
    || /\/(product|tovar|produkt)[-_]/i.test(u) || /route=product\/product/i.test(u) || /\/p\/[^/]+/i.test(u) || /\/[a-z0-9-]+-\d+\.html$/i.test(u);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  }));
  return out;
}

/** Запуск обхода (в фоне). Возвращает сразу; прогресс — getCrawlProgress / crawl_status. */
export function startCrawl(tenantId: string, siteUrl: string, opts: { currency: string; platform?: string | null; brandName?: string | null }): { ok: boolean; error?: string } {
  let defaultCurrency = opts.currency;
  if (running.has(tenantId) && running.get(tenantId)!.state === 'running') return { ok: false, error: 'already_running' };
  let origin: string;
  try { const u = new URL(siteUrl); if (!/^https?:$/.test(u.protocol)) throw new Error('scheme'); origin = u.origin; } catch { return { ok: false, error: 'invalid_url' }; }
  const status: CrawlStatus = { state: 'running', url: siteUrl, started_at: new Date().toISOString(), pages_seen: 0, products_found: 0 };
  running.set(tenantId, status);
  void setCrawlStatus(tenantId, status);
  void (async () => {
    try {
      let found: ProductInput[] = [];
      let source: CrawlSource = 'sitemap';
      setPhase(status, 'srv.crawl.phase.open');
      const trace: string[] = [];
      status.trace = trace;
      const home = await fetchText(siteUrl);
      if (home) pushTrace(status, 'srv.crawl.trace.home', { kb: Math.round(home.length / 1024) }); else pushTrace(status, 'srv.crawl.trace.homeFailed');
      // Вместо сайта можно дать ссылку на товарный фид (Google Merchant XML / YML) — читаем его напрямую.
      if (home && looksLikeFeed(home)) {
        setPhase(status, 'srv.crawl.phase.feed');
        const feed = parseFeed(home);
        if (feed?.length) { found = feed; source = 'feed'; }
      }
      const platform = detectPlatform(home, opts.platform);
      status.platform = platform;
      pushTrace(status, opts.platform && opts.platform !== 'other' ? 'srv.crawl.trace.platformSettings' : 'srv.crawl.trace.platformDetected', { platform });
      // Платформенные каталоги: один запрос на 100 товаров. Для неизвестной платформы пробуем все по очереди.
      const apiOrder: CrawlSource[] = API_SOURCES.includes(platform as CrawlSource) ? [platform as CrawlSource]
        : ['prestashop', 'opencart', 'wix', 'bitrix', 'insales', 'tilda'].includes(platform) ? [] : API_SOURCES;
      for (const api of apiOrder) {
        if (found.length) break;
        const got = api === 'shopify' ? await tryShopify(origin, status)
          : api === 'woocommerce' ? await tryWooStore(origin, status)
          : api === 'magento' ? await tryMagento(origin, status)
          : await trySquarespace(origin, home, status);
        if (got?.length) pushTrace(status, 'srv.crawl.trace.apiCount', { api, n: got.length }); else pushTrace(status, 'srv.crawl.trace.apiEmpty', { api });
        if (got?.length) { found = got; source = api; }
      }
      if (!found.length) {
        setPhase(status, 'srv.crawl.phase.sitemap');
        status.pages_seen = 0;
        let urls = new Set<string>();
        for (const sm of await sitemapsFromRobots(origin)) { urls = await collectSitemapUrls(origin, sm, 0, urls); if (urls.size >= MAX_PAGES * 3) break; }
        if (!urls.size) urls = await collectSitemapUrls(origin, `${origin}/sitemap.xml`);
        if (!urls.size) urls = await collectSitemapUrls(origin, `${origin}/sitemap_index.xml`);
        if (!urls.size && home) {
          setPhase(status, 'srv.crawl.phase.links');
          urls = await discoverByLinks(origin, home, status);
        }
        let list = Array.from(urls);
        const productLike = list.filter(looksLikeProductUrl);
        if (productLike.length >= 5) list = productLike;
        list = list.slice(0, MAX_PAGES);
        pushTrace(status, 'srv.crawl.trace.sitemap', { urls: urls.size, productLike: productLike.length, list: list.length });
        status.pages_total = list.length;
        status.pages_seen = 0;
        setPhase(status, 'srv.crawl.phase.pages', { n: CONCURRENCY });
        await mapLimit(list, CONCURRENCY, async (u) => {
          const html = await fetchText(u);
          status.pages_seen = (status.pages_seen || 0) + 1;
          if (!html) return;
          let items = extractJsonLdProducts(html, u);
          if (!items.length) { const md = extractMicrodataProduct(html, u); if (md) items = [md]; }
          if (!items.length) { const og = extractOgProduct(html, u); if (og) items = [og]; }
          for (const it of items) found.push(it);
          status.products_found = found.length;
        });
        pushTrace(status, 'srv.crawl.trace.pages', { seen: status.pages_seen || 0, found: found.length });
      }
      // Валюта — по большинству найденных товаров; платформа — если каталог пришёл из Shopify/WooCommerce,
      // а в настройках стояло «другая». Владельцу ничего выбирать не нужно.
      const currencyCount = new Map<string, number>();
      for (const it of found) if (it.currency) { const c = String(it.currency).toUpperCase(); currencyCount.set(c, (currencyCount.get(c) || 0) + 1); }
      const dominant = Array.from(currencyCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
      const settingsPatch: Record<string, unknown> = {};
      if (dominant && /^[A-Z]{3}$/.test(dominant) && dominant !== defaultCurrency) { settingsPatch.currency = dominant; defaultCurrency = dominant; }
      if (API_SOURCES.includes(source) && (!opts.platform || opts.platform === 'other')) settingsPatch.platform = source;
      // Название магазина — с сайта, пока владелец не задал своё (потом его можно менять в «Виджете»).
      const siteName = detectSiteName(home);
      if (siteName && !(opts.brandName || '').trim()) settingsPatch.brand_name = siteName;
      if (Object.keys(settingsPatch).length) await updateSettings(tenantId, settingsPatch as any).catch(() => {});
      status.currency = defaultCurrency;
      // Приветствие и тексты превью — автоматически, только пустые поля (владелец правит в «Виджете»).
      if (found.length) void fillStorefrontTexts(tenantId, { brand: String(settingsPatch.brand_name || opts.brandName || siteName || ''), categories: Array.from(new Set(found.map((f) => f.category).filter(Boolean) as string[])).slice(0, 8), sampleTitles: found.slice(0, 8).map((f) => f.title), kind: 'products', source });
      if (API_SOURCES.includes(source)) status.platform = source;
      setPhase(status, 'srv.crawl.phase.save', { n: found.length });
      // Upsert: сначала семейства, потом варианты (variant_of → uuid семьи).
      const familyUuid = new Map<string, string>();
      let saved = 0;
      let failed = 0;
      let lastError = '';
      for (const it of found.filter((x) => !x.variant_of)) {
        try {
          const r = await upsertProductByExternalId(tenantId, { ...it, currency: it.currency || defaultCurrency });
          if (it.external_id) familyUuid.set(it.external_id, r.product.id);
          saved++;
        } catch (e) { failed++; lastError = (e as Error).message; if (failed <= 3) console.warn('[commerce/crawler] upsert failed:', lastError); }
      }
      for (const it of found.filter((x) => x.variant_of)) {
        const fam = familyUuid.get(String(it.variant_of));
        if (!fam) continue;
        try { await upsertProductByExternalId(tenantId, { ...it, variant_of: fam, currency: it.currency || defaultCurrency }); saved++; } catch (e) { failed++; lastError = (e as Error).message; }
      }
      status.state = found.length && !saved ? 'error' : 'done';
      status.products_found = saved;
      status.finished_at = new Date().toISOString();
      const viaPart: MsgPart = source === 'feed' ? ['srv.crawl.via.feed']
        : source === 'sitemap' ? (PLATFORM_NAMES[platform] && platform !== 'other' ? ['srv.crawl.via.platformPages', { platform: PLATFORM_NAMES[platform] }] : ['srv.crawl.via.pages'])
        : ['srv.crawl.via.api', { platform: PLATFORM_NAMES[source] || source }];
      const parts: MsgPart[] = saved
        ? [['srv.crawl.msg.saved', { n: saved }], viaPart,
           ...(settingsPatch.currency ? [['srv.crawl.msg.currency', { cur: String(settingsPatch.currency) }] as MsgPart] : []),
           ...(settingsPatch.brand_name ? [['srv.crawl.msg.brand', { name: String(settingsPatch.brand_name) }] as MsgPart] : [])]
        : found.length
          ? [['srv.crawl.msg.saveFailed', { n: found.length, err: lastError || '—' }], viaPart]
          : [['srv.crawl.msg.notFound']];
      setMessage(status, parts);
      clearPhase(status);
    } catch (err) {
      status.state = 'error';
      status.finished_at = new Date().toISOString();
      setMessage(status, errParts(err));
    }
    await setCrawlStatus(tenantId, status);
    setTimeout(() => { if (running.get(tenantId) === status) running.delete(tenantId); }, 10 * 60_000).unref?.();
  })();
  return { ok: true };
}
