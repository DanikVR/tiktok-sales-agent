/**
 * Commerce Agents — уведомления владельцу в Telegram через его бота (BotFather), независимо от
 * тарифа и от таблицы tenants (у суперадмина tenant_id = 'global_admin', не UUID).
 * Хранение: commerce_settings.notify_telegram JSONB = { token_encrypted, bot: {id, username}, subscribers: [{chatId, name, username}] }.
 * Подписчики — все, кто написал боту (/start): собираем через getUpdates при «синхронизации».
 */

import { createHash, randomBytes } from 'crypto';
import pool, { isFallbackActive } from '../db.js';
import { encryptSecret, decryptSecret } from '../encryption.js';
import { getCommerceTelegramBotToken } from '../config.js';
import { tw, normalizeLang, LocalizedError } from './i18n.js';

const TG = 'https://api.telegram.org';

export interface NotifySubscriber { chatId: string; name: string; username: string | null; via?: 'platform' | 'own' }
export interface NotifyState { platformBot: { username: string; name: string } | null; mode: 'platform' | 'own'; hasBotToken: boolean; bot: { id: number; username: string; name: string } | null; subscribers: NotifySubscriber[] }
interface Stored { token_encrypted?: string | null; bot?: NotifyState['bot']; subscribers?: NotifySubscriber[]; offset?: number }

const mem = new Map<string, Stored>();

async function readStored(tenantId: string): Promise<Stored> {
  if (isFallbackActive()) return mem.get(tenantId) || {};
  const r = await pool.query(`SELECT notify_telegram FROM commerce_settings WHERE tenant_id = $1`, [tenantId]).catch(() => ({ rows: [] as any[] }));
  const v = (r.rows as any[])[0]?.notify_telegram;
  return (typeof v === 'string' ? JSON.parse(v) : v) || {};
}
async function writeStored(tenantId: string, st: Stored): Promise<void> {
  if (isFallbackActive()) { mem.set(tenantId, st); return; }
  await pool.query(`UPDATE commerce_settings SET notify_telegram = $2::jsonb, updated_at = now() WHERE tenant_id = $1`, [tenantId, JSON.stringify(st)]);
}
function toState(st: Stored, platformBot: NotifyState['platformBot'] = null): NotifyState { return { platformBot, mode: st.token_encrypted ? 'own' : 'platform', hasBotToken: !!st.token_encrypted, bot: st.bot || null, subscribers: st.subscribers || [] }; }

async function tg(token: string, method: string, body?: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${TG}/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(15_000) });
  const d: any = await r.json().catch(() => ({}));
  if (!d.ok) throw new Error(d.description || `Telegram ${method}: HTTP ${r.status}`);
  return d.result;
}

export async function getNotifyState(tenantId: string): Promise<NotifyState> { return toState(await readStored(tenantId), await getPlatformBot()); }

/** Сохранить токен бота: проверяем через getMe, сразу ищем подписчиков и шлём им приветствие. */
export async function setNotifyToken(tenantId: string, rawToken: string | null): Promise<NotifyState & { welcomed?: number }> {
  if (rawToken === null) { await writeStored(tenantId, {}); return toState({}); }
  const token = String(rawToken).trim();
  if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token)) throw new LocalizedError('srv.tg.badToken');
  const me = await tg(token, 'getMe');
  const prev = await readStored(tenantId);
  const sameBot = prev.bot?.id === me.id;
  const st: Stored = { token_encrypted: encryptSecret(token), bot: { id: me.id, username: me.username, name: me.first_name || me.username }, subscribers: sameBot ? prev.subscribers || [] : [], offset: sameBot ? prev.offset : undefined };
  await writeStored(tenantId, st);
  const after = await refreshNotifySubscribers(tenantId);
  let welcomed = 0;
  const ownerLang = (await langOf(tenantId)) || 'ru';
  for (const s of after.subscribers) {
    try { await tg(token, 'sendMessage', { chat_id: s.chatId, text: tw(ownerLang, 'srv.tg.connected', { bot: me.username }), disable_web_page_preview: true }); welcomed++; } catch { /* ignore */ }
  }
  return { ...after, welcomed };
}

