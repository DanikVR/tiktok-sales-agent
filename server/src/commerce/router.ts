/**
 * Commerce Agents — HTTP-слой.
 *
 * Кабинет (JWT + тариф commerce/enterprise/superadmin):  /api/commerce/*
 * Публичные ручки виджета (по slug, без авторизации):     /api/commerce/w/:slug/*
 * Хостед-страница для пересылки (OG-превью):              GET /c/:slug  (монтируется в server.ts)
 *
 * Чат агентов — Server-Sent Events: text (дельты), progress, component (карточки, сравнение,
 * чекаут, форма контакта, чипы), cart, meta, done, error.
 */

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import { ADMIN_TOKEN, TENANT_ID } from '../config.js';
import { getSettings, getSettingsBySlug, getSocialAccounts, getSocialStatus, setCrawlStatus, setSocialAccounts, setSocialStatus, setTenantAnthropicKey, setTenantGeminiKey, toPublicConfig, updateSettings, rememberOwnerLang } from './settings.js';
import { catalogSummary, countProducts, createProduct, deleteAllProducts, deleteProduct, deleteProductsBySource, getProduct, importProducts, listProducts, parseImportBuffer, updateProduct } from './catalog.js';
import { startCrawl, getCrawlProgress } from './crawler.js';
import { defaultStarters } from './starters.js';
import { buildAutoCover } from './cover.js';
import { widgetStrings, tw, normalizeLang, reqLang, localizeStatus, errText, ownerLangOf } from './i18n.js';
import { buildManifest, buildIcon, invalidateIcons, shortAppName, SERVICE_WORKER_JS } from './pwa.js';
import { getVapid, saveSubscription, removeSubscription, countSubs, createPushJob, listPushJobs, cancelPushJob, pushesLast24h, startPushScheduler, PUSH_DAILY_LIMIT } from './push.js';
import { getGeminiApiKey } from '../config.js';
import { countPosts, deletePostsBySource } from './posts.js';
import { getNotifyState, setNotifyToken, refreshNotifySubscribers, removeNotifySubscriber, sendNotifyTest, notifyOwnerTelegram, getPlatformBot, ensurePlatformWebhook, createLinkCode, handlePlatformUpdate, platformWebhookSecret } from './notify.js';
import { getCommerceTelegramBotToken } from '../config.js';
import { startSocialAnalysis, getSocialProgress, tiktokHandle, tgHandle, POST_LIMITS, type SocialSource } from './social.js';
import { connectIg, igChallenge, igStatus, logoutIg } from '../igp_client.js';
import { igpConfigured, upsertIgPrivateSession } from '../igp_config.js';
import { runShoppingTurn } from './shopping.js';
import { runMerchantTurn, applyChange } from './merchant.js';
import { getConversation, listConversations, listDisplayMessages, listLeads, updateLeadStatus, createLead, logEvent, findRecentConversationByVisitor, getSnapshot, getSeries, listChanges, setChangeStatus, getChange } from './store.js';
import { DEFAULT_MERCHANT_MODEL, DEFAULT_SHOPPING_MODEL, makeAnthropicClient, resolveAnthropicKey, resolveGeminiKey, shoppingModel } from './anthropic.js';
import { sendOwnerNotification } from '../owner_telegram.js';
import type { AgentEvent, LeadStatus } from './types.js';

const router = Router();
startPushScheduler();

/** Текст ошибки на языке запроса (X-Lang кабинета / ?lang / Accept-Language). */
const E = (req: Request, key: string, params?: Record<string, string | number>) => ({ error: tw(reqLang(req), key, params) });

// ── auth / gate ─────────────────────────────────────────────────────────────

type UserRole = 'owner';
interface AuthedRequest extends Request { tenantId?: string; userRole?: UserRole; userId?: string; userEmail?: string }

async function requireCommerce(req: AuthedRequest, res: Response, next: () => void) {
  // Self-hosted: one store, one owner. The console sends `Authorization: Bearer <ADMIN_TOKEN>` (see .env).
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return res.status(401).json(E(req, 'srv.auth.required'));
  if (!ADMIN_TOKEN || h.slice(7) !== ADMIN_TOKEN) return res.status(401).json(E(req, 'srv.auth.badToken'));
  req.tenantId = TENANT_ID; req.userRole = 'owner'; req.userId = 'owner'; req.userEmail = 'owner@localhost';
  void rememberOwnerLang(TENANT_ID, req.headers['x-lang']);
  next();
}

function optionalTenant(req: Request): { tenantId: string; role?: UserRole } | null {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ') || !ADMIN_TOKEN || h.slice(7) !== ADMIN_TOKEN) return null;
  return { tenantId: TENANT_ID, role: 'owner' };
}

// ── uploads ─────────────────────────────────────────────────────────────────

const __dirname_c = path.dirname(fileURLToPath(import.meta.url));
const uploadsRoot = path.resolve(__dirname_c, '../../../uploads/commerce');
fs.mkdirSync(uploadsRoot, { recursive: true });
const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.svg']);
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _f, cb) => { const dir = path.join(uploadsRoot, String((req as AuthedRequest).tenantId).replace(/[^a-zA-Z0-9_-]/g, '')); fs.mkdirSync(dir, { recursive: true }); cb(null, dir); },
    filename: (_r, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname || '').toLowerCase()}`),
  }),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_r, file, cb) => cb(null, IMG_EXT.has(path.extname(file.originalname || '').toLowerCase()) && !/svg/.test(path.extname(file.originalname || '').toLowerCase())),
});
const fileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

// ── SSE ─────────────────────────────────────────────────────────────────────

function sse(res: Response) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(': ok\n\n');
  const ping = setInterval(() => { try { if (!res.writableEnded) res.write(': ping\n\n'); } catch { /* closed */ } }, 15_000);
  return {
    send: (ev: AgentEvent) => { try { if (!res.writableEnded) res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`); } catch { /* closed */ } },
    end: () => { clearInterval(ping); try { res.end(); } catch { /* closed */ } },
  };
}