/** Собрать подписчиков: все личные чаты, из которых боту писали (getUpdates). */
export async function refreshNotifySubscribers(tenantId: string): Promise<NotifyState> {
  const st = await readStored(tenantId);
  if (!st.token_encrypted) return toState(st);
  const token = decryptSecret(st.token_encrypted) || '';
  if (!token) return toState(st);
  await tg(token, 'deleteWebhook', { drop_pending_updates: false }).catch(() => {});
  const updates: any[] = await tg(token, 'getUpdates', { timeout: 0, limit: 100, allowed_updates: ['message', 'my_chat_member'], ...(st.offset ? { offset: st.offset } : {}) });
  const subs = new Map<string, NotifySubscriber>((st.subscribers || []).map((s) => [s.chatId, s]));
  let maxId = st.offset ? st.offset - 1 : 0;
  for (const u of updates) {
    maxId = Math.max(maxId, Number(u.update_id) || 0);
    const chat = u.message?.chat || u.my_chat_member?.chat;
    if (!chat) continue;
    const status = u.my_chat_member?.new_chat_member?.status;
    if (status === 'kicked' || status === 'left') { subs.delete(String(chat.id)); continue; }
    subs.set(String(chat.id), { chatId: String(chat.id), name: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || String(chat.id), username: chat.username || null, via: 'own' });
  }
  const next: Stored = { ...st, subscribers: Array.from(subs.values()), offset: maxId ? maxId + 1 : st.offset };
  await writeStored(tenantId, next);
  return toState(next);
}

export async function removeNotifySubscriber(tenantId: string, chatId: string): Promise<NotifyState> {
  const st = await readStored(tenantId);
  const next = { ...st, subscribers: (st.subscribers || []).filter((s) => s.chatId !== chatId) };
  await writeStored(tenantId, next);
  return toState(next);
}

/** Отправить текст всем подписчикам. Best-effort: не бросает. Возвращает число доставленных. */
export async function notifyOwnerTelegram(tenantId: string, text: string): Promise<number> {
  try {
    const st = await readStored(tenantId);
    if (!st.subscribers?.length) return 0;
    const ownToken = st.token_encrypted ? decryptSecret(st.token_encrypted) || '' : '';
    const platformToken = getCommerceTelegramBotToken();
    let sent = 0;
    for (const s of st.subscribers) {
      // Каждому получателю пишет тот бот, через который он подключился (у него есть чат только с ним).
      const token = s.via === 'platform' ? platformToken : (ownToken || platformToken);
      if (!token) continue;
      try { await tg(token, 'sendMessage', { chat_id: s.chatId, text: text.slice(0, 3800), parse_mode: 'HTML', disable_web_page_preview: true }); sent++; } catch (e) { console.warn('[commerce/notify] send failed:', (e as Error).message); }
    }
    return sent;
  } catch (e) {
    console.warn('[commerce/notify] failed:', (e as Error).message);
    return 0;
  }
}

export async function sendNotifyTest(tenantId: string): Promise<{ sent: number; total: number }> {
  const st = await readStored(tenantId);
  const total = st.subscribers?.length || 0;
  const sent = await notifyOwnerTelegram(tenantId, tw((await langOf(tenantId)) || 'ru', 'srv.tg.test'));
  return { sent, total };
}

// ── Единый бот платформы: deep-link t.me/<bot>?start=<code> → привязка чата к витрине; webhook ─────
let platformCache: { token: string; username: string; name: string; webhookOk: boolean } | null = null;
const memLinks = new Map<string, { tenantId: string; at: number }>();

export async function getPlatformBot(): Promise<NotifyState['platformBot']> {
  const token = getCommerceTelegramBotToken();
  if (!token) { platformCache = null; return null; }
  if (platformCache?.token === token) return { username: platformCache.username, name: platformCache.name };
  try {
    const me = await tg(token, 'getMe');
    platformCache = { token, username: me.username, name: me.first_name || me.username, webhookOk: false };
    return { username: me.username, name: platformCache.name };
  } catch (e) {
    console.warn('[commerce/notify] бот платформы: getMe не прошёл:', (e as Error).message);
    return null;
  }
}

export function platformWebhookSecret(token: string): string { return createHash('sha256').update(`comag-tg:${token}`).digest('hex').slice(0, 40); }

export function publicBaseUrl(): string {
  return (process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || 'https://vibevox.pro').replace(/\/+$/, '');
}

/** Ставит webhook на /api/commerce/tg/webhook (один раз на токен; при смене токена — заново). */
export async function ensurePlatformWebhook(): Promise<boolean> {
  const token = getCommerceTelegramBotToken();
  if (!token) return false;
  await getPlatformBot();
  if (platformCache?.webhookOk) return true;
  try {
    await tg(token, 'setWebhook', { url: `${publicBaseUrl()}/api/commerce/tg/webhook`, secret_token: platformWebhookSecret(token), allowed_updates: ['message', 'my_chat_member'], drop_pending_updates: false });
    if (platformCache) platformCache.webhookOk = true;
    return true;
  } catch (e) {
    console.warn('[commerce/notify] setWebhook не прошёл:', (e as Error).message);
    return false;
  }
}