function baseUrl(req: Request): string {
  const env = (process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  return env || `${req.protocol}://${req.get('host')}`;
}

function absolute(req: Request, url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : `${baseUrl(req)}${url.startsWith('/') ? '' : '/'}${url}`;
}

function serializeSettings(req: Request, s: Awaited<ReturnType<typeof getSettings>>) {
  const base = baseUrl(req);
  return {
    ...s,
    shareUrl: `${base}/c/${s.slug}`, coverAutoUrl: `${base}/api/commerce/w/${s.slug}/cover.png?v=${Date.parse(String(s.updated_at)) || 0}`,
    embedSnippet: `<script async src="${base}/comag.js" data-shop="${s.slug}"></script>`,
    pixelSnippet: `<script>window.comag&&window.comag('purchase',{orderId:'ORDER_ID',total:TOTAL,currency:'${s.currency}',items:[{id:'PRODUCT_ID',qty:1,price:PRICE}]});</script>`,
    crawl: getCrawlProgress(s.tenant_id) || s.crawl_status,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN
// ═══════════════════════════════════════════════════════════════════════════

/** Доступ и состояние подключения для фронта (без авторизационной ошибки: 200 всегда). */
router.get('/access', async (req: Request, res: Response) => {
  const t = optionalTenant(req);
  if (!t) return res.status(401).json(E(req, 'srv.auth.required'));
  const key = await resolveAnthropicKey(t.tenantId);
  return res.json({ commerce: true, tier: 'self-hosted', superadmin: false, hasKey: !!key, keySource: key?.source || null });
});

router.use(requireCommerce);

router.get('/settings', async (req: AuthedRequest, res: Response) => {
  try {
    const s = await getSettings(req.tenantId!, req.userEmail?.split('@')[0]);
    const key = await resolveAnthropicKey(req.tenantId!);
    return res.json({ settings: serializeSettings(req, s), key: { configured: !!key, source: key?.source || null }, products: await countProducts(req.tenantId!), geminiKey: { configured: !!(await resolveGeminiKey(req.tenantId!)), source: (await resolveGeminiKey(req.tenantId!))?.source || null, platformAvailable: !!getGeminiApiKey() } });
  } catch (err) {
    console.error('[commerce] settings error:', (err as Error).message);
    return res.status(500).json(E(req, 'srv.settings.load'));
  }
});

router.put('/settings', async (req: AuthedRequest, res: Response) => {
  try {
    const s = await updateSettings(req.tenantId!, req.body || {});
    return res.json({ settings: serializeSettings(req, s) });
  } catch (err) {
    console.error('[commerce] settings update error:', (err as Error).message);
    return res.status(500).json(E(req, 'srv.settings.save'));
  }
});

router.post('/logo', imageUpload.single('image'), async (req: AuthedRequest, res: Response) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) return res.status(400).json(E(req, 'srv.upload.image'));
  const url = `/api/uploads/commerce/${String(req.tenantId).replace(/[^a-zA-Z0-9_-]/g, '')}/${file.filename}`;
  const kind = req.query.kind === 'cover' ? 'cover' : 'logo';
  const s = await updateSettings(req.tenantId!, kind === 'cover' ? { share_cover_url: url } : { logo_url: url });
  invalidateIcons(s.slug);
  return res.json({ settings: serializeSettings(req, s), url });
});

// Подсказки по виду ключа: чаще всего в поле попадает не API-ключ, а OAuth-токен Claude Code,
// Admin-ключ или сохранённый браузером пароль. Сам ключ в логи не пишем — только префикс и длину.
const KEY_HINTS: Array<[RegExp, string]> = [
  [/^sk-ant-oat/i, 'srv.key.anthropic.oauth'],
  [/^sk-ant-admin/i, 'srv.key.anthropic.admin'],
];

router.put('/anthropic-key', async (req: AuthedRequest, res: Response) => {
  const apiKey = String(req.body?.apiKey || '').replace(/\s+/g, '');
  if (apiKey.length < 20) return res.status(400).json(E(req, 'srv.key.anthropic.invalid'));
  for (const [re, hint] of KEY_HINTS) if (re.test(apiKey)) return res.status(400).json(E(req, hint));
  if (!/^sk-ant-/i.test(apiKey)) {
    return res.status(400).json(E(req, 'srv.key.anthropic.notLikely', { prefix: apiKey.slice(0, 6), len: apiKey.length }));
  }
  const model = shoppingModel(null);
  try {
    const client = makeAnthropicClient(apiKey);
    await client.messages.create({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
  } catch (err: any) {
    const status: number | undefined = err?.status || err?.statusCode;
    const msg: string = err?.error?.error?.message || err?.message || String(err);
    console.warn(`[commerce] ключ Anthropic не прошёл проверку: status=${status ?? 'net'} prefix=${apiKey.slice(0, 12)}… len=${apiKey.length} model=${model} msg=${msg}`);
    const lang = reqLang(req);
    const text = status === 401 ? tw(lang, 'srv.key.anthropic.rejected401', { msg })
      : status === 403 ? tw(lang, 'srv.key.anthropic.rejected403', { msg })
      : status === 404 ? tw(lang, 'srv.key.anthropic.model404', { model })
      : status === 400 && /credit|billing|balance/i.test(msg) ? tw(lang, 'srv.key.anthropic.noCredits', { msg })
      : tw(lang, 'srv.key.anthropic.checkFailed', { status: status ?? tw(lang, 'srv.key.net'), msg });
    return res.status(400).json({ error: text, status: status ?? null });
  }
  await setTenantAnthropicKey(req.tenantId!, apiKey);
  return res.json({ ok: true });
});

// Список моделей для выпадающих списков в настройках. Берём у Anthropic по действующему ключу
// (свой → платформы), сливаем с известными алиасами, кэшируем на минуту per-ключ. Без ключа — статический список.
interface ModelOpt { id: string; name: string; note?: string }
const KNOWN_MODELS: ModelOpt[] = [
  { id: 'claude-opus-5', name: 'Claude Opus 5', note: 'srv.models.opus' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', note: 'srv.models.sonnet' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', note: 'srv.models.haiku' },
];
const modelsCache = new Map<string, { at: number; models: ModelOpt[] }>();
const locModels = (req: Request, list: ModelOpt[]) => list.map((m) => (m.note ? { ...m, note: tw(reqLang(req), m.note) } : m));

router.get('/models', async (req: AuthedRequest, res: Response) => {
  const defaults = { shopping: DEFAULT_SHOPPING_MODEL, merchant: DEFAULT_MERCHANT_MODEL };
  const resolved = await resolveAnthropicKey(req.tenantId!);
  if (!resolved) return res.json({ models: locModels(req, KNOWN_MODELS), source: 'static', defaults });
  const cacheKey = resolved.key.slice(-12);
  const hit = modelsCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 60_000) return res.json({ models: locModels(req, hit.models), source: 'api', defaults });
  try {
    const client = makeAnthropicClient(resolved.key);
    const page = await client.models.list({ limit: 100 });
    const fromApi: ModelOpt[] = page.data
      .filter((mm) => mm.id.startsWith('claude'))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map((mm) => ({ id: mm.id, name: mm.display_name || mm.id }));
    const seen = new Set<string>();
    const models: ModelOpt[] = [];
    for (const mm of [...KNOWN_MODELS, ...fromApi]) { if (!seen.has(mm.id)) { seen.add(mm.id); models.push(mm); } }
    modelsCache.set(cacheKey, { at: Date.now(), models });
    return res.json({ models: locModels(req, models), source: 'api', defaults });
  } catch (err: any) {
    console.warn('[commerce] список моделей Anthropic недоступен:', err?.message || err);
    return res.json({ models: locModels(req, KNOWN_MODELS), source: 'static', defaults, error: String(err?.message || err) });
  }
});

// Свой ключ Gemini (видео из соцсетей при глубоком анализе). Проверка коротким запросом к модели.
router.put('/gemini-key', async (req: AuthedRequest, res: Response) => {
  const apiKey = String(req.body?.apiKey || '').replace(/\s+/g, '');
  if (apiKey.length < 20) return res.status(400).json(E(req, 'srv.key.gemini.invalid'));
  if (!/^AIza/.test(apiKey)) return res.status(400).json(E(req, 'srv.key.gemini.notLikely', { prefix: apiKey.slice(0, 6) }));
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=1`, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) { const d: any = await r.json().catch(() => ({})); return res.status(400).json(E(req, 'srv.key.gemini.rejected', { status: r.status, msg: d?.error?.message || tw(reqLang(req), 'srv.key.gemini.rejectedHint') })); }
  } catch (e) { return res.status(400).json(E(req, 'srv.key.gemini.checkFailed', { msg: (e as Error).message })); }
  await setTenantGeminiKey(req.tenantId!, apiKey);
  return res.json({ ok: true });
});
router.delete('/gemini-key', async (req: AuthedRequest, res: Response) => {
  await setTenantGeminiKey(req.tenantId!, null);
  return res.json({ ok: true });
});

router.delete('/anthropic-key', async (req: AuthedRequest, res: Response) => {
  await setTenantAnthropicKey(req.tenantId!, null);
  return res.json({ ok: true });
});

// ── catalog ──
router.get('/products', async (req: AuthedRequest, res: Response) => {
  const r = await listProducts(req.tenantId!, { q: typeof req.query.q === 'string' ? req.query.q : undefined, page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 50, includeInactive: true });
  return res.json(r);
});

router.post('/products', async (req: AuthedRequest, res: Response) => {
  try {
    const s = await getSettings(req.tenantId!);
    const p = await createProduct(req.tenantId!, { ...(req.body || {}), currency: req.body?.currency || s.currency });
    return res.status(201).json({ product: p });
  } catch (err) {
    return res.status(400).json({ error: errText(err, reqLang(req)) });
  }
});

router.put('/products/:id', async (req: AuthedRequest, res: Response) => {
  try {
    const p = await updateProduct(req.tenantId!, req.params.id, req.body || {});
    if (!p) return res.status(404).json(E(req, 'srv.product.notFound'));
    return res.json({ product: p });
  } catch (err) {
    return res.status(400).json({ error: errText(err, reqLang(req)) });
  }
});

router.delete('/products/:id', async (req: AuthedRequest, res: Response) => {
  const ok = await deleteProduct(req.tenantId!, req.params.id);
  return ok ? res.json({ ok: true }) : res.status(404).json(E(req, 'srv.product.notFound'));
});

router.delete('/products', async (req: AuthedRequest, res: Response) => {
  // Удаление по источнику: ?source=site|telegram|instagram|tiktok (&posts=1 — вместе с постами этого источника).
  const source = typeof req.query.source === 'string' ? req.query.source : '';
  if (source) {
    if (!['site', 'telegram', 'instagram', 'tiktok'].includes(source)) return res.status(400).json(E(req, 'srv.source.unknown'));
    const deleted = await deleteProductsBySource(req.tenantId!, source);
    const posts = source !== 'site' && req.query.posts === '1' ? await deletePostsBySource(req.tenantId!, source) : 0;
    return res.json({ ok: true, deleted, posts });
  }
  if (req.query.confirm !== 'all') return res.status(400).json(E(req, 'srv.products.confirm'));
  const n = await deleteAllProducts(req.tenantId!);
  return res.json({ ok: true, deleted: n });
});

router.post('/products/import', fileUpload.single('file'), async (req: AuthedRequest, res: Response) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) return res.status(400).json(E(req, 'srv.import.file'));
  try {
    const s = await getSettings(req.tenantId!);
    const items = parseImportBuffer(file.buffer, file.originalname);
    if (!items.length) return res.status(400).json(E(req, 'srv.import.empty'));
    const result = await importProducts(req.tenantId!, items, s.currency);
    return res.json({ ...result, parsed: items.length });
  } catch (err) {
    return res.status(400).json(E(req, 'srv.import.parse', { msg: (err as Error).message }));
  }
});

router.post('/crawl', async (req: AuthedRequest, res: Response) => {
  const s = await getSettings(req.tenantId!);
  const url = String(req.body?.url || s.site_url || '').trim();
  if (!url) return res.status(400).json(E(req, 'srv.crawl.url'));
  if (!s.site_url || s.site_url !== url) await updateSettings(req.tenantId!, { site_url: url }).catch(() => {});
  const r = startCrawl(req.tenantId!, url, { currency: s.currency, platform: s.platform, brandName: s.brand_name });
  if (!r.ok) return res.status(400).json(E(req, r.error === 'already_running' ? 'srv.crawl.running' : 'srv.crawl.badUrl'));
  return res.json({ ok: true, status: localizeStatus(getCrawlProgress(req.tenantId!), reqLang(req)) });
});

router.get('/crawl', async (req: AuthedRequest, res: Response) => {
  const s = await getSettings(req.tenantId!);
  const live = getCrawlProgress(req.tenantId!);
  let status = live || s.crawl_status || { state: 'idle' as const };
  // В БД остался «running», а в памяти обхода нет — процесс перезапустили посреди обхода.
  if (!live && s.crawl_status?.state === 'running') {
    status = { ...s.crawl_status, state: 'error', finished_at: new Date().toISOString(), phase: undefined, phase_key: undefined, message: tw('ru', 'srv.crawl.interrupted'), message_parts: [['srv.crawl.interrupted']] };
    await setCrawlStatus(req.tenantId!, status).catch(() => {});
  }
  return res.json({ status: localizeStatus(status, reqLang(req)), products: await countProducts(req.tenantId!), summary: await catalogSummary(req.tenantId!) });
});

// ── Соцсети: Instagram (сессия владельца через ig-gateway) и TikTok (публичный профиль) ──
async function socialStatusPayload(tenantId: string, lang: string) {
  const s = await getSettings(tenantId);
  const accounts = await getSocialAccounts(tenantId);
  let instagram: any = { available: igpConfigured(), status: 'disconnected', username: null, challenge: null, error: null };
  if (igpConfigured()) {
    try { const st = await igStatus(tenantId); instagram = { available: true, ...st }; } catch { instagram.error = tw(lang, 'srv.social.igUnavailable'); }
  }
  const live = getSocialProgress(tenantId);
  let job: any = live || (await getSocialStatus(tenantId)) || { state: 'idle' };
  if (!live && job.state === 'running') {
    job = { ...job, state: 'error', finished_at: new Date().toISOString(), phase: undefined, phase_key: undefined, message: tw('ru', 'srv.social.interrupted'), message_parts: [['srv.social.interrupted']] };
    await setSocialStatus(tenantId, job).catch(() => {});
  }
  return { instagram, tiktok: accounts.tiktok || null, telegram: accounts.telegram || null, instagramAccount: accounts.instagram || null, job: localizeStatus(job, lang), summary: await catalogSummary(tenantId), limits: POST_LIMITS, currency: s.currency };
}

router.get('/social/status', async (req: AuthedRequest, res: Response) => res.json(await socialStatusPayload(req.tenantId!, reqLang(req))));

router.post('/social/instagram/connect', async (req: AuthedRequest, res: Response) => {
  if (!igpConfigured()) return res.status(503).json(E(req, 'srv.social.igNotConfigured'));
  const username = String(req.body?.username || '').trim().replace(/^@/, '');
  const password = String(req.body?.password || '');
  const proxy = req.body?.proxy ? String(req.body.proxy).trim() : null;
  if (!username || !password) return res.status(400).json(E(req, 'srv.social.igCredentials'));
  try {
    const st = await connectIg(req.tenantId!, { username, password, proxy });
    await upsertIgPrivateSession(req.tenantId!, st.status, username);
    return res.json({ ok: true, status: st });
  } catch (e) {
    return res.status(502).json(E(req, 'srv.social.igGateway', { msg: (e as Error).message }));
  }
});

router.post('/social/instagram/challenge', async (req: AuthedRequest, res: Response) => {
  const code = String(req.body?.code || '').trim();
  if (!code) return res.status(400).json(E(req, 'srv.social.code'));
  try { return res.json({ ok: true, status: await igChallenge(req.tenantId!, code) }); } catch (e) { return res.status(502).json({ error: errText(e, reqLang(req)) }); }
});

router.post('/social/instagram/logout', async (req: AuthedRequest, res: Response) => {
  await logoutIg(req.tenantId!);
  await upsertIgPrivateSession(req.tenantId!, 'disconnected');
  return res.json({ ok: true });
});

router.post('/social/analyze', async (req: AuthedRequest, res: Response) => {
  const source: SocialSource = req.body?.source === 'tiktok' ? 'tiktok' : req.body?.source === 'telegram' ? 'telegram' : 'instagram';
  const limit = Number(req.body?.limit) || 25;
  const depth = req.body?.depth === 'deep' ? 'deep' : 'fast';
  let handle: string | null = null;
  if (source === 'tiktok') {
    handle = tiktokHandle(String(req.body?.handle || ''));
    if (!handle) return res.status(400).json(E(req, 'srv.social.ttHandle'));
    await setSocialAccounts(req.tenantId!, { tiktok: { username: handle } }).catch(() => {});
  } else if (source === 'telegram') {
    handle = tgHandle(String(req.body?.handle || ''));
    if (!handle) return res.status(400).json(E(req, 'srv.social.tgHandle'));
    await setSocialAccounts(req.tenantId!, { telegram: { username: handle } }).catch(() => {});
  } else if (!igpConfigured()) {
    return res.status(503).json(E(req, 'srv.social.igNotConfigured'));
  }
  const offset = Math.max(0, Math.min(5000, Number(req.body?.offset) || 0));
  const r = startSocialAnalysis(req.tenantId!, { source, handle, limit, depth, offset });
  if (!r.ok) return res.status(400).json(r.error === 'already_running' ? E(req, 'srv.crawl.running') : { error: r.error });
  return res.json({ ok: true, status: localizeStatus(getSocialProgress(req.tenantId!), reqLang(req)) });
});

// ── Уведомления владельцу в Telegram (свой бот; независимо от тарифа и таблицы tenants) ──
router.get('/social/telegram-notify', async (req: AuthedRequest, res: Response) => res.json(await getNotifyState(req.tenantId!)));
router.put('/social/telegram-notify', async (req: AuthedRequest, res: Response) => {
  try {
    const b = req.body || {};
    const st = await setNotifyToken(req.tenantId!, b.botToken === null ? null : String(b.botToken || ''));
    return res.json({ ok: true, ...st });
  } catch (e) { return res.status(400).json({ error: errText(e, reqLang(req)) }); }
});
router.post('/social/telegram-link', async (req: AuthedRequest, res: Response) => {
  const bot = await getPlatformBot();
  if (!bot) return res.status(503).json(E(req, 'srv.notify.botNotConfigured'));
  await ensurePlatformWebhook();
  const code = await createLinkCode(req.tenantId!);
  return res.json({ ok: true, url: `https://t.me/${bot.username}?start=${code}`, bot: bot.username, code });
});
router.post('/social/telegram-notify/refresh', async (req: AuthedRequest, res: Response) => {
  try { return res.json({ ok: true, ...(await refreshNotifySubscribers(req.tenantId!)) }); } catch (e) { return res.status(400).json({ error: errText(e, reqLang(req)) }); }
});
router.post('/social/telegram-notify/test', async (req: AuthedRequest, res: Response) => res.json(await sendNotifyTest(req.tenantId!)));
router.delete('/social/telegram-notify/subscribers/:chatId', async (req: AuthedRequest, res: Response) => res.json({ ok: true, ...(await removeNotifySubscriber(req.tenantId!, String(req.params.chatId))) }));

// ── dialogs / leads / stats ──
router.get('/conversations', async (req: AuthedRequest, res: Response) => {
  const r = await listConversations(req.tenantId!, { channel: 'widget', page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 30, q: typeof req.query.q === 'string' ? req.query.q : undefined });
  return res.json(r);
});

router.get('/conversations/:id', async (req: AuthedRequest, res: Response) => {
  const c = await getConversation(req.tenantId!, req.params.id);
  if (!c) return res.status(404).json(E(req, 'srv.dialog.notFound'));
  const messages = await listDisplayMessages(req.tenantId!, c.id);
  const leads = (await listLeads(req.tenantId!, { limit: 100 })).items.filter((l) => l.conversation_id === c.id);
  return res.json({ conversation: c, messages, leads });
});

// ── Push покупателю по диалогу: сколько устройств, отправить сейчас или по дате, история ──
router.get('/conversations/:id/push', async (req: AuthedRequest, res: Response) => {
  const c = await getConversation(req.tenantId!, req.params.id);
  if (!c) return res.status(404).json(E(req, 'srv.dialog.notFound'));
  return res.json({ subscribers: await countSubs(req.tenantId!, c.id), jobs: await listPushJobs(req.tenantId!, c.id), sentToday: await pushesLast24h(req.tenantId!, c.id), limit: PUSH_DAILY_LIMIT });
});
router.post('/conversations/:id/push', async (req: AuthedRequest, res: Response) => {
  const c = await getConversation(req.tenantId!, req.params.id);
  if (!c) return res.status(404).json(E(req, 'srv.dialog.notFound'));
  const title = String(req.body?.title || '').trim().slice(0, 80);
  const body = String(req.body?.body || '').trim().slice(0, 300);
  if (!title || !body) return res.status(400).json(E(req, 'srv.push.textRequired'));
  if ((await countSubs(req.tenantId!, c.id)) === 0) return res.status(400).json(E(req, 'srv.push.noSubs'));
  if ((await pushesLast24h(req.tenantId!, c.id)) >= PUSH_DAILY_LIMIT) return res.status(429).json(E(req, 'srv.push.limit', { n: PUSH_DAILY_LIMIT }));
  const sendAtRaw = req.body?.sendAt ? new Date(String(req.body.sendAt)) : null;
  if (sendAtRaw && Number.isNaN(+sendAtRaw)) return res.status(400).json(E(req, 'srv.push.textRequired'));
  const s = await getSettings(req.tenantId!);
  const job = await createPushJob(req.tenantId!, { conversationId: c.id, title, body, url: `${baseUrl(req)}/c/${s.slug}?pwa=1&conv=${c.id}`, icon: `${baseUrl(req)}/api/commerce/w/${s.slug}/icon-192.png`, sendAt: sendAtRaw });
  return res.json({ job });
});
router.delete('/push-jobs/:id', async (req: AuthedRequest, res: Response) => {
  const ok = await cancelPushJob(req.tenantId!, req.params.id);
  return ok ? res.json({ ok: true }) : res.status(404).json(E(req, 'srv.notFound'));
});

router.get('/leads', async (req: AuthedRequest, res: Response) => {
  const status = typeof req.query.status === 'string' && ['new', 'contacted', 'won', 'lost'].includes(req.query.status) ? (req.query.status as LeadStatus) : undefined;
  const r = await listLeads(req.tenantId!, { page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 30, status });
  return res.json(r);
});

router.patch('/leads/:id', async (req: AuthedRequest, res: Response) => {
  const status = String(req.body?.status || '');
  if (!['new', 'contacted', 'won', 'lost'].includes(status)) return res.status(400).json(E(req, 'srv.lead.badStatus'));
  const l = await updateLeadStatus(req.tenantId!, req.params.id, status as LeadStatus, typeof req.body?.note === 'string' ? req.body.note.slice(0, 1000) : undefined);
  return l ? res.json({ lead: l }) : res.status(404).json(E(req, 'srv.lead.notFound'));
});

router.get('/stats', async (req: AuthedRequest, res: Response) => {
  const days = [1, 7, 14, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  try {
    const [snapshot, dialogs, leads, pending, products, s] = await Promise.all([
      getSnapshot(req.tenantId!, days), getSeries(req.tenantId!, 'dialogs', days), getSeries(req.tenantId!, 'leads', days),
      listChanges(req.tenantId!, 'staged', 50), countProducts(req.tenantId!), getSettings(req.tenantId!),
    ]);
    return res.json({ snapshot, series: { dialogs, leads }, pendingChanges: pending.length, products, crawl: localizeStatus(getCrawlProgress(req.tenantId!) || s.crawl_status, reqLang(req)), widgetEnabled: s.enabled });
  } catch (err) {
    console.error('[commerce] stats error:', (err as Error).message);
    return res.status(500).json(E(req, 'srv.stats.failed'));
  }
});

// ── staged changes ──
router.get('/changes', async (req: AuthedRequest, res: Response) => {
  const status = typeof req.query.status === 'string' && ['staged', 'applied', 'discarded'].includes(req.query.status) ? (req.query.status as any) : undefined;
  return res.json({ changes: await listChanges(req.tenantId!, status, 100) });
});

router.post('/changes/:id/apply', async (req: AuthedRequest, res: Response) => {
  const r = await applyChange(req.tenantId!, req.params.id);
  if (!r.ok) return res.status(400).json({ error: r.error });
  return res.json({ change: r.change });
});

router.post('/changes/:id/discard', async (req: AuthedRequest, res: Response) => {
  const c = await setChangeStatus(req.tenantId!, req.params.id, 'discarded');
  return c ? res.json({ change: c }) : res.status(404).json(E(req, 'srv.change.notFound'));
});

router.get('/changes/:id', async (req: AuthedRequest, res: Response) => {
  const c = await getChange(req.tenantId!, req.params.id);
  return c ? res.json({ change: c }) : res.status(404).json(E(req, 'srv.notFound'));
});

// ── merchant agent chat (SSE) ──
router.get('/merchant/conversations', async (req: AuthedRequest, res: Response) => {
  const r = await listConversations(req.tenantId!, { channel: 'merchant', limit: 20 });
  return res.json(r);
});

router.get('/merchant/conversations/:id', async (req: AuthedRequest, res: Response) => {
  const c = await getConversation(req.tenantId!, req.params.id);
  if (!c || c.channel !== 'merchant') return res.status(404).json(E(req, 'srv.dialog.notFound'));
  return res.json({ conversation: c, messages: await listDisplayMessages(req.tenantId!, c.id) });
});

router.post('/merchant/chat', async (req: AuthedRequest, res: Response) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json(E(req, 'srv.merchant.message'));
  const settings = await getSettings(req.tenantId!);
  const out = sse(res);
  try {
    const r = await runMerchantTurn({ settings, conversationId: req.body?.conversationId || null, operatorId: req.userId || 'owner', message, lang: req.body?.lang || null, emit: out.send });
    out.send({ type: 'done', data: { conversationId: r.conversationId, usage: r.usage } });
  } catch (err) {
    const msg = (err as Error).message;
    out.send({ type: 'error', message: msg === 'assistant_not_configured' ? tw(reqLang(req), 'srv.merchant.noKey') : tw(reqLang(req), 'srv.merchant.error', { msg }) });
  }
  out.end();
});

export default router;

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC (widget) — отдельный роутер без JWT
// ═══════════════════════════════════════════════════════════════════════════

export const commercePublicRouter = Router();

const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'rate_limited' } });
const eventLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'rate_limited' } });
const leadLimiter = rateLimit({ windowMs: 60 * 1000, max: 6, standardHeaders: true, legacyHeaders: false, message: { error: 'rate_limited' } });

const VISITOR_RE = /^[A-Za-z0-9_-]{8,64}$/;

// Webhook единого бота платформы (секрет в заголовке от Telegram). Всегда 200, чтобы Telegram не ретраил.
commercePublicRouter.post('/tg/webhook', async (req: Request, res: Response) => {
  const token = getCommerceTelegramBotToken();
  if (!token || req.get('x-telegram-bot-api-secret-token') !== platformWebhookSecret(token)) return res.status(401).end();
  handlePlatformUpdate(req.body).catch((e) => console.warn('[commerce/notify] webhook:', (e as Error).message));
  return res.json({ ok: true });
});

// Автообложка для превью ссылки (когда своя не загружена): цвет, логотип, фото товаров.
commercePublicRouter.get('/w/:slug/cover.png', async (req: Request, res: Response) => {
  const s = await getSettingsBySlug(req.params.slug);
  if (!s) return res.status(404).end();
  try {
    const file = await buildAutoCover(s);
    res.set('Cache-Control', 'public, max-age=3600');
    return res.type('png').sendFile(file);
  } catch (e) {
    console.warn('[commerce] cover build failed:', (e as Error).message);
    return res.status(500).end();
  }
});

// ── PWA витрины: манифест и иконки (имя — короткое слово, иконка — загруженный логотип) ──
commercePublicRouter.get('/w/:slug/manifest.webmanifest', async (req: Request, res: Response) => {
  const s = await getSettingsBySlug(req.params.slug);
  if (!s) return res.status(404).json({ error: 'not_found' });
  res.set('Content-Type', 'application/manifest+json; charset=utf-8');
  res.set('Cache-Control', 'no-cache');
  return res.send(JSON.stringify(buildManifest(s)));
});
commercePublicRouter.get('/w/:slug/icon-:size.png', async (req: Request, res: Response) => {
  const s = await getSettingsBySlug(req.params.slug);
  if (!s) return res.status(404).end();
  try {
    const png = await buildIcon(s, req.params.size === '512' ? 512 : 192, req.query.maskable === '1');
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    return res.send(png);
  } catch (e) { console.warn('[commerce/pwa] icon failed:', (e as Error).message); return res.status(500).end(); }
});
// ── Web Push покупателя: ключ и подписка (привязка к посетителю и диалогу) ──
commercePublicRouter.get('/w/:slug/push/key', async (_req: Request, res: Response) => {
  const v = await getVapid().catch(() => null);
  return res.json({ key: v?.publicKey || null });
});
commercePublicRouter.post('/w/:slug/push/subscribe', eventLimiter, async (req: Request, res: Response) => {
  const s = await getSettingsBySlug(req.params.slug);
  if (!s) return res.status(404).json({ error: 'not_found' });
  try {
    await saveSubscription(s.tenant_id, s.slug, {
      subscription: req.body?.subscription,
      visitorId: typeof req.body?.visitorId === 'string' ? req.body.visitorId.slice(0, 64) : null,
      conversationId: typeof req.body?.conversationId === 'string' ? req.body.conversationId.slice(0, 36) : null,
      lang: typeof req.body?.lang === 'string' ? req.body.lang.slice(0, 8) : null,
      ua: String(req.headers['user-agent'] || '').slice(0, 300),
    });
    return res.json({ ok: true });
  } catch { return res.status(400).json({ error: 'bad_subscription' }); }
});
commercePublicRouter.post('/w/:slug/push/unsubscribe', eventLimiter, async (req: Request, res: Response) => {
  if (typeof req.body?.endpoint === 'string') await removeSubscription(req.body.endpoint).catch(() => {});
  return res.json({ ok: true });
});