export async function createLinkCode(tenantId: string): Promise<string> {
  const code = randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || randomBytes(8).toString('hex');
  if (isFallbackActive()) { memLinks.set(code, { tenantId, at: Date.now() }); return code; }
  await pool.query(`INSERT INTO commerce_tg_links (code, tenant_id) VALUES ($1, $2)`, [code, tenantId]);
  return code;
}

async function consumeLinkCode(code: string): Promise<string | null> {
  if (isFallbackActive()) { const l = memLinks.get(code); if (!l || Date.now() - l.at > 30 * 60_000) return null; memLinks.delete(code); return l.tenantId; }
  const r = await pool.query(`UPDATE commerce_tg_links SET used_at = now() WHERE code = $1 AND used_at IS NULL AND created_at > now() - interval '30 minutes' RETURNING tenant_id`, [code]);
  return (r.rows as any[])[0]?.tenant_id || null;
}

async function brandOf(tenantId: string): Promise<string> {
  if (isFallbackActive()) return '';
  try { const r = await pool.query(`SELECT brand_name FROM commerce_settings WHERE tenant_id = $1`, [tenantId]); return (r.rows as any[])[0]?.brand_name || ''; } catch { return ''; }
}

/** Язык владельца витрины для сообщений бота: язык кабинета → явный язык витрины → null (возьмём язык из Telegram). */
async function langOf(tenantId: string): Promise<string | null> {
  if (isFallbackActive()) return null;
  try {
    const r = await pool.query(`SELECT owner_lang, language FROM commerce_settings WHERE tenant_id = $1`, [tenantId]);
    const row = (r.rows as any[])[0];
    const l = row?.owner_lang || (row?.language && row.language !== 'auto' ? row.language : '');
    return l ? normalizeLang(l) : null;
  } catch { return null; }
}

/** Убрать чат из всех витрин (пользователь нажал /stop или заблокировал бота). */
async function unlinkChatEverywhere(chatId: string): Promise<number> {
  if (isFallbackActive()) return 0;
  const r = await pool.query(`SELECT tenant_id, notify_telegram FROM commerce_settings WHERE notify_telegram IS NOT NULL AND notify_telegram::text LIKE $1`, [`%"${chatId}"%`]);
  let n = 0;
  for (const row of r.rows as any[]) {
    const st: Stored = (typeof row.notify_telegram === 'string' ? JSON.parse(row.notify_telegram) : row.notify_telegram) || {};
    const before = st.subscribers?.length || 0;
    st.subscribers = (st.subscribers || []).filter((x) => x.chatId !== chatId);
    if (before !== st.subscribers.length) { await writeStored(row.tenant_id, st); n++; }
  }
  return n;
}

/** Обработка апдейта от бота платформы (webhook). */
export async function handlePlatformUpdate(update: any): Promise<void> {
  const token = getCommerceTelegramBotToken();
  if (!token) return;
  const member = update?.my_chat_member;
  if (member?.chat && ['kicked', 'left'].includes(String(member.new_chat_member?.status || ''))) { await unlinkChatEverywhere(String(member.chat.id)); return; }
  const msg = update?.message;
  if (!msg?.chat) return;
  const chatId = String(msg.chat.id);
  const text = String(msg.text || '').trim();
  const userLang = normalizeLang(String(msg.from?.language_code || 'ru'));
  const start = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{4,64})/.exec(text);
  const say = (t: string) => tg(token, 'sendMessage', { chat_id: chatId, text: t, disable_web_page_preview: true }).catch(() => {});
  if (start) {
    const tenantId = await consumeLinkCode(start[1]);
    if (!tenantId) { await say(tw(userLang, 'srv.tg.linkExpired')); return; }
    const st = await readStored(tenantId);
    const subs = new Map((st.subscribers || []).map((x) => [x.chatId, x]));
    subs.set(chatId, { chatId, name: msg.chat.title || [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(' ') || msg.chat.username || chatId, username: msg.chat.username || null, via: 'platform' });
    await writeStored(tenantId, { ...st, subscribers: Array.from(subs.values()) });
    const brand = await brandOf(tenantId);
    { const l = (await langOf(tenantId)) || userLang; await say(brand ? tw(l, 'srv.tg.linkedBrand', { brand }) : tw(l, 'srv.tg.linked')); }
    return;
  }
  if (/^\/stop/.test(text)) { const n = await unlinkChatEverywhere(chatId); await say(tw(userLang, n ? 'srv.tg.stopped' : 'srv.tg.notLinked')); return; }
  if (/^\/start/.test(text)) await say(tw(userLang, 'srv.tg.start'));
}