commercePublicRouter.get('/w/:slug/config', async (req: Request, res: Response) => {
  const s = await getSettingsBySlug(req.params.slug);
  if (!s) return res.status(404).json({ error: 'not_found' });
  const key = s.enabled ? await resolveAnthropicKey(s.tenant_id) : null;
  const lang = normalizeLang(String(req.query.lang || (s.language !== 'auto' ? s.language : '') || 'en'));
  const starters = s.starters?.length ? s.starters : defaultStarters({ lang, summary: await catalogSummary(s.tenant_id), policies: `${s.policies}\n${s.business_profile}`, hasPosts: (await countPosts(s.tenant_id).catch(() => 0)) > 0 });
  res.set('Cache-Control', 'public, max-age=60');
  return res.json({ ...toPublicConfig(s), starters, lang, strings: widgetStrings(lang), ready: s.enabled && !!key, logoUrl: absolute(req, s.logo_url), shareCoverUrl: s.share_cover_url ? absolute(req, s.share_cover_url) : `${baseUrl(req)}/api/commerce/w/${s.slug}/cover.png`, shareCoverAuto: !s.share_cover_url, shareUrl: `${baseUrl(req)}/c/${s.slug}` });
});

commercePublicRouter.post('/w/:slug/chat', chatLimiter, async (req: Request, res: Response) => {
  const s = await getSettingsBySlug(req.params.slug);
  if (!s || !s.enabled) return res.status(404).json({ error: 'not_found' });
  const visitorId = String(req.body?.visitorId || '');
  const message = String(req.body?.message || '').trim().slice(0, 2000);
  if (!VISITOR_RE.test(visitorId)) return res.status(400).json({ error: 'visitorId_required' });
  if (!message) return res.status(400).json({ error: 'message_required' });
  const page = req.body?.page && typeof req.body.page === 'object' ? { url: String(req.body.page.url || '').slice(0, 500) || null, title: String(req.body.page.title || '').slice(0, 200) || null, productId: typeof req.body.page.productId === 'string' ? req.body.page.productId.slice(0, 64) : null } : null;
  const out = sse(res);
  try {
    const r = await runShoppingTurn({ settings: s, conversationId: typeof req.body?.conversationId === 'string' ? req.body.conversationId : null, visitorId, message, lang: typeof req.body?.lang === 'string' ? req.body.lang.slice(0, 8) : null, page, emit: out.send });
    out.send({ type: 'done', data: { conversationId: r.conversationId } });
  } catch (err) {
    const msg = (err as Error).message;
    console.error('[commerce] chat error:', msg);
    out.send({ type: 'error', message: msg === 'assistant_not_configured' ? 'assistant_not_configured' : 'agent_error' });
  }
  out.end();
});

commercePublicRouter.post('/w/:slug/event', eventLimiter, async (req: Request, res: Response) => {
  const s = await getSettingsBySlug(req.params.slug);
  if (!s) return res.status(404).json({ error: 'not_found' });
  const kind = String(req.body?.kind || '');
  if (!['card_click', 'add_to_cart', 'checkout_click', 'widget_open'].includes(kind)) return res.status(400).json({ error: 'bad_kind' });
  const conversationId = typeof req.body?.conversationId === 'string' ? req.body.conversationId : null;
  if (conversationId) { const c = await getConversation(s.tenant_id, conversationId); if (!c) return res.json({ ok: true }); }
  await logEvent(s.tenant_id, kind as any, { conversationId, productId: typeof req.body?.productId === 'string' ? req.body.productId : null, payload: { source: 'widget' } });
  return res.json({ ok: true });
});

commercePublicRouter.post('/w/:slug/lead', leadLimiter, async (req: Request, res: Response) => {
  const s = await getSettingsBySlug(req.params.slug);
  if (!s) return res.status(404).json({ error: 'not_found' });
  const name = String(req.body?.name || '').trim().slice(0, 120);
  const phone = String(req.body?.phone || '').trim().slice(0, 60);
  const email = String(req.body?.email || '').trim().slice(0, 120);
  const note = String(req.body?.note || '').trim().slice(0, 500);
  const reason = String(req.body?.reason || '').trim().slice(0, 200);
  if (!phone && !email) return res.status(400).json({ error: 'contact_required' });
  const conversationId = typeof req.body?.conversationId === 'string' ? req.body.conversationId : null;
  const conv = conversationId ? await getConversation(s.tenant_id, conversationId) : null;
  const lead = await createLead(s.tenant_id, { conversationId: conv?.id || null, kind: 'callback', items: conv?.cart?.items || [], total: null, currency: s.currency, contact: { name, phone, email }, note: [reason, note].filter(Boolean).join(' · ') || null });
  await logEvent(s.tenant_id, 'lead', { conversationId: conv?.id || null, payload: { leadId: lead.id } });
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const ol = ownerLangOf(s);
  const leadText = tw(ol, 'srv.tg.lead', { brand: esc(s.brand_name || ''), name: esc(name || '—'), phone: esc(phone || '—'), email: esc(email || '—') })
    + (reason ? tw(ol, 'srv.tg.leadTopic', { reason: esc(reason) }) : '') + (note ? tw(ol, 'srv.tg.leadNote', { note: esc(note) }) : '');
  sendOwnerNotification(s.tenant_id, leadText).catch(() => {});
  void notifyOwnerTelegram(s.tenant_id, leadText);
  return res.json({ ok: true, leadId: lead.id });
});

/** Пиксель покупки со страницы «спасибо»: атрибуция к диалогу посетителя за 7 дней. */
commercePublicRouter.post('/w/:slug/purchase', eventLimiter, async (req: Request, res: Response) => {
  const s = await getSettingsBySlug(req.params.slug);
  if (!s) return res.status(404).json({ error: 'not_found' });
  const visitorId = String(req.body?.visitorId || '');
  const total = Number(req.body?.total);
  const items = Array.isArray(req.body?.items) ? (req.body.items as any[]).slice(0, 100).map((i) => ({ product_id: String(i?.id || ''), title: String(i?.title || '').slice(0, 200), price: Number(i?.price) || 0, quantity: Math.max(1, Math.round(Number(i?.qty ?? i?.quantity) || 1)) })) : [];
  const conversationId = typeof req.body?.conversationId === 'string' ? req.body.conversationId : null;
  let convId: string | null = null;
  if (conversationId) { const c = await getConversation(s.tenant_id, conversationId); if (c && (!VISITOR_RE.test(visitorId) || c.visitor_id === visitorId)) convId = c.id; }
  if (!convId && VISITOR_RE.test(visitorId)) convId = await findRecentConversationByVisitor(s.tenant_id, visitorId, 7);
  if (!convId) return res.json({ ok: true, attributed: false });
  const lead = await createLead(s.tenant_id, { conversationId: convId, kind: 'purchase', items, total: Number.isFinite(total) ? Math.round(total * 100) / 100 : null, currency: String(req.body?.currency || s.currency).slice(0, 8), contact: {}, note: req.body?.orderId ? `order ${String(req.body.orderId).slice(0, 80)}` : null });
  await logEvent(s.tenant_id, 'purchase', { conversationId: convId, payload: { leadId: lead.id, total: lead.total } });
  return res.json({ ok: true, attributed: true });
});

/** Service worker витрин (scope /c/): установка на телефон и push. Монтируется в server.ts как /c/sw.js. */
export function commerceServiceWorker(_req: Request, res: Response) {
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.set('Cache-Control', 'no-cache');
  res.set('Service-Worker-Allowed', '/c/');
  return res.send(SERVICE_WORKER_JS);
}

/** Хостед-страница /c/:slug: SPA с OG-превью (заголовок, описание, обложка) для пересылки. */
export function commerceHostedPage(frontendIndexPath: string) {
  return async (req: Request, res: Response) => {
    const s = await getSettingsBySlug(req.params.slug);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-cache');
    res.removeHeader('Content-Security-Policy');
    let html: string;
    try { html = fs.readFileSync(frontendIndexPath, 'utf-8'); } catch { return res.status(500).send('frontend is not built'); }
    if (!s) return res.status(404).send(html);
    const esc = (t: string) => String(t || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    // Язык страницы: ?lang → язык витрины → язык владельца → Accept-Language браузера; для ar/he/fa/ur/ps/sd/ug/yi — RTL
    const pageLang = normalizeLang(String(req.query.lang || (s.language && s.language !== 'auto' ? s.language : '') || s.owner_lang || (req.acceptsLanguages()[0] || '') || 'en'));
    const rtl = ['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi'].includes(pageLang);
    html = html.replace(/<html([^>]*)>/i, (_m, attrs: string) => `<html${attrs.replace(/\s+(lang|dir)=["'][^"']*["']/gi, '')} lang="${pageLang}" dir="${rtl ? 'rtl' : 'ltr'}">`);
    const title = esc(s.share_title || s.brand_name || s.assistant_name || tw(pageLang, 'w.hostedTitle'));
    const desc = esc(s.share_description || s.greeting || tw(pageLang, 'w.hostedDesc'));
    const image = s.share_cover_url ? (absolute(req, s.share_cover_url) || '') : `${baseUrl(req)}/api/commerce/w/${s.slug}/cover.png`;
    const url = `${baseUrl(req)}/c/${s.slug}`;
    const setMeta = (h: string, attr: 'property' | 'name', key: string, value: string) => {
      const re = new RegExp(`(<meta\\s+${attr}=["']${key}["']\\s+content=["'])[^"']*(["']\\s*/?>)`, 'i');
      if (re.test(h)) return h.replace(re, `$1${value}$2`);
      return h.replace(/<\/head>/i, `    <meta ${attr}="${key}" content="${value}" />\n  </head>`);
    };
    // PWA этой витрины: свой манифест (id/start_url со слагом — ставится именно этот чат), иконка из логотипа,
    // цвет темы, ранний перехват beforeinstallprompt (событие может прийти до загрузки виджета).
    const pwaBase = `/api/commerce/w/${s.slug}`;
    html = html.replace(/<link rel="manifest"[^>]*>/i, `<link rel="manifest" href="${pwaBase}/manifest.webmanifest" />`);
    html = html.replace(/<link rel="apple-touch-icon"[^>]*>\s*/gi, '');
    html = setMeta(html, 'name', 'theme-color', /^#[0-9a-f]{6}$/i.test(s.accent || '') ? String(s.accent) : '#111827');
    html = html.replace(/<\/head>/i, `    <link rel="apple-touch-icon" href="${pwaBase}/icon-192.png" />\n    <meta name="apple-mobile-web-app-capable" content="yes" />\n    <meta name="mobile-web-app-capable" content="yes" />\n    <meta name="apple-mobile-web-app-status-bar-style" content="default" />\n    <meta name="apple-mobile-web-app-title" content="${esc(shortAppName(s))}" />\n    <script>window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__comagInstall=e;});</script>\n  </head>`);
    html = html.replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`);
    html = setMeta(html, 'property', 'og:title', title);
    html = setMeta(html, 'property', 'og:description', desc);
    html = setMeta(html, 'property', 'og:url', url);
    html = setMeta(html, 'property', 'og:type', 'website');
    if (image) { html = setMeta(html, 'property', 'og:image', image); html = setMeta(html, 'name', 'twitter:image', image); html = setMeta(html, 'name', 'twitter:card', 'summary_large_image'); }
    html = setMeta(html, 'name', 'twitter:title', title);
    html = setMeta(html, 'name', 'twitter:description', desc);
    html = setMeta(html, 'name', 'description', desc);
    return res.send(html);
  };
}
