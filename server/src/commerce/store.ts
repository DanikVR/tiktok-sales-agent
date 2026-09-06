/**
 * Commerce Agents — хранилище диалогов, сообщений (в формате Messages API для продолжения),
 * заявок, событий (для отчётов), staged-изменений и памяти покупателя/владельца.
 * Всё под tenant_id. В fallback-режиме (без PG) — минимальная in-memory реализация.
 */

import { randomUUID } from 'crypto';
import pool, { isFallbackActive } from '../db.js';
import type { Cart, Conversation, Lead, LeadKind, LeadStatus, StagedChange, ChangeKind, ChangeItem } from './types.js';

const memConversations = new Map<string, any>();
const memMessages = new Map<string, any[]>();
const memLeads: any[] = [];
const memEvents: any[] = [];
const memChanges: any[] = [];
const memMemory = new Map<string, any>();

function iso(v: any): string { return v instanceof Date ? v.toISOString() : String(v || ''); }
function jsonb(v: any, dflt: any) { if (v == null) return dflt; if (typeof v === 'string') { try { return JSON.parse(v); } catch { return dflt; } } return v; }

function mapConversation(r: any): Conversation {
  return {
    id: r.id, tenant_id: r.tenant_id, visitor_id: r.visitor_id, channel: r.channel || 'widget', page_url: r.page_url || null, lang: r.lang || null,
    cart: jsonb(r.cart, { items: [], currency: 'RUB' }), seen_ids: jsonb(r.seen_ids, []), status: r.status || 'open', summary: r.summary || null,
    message_count: Number(r.message_count || 0), turn_count: Number(r.turn_count || 0),
    usage: jsonb(r.usage, { input: 0, output: 0, cache_read: 0, cache_write: 0 }),
    started_at: iso(r.started_at), last_at: iso(r.last_at),
  };
}

// ── conversations ───────────────────────────────────────────────────────────

export async function getConversation(tenantId: string, id: string): Promise<Conversation | null> {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (isFallbackActive()) { const c = memConversations.get(id); return c && c.tenant_id === tenantId ? mapConversation(c) : null; }
  const r = await pool.query(`SELECT * FROM commerce_conversations WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [tenantId, id]);
  const row = (r.rows as any[])[0];
  return row ? mapConversation(row) : null;
}

export async function createConversation(tenantId: string, input: { visitorId: string; channel: 'widget' | 'merchant'; pageUrl?: string | null; lang?: string | null; currency: string }): Promise<Conversation> {
  const cart: Cart = { items: [], currency: input.currency };
  if (isFallbackActive()) {
    const c = { id: randomUUID(), tenant_id: tenantId, visitor_id: input.visitorId, channel: input.channel, page_url: input.pageUrl || null, lang: input.lang || null, cart, seen_ids: [], status: 'open', message_count: 0, turn_count: 0, usage: null, started_at: new Date(), last_at: new Date() };
    memConversations.set(c.id, c); return mapConversation(c);
  }
  const r = await pool.query(
    `INSERT INTO commerce_conversations (tenant_id, visitor_id, channel, page_url, lang, cart, seen_ids)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, '[]'::jsonb) RETURNING *`,
    [tenantId, input.visitorId, input.channel, input.pageUrl || null, input.lang || null, JSON.stringify(cart)],
  );
  return mapConversation((r.rows as any[])[0]);
}

export async function saveConversationState(c: Conversation, patch: { cart?: Cart; seen_ids?: string[]; page_url?: string | null; usage?: Conversation['usage']; message_count_add?: number; turn_add?: number; summary?: string | null }): Promise<void> {
  if (isFallbackActive()) {
    const m = memConversations.get(c.id); if (!m) return;
    if (patch.cart) m.cart = patch.cart; if (patch.seen_ids) m.seen_ids = patch.seen_ids; if (patch.page_url !== undefined) m.page_url = patch.page_url;
    if (patch.usage) m.usage = patch.usage; m.message_count = (m.message_count || 0) + (patch.message_count_add || 0); m.turn_count = (m.turn_count || 0) + (patch.turn_add || 0);
    if (patch.summary !== undefined) m.summary = patch.summary; m.last_at = new Date();
    return;
  }
  await pool.query(
    `UPDATE commerce_conversations SET
       cart = COALESCE($3::jsonb, cart), seen_ids = COALESCE($4::jsonb, seen_ids), page_url = COALESCE($5, page_url),
       usage = COALESCE($6::jsonb, usage), message_count = message_count + $7, turn_count = turn_count + $8,
       summary = COALESCE($9, summary), last_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [c.tenant_id, c.id, patch.cart ? JSON.stringify(patch.cart) : null, patch.seen_ids ? JSON.stringify(patch.seen_ids) : null, patch.page_url ?? null,
      patch.usage ? JSON.stringify(patch.usage) : null, patch.message_count_add || 0, patch.turn_add || 0, patch.summary ?? null],
  );
}

export async function listConversations(tenantId: string, opts: { channel?: 'widget' | 'merchant'; limit?: number; page?: number; q?: string } = {}): Promise<{ items: Array<Conversation & { preview: string | null; lead_count: number; push_count: number }>; total: number }> {
  const limit = Math.min(100, Math.max(1, opts.limit || 30));
  const page = Math.max(1, opts.page || 1);
  const channel = opts.channel || 'widget';
  if (isFallbackActive()) {
    const all = Array.from(memConversations.values()).filter((c) => c.tenant_id === tenantId && c.channel === channel).sort((a, b) => +new Date(b.last_at) - +new Date(a.last_at));
    return { items: all.slice((page - 1) * limit, page * limit).map((c) => ({ ...mapConversation(c), preview: null, lead_count: 0, push_count: 0 })), total: all.length };
  }
  // Поиск (?q=): по тексту сообщений, адресу страницы и id диалога.
  const q = String(opts.q || '').trim().slice(0, 100);
  const where = `c.tenant_id = $1 AND c.channel = $2` + (q ? ` AND (c.id::text ILIKE $3 OR coalesce(c.page_url, '') ILIKE $3 OR EXISTS (SELECT 1 FROM commerce_messages m WHERE m.conversation_id = c.id AND coalesce(m.display->>'text', '') ILIKE $3))` : '');
  const base: any[] = q ? [tenantId, channel, `%${q}%`] : [tenantId, channel];
  const total = await pool.query(`SELECT count(*)::int AS n FROM commerce_conversations c WHERE ${where}`, base);
  const r = await pool.query(
    `SELECT c.*,
       (SELECT m.display->>'text' FROM commerce_messages m WHERE m.conversation_id = c.id AND m.role = 'user' ORDER BY m.created_at ASC LIMIT 1) AS preview,
       (SELECT count(*)::int FROM commerce_leads l WHERE l.conversation_id = c.id) AS lead_count,
       (SELECT count(*)::int FROM commerce_push_subs p WHERE p.tenant_id = c.tenant_id AND p.disabled_at IS NULL AND (p.conversation_id = c.id OR p.visitor_id = c.visitor_id)) AS push_count
     FROM commerce_conversations c WHERE ${where}
     ORDER BY c.last_at DESC LIMIT $${base.length + 1} OFFSET $${base.length + 2}`,
    [...base, limit, (page - 1) * limit],
  );
  return { items: (r.rows as any[]).map((row) => ({ ...mapConversation(row), preview: row.preview || null, lead_count: Number(row.lead_count || 0), push_count: Number(row.push_count || 0) })), total: (total.rows as any[])[0]?.n || 0 };
}

// ── messages (API-формат + display для кабинета) ────────────────────────────

export interface StoredMessage { id: string; role: string; turn: number; content: any; display: { text?: string; components?: any[] } | null; created_at: string }

export async function loadApiHistory(tenantId: string, conversationId: string, maxTurns = 8): Promise<any[]> {
  if (isFallbackActive()) {
    const all = memMessages.get(conversationId) || [];
    const maxTurn = all.reduce((m, x) => Math.max(m, x.turn), 0);
    return all.filter((x) => x.turn > maxTurn - maxTurns && x.api).map((x) => x.api);
  }
  const r = await pool.query(
    `SELECT api FROM commerce_messages
     WHERE tenant_id = $1 AND conversation_id = $2 AND api IS NOT NULL
       AND turn > (SELECT COALESCE(MAX(turn), 0) FROM commerce_messages WHERE conversation_id = $2) - $3
     ORDER BY created_at ASC, seq ASC`,
    [tenantId, conversationId, maxTurns],
  );
  return (r.rows as any[]).map((row) => jsonb(row.api, null)).filter(Boolean);
}

export async function appendTurnMessages(tenantId: string, conversationId: string, turn: number, apiMessages: any[], display: { userText: string; assistantText: string; components: any[] }): Promise<void> {
  const rows: Array<{ role: string; api: any | null; display: any | null }> = [];
  apiMessages.forEach((m, i) => {
    const isFirst = i === 0;
    const isLast = i === apiMessages.length - 1;
    rows.push({
      role: m.role === 'assistant' ? 'assistant' : (typeof m.content === 'string' ? 'user' : 'tool'),
      api: m,
      display: isFirst ? { text: display.userText } : (isLast && m.role === 'assistant' ? { text: display.assistantText, components: display.components } : null),
    });
  });
  if (rows.length && rows[rows.length - 1].display == null) {
    // последний элемент может быть tool-результатом при обрыве — привяжем display к последнему assistant
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i].role === 'assistant') { rows[i].display = { text: display.assistantText, components: display.components }; break; }
  }
  if (isFallbackActive()) {
    const list = memMessages.get(conversationId) || [];
    rows.forEach((r, seq) => list.push({ id: randomUUID(), role: r.role, turn, seq, api: r.api, display: r.display, created_at: new Date() }));
    memMessages.set(conversationId, list);
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let seq = 0;
    for (const r of rows) {
      await client.query(
        `INSERT INTO commerce_messages (tenant_id, conversation_id, role, turn, seq, api, display) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
        [tenantId, conversationId, r.role, turn, seq++, JSON.stringify(r.api), r.display ? JSON.stringify(r.display) : null],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function listDisplayMessages(tenantId: string, conversationId: string): Promise<StoredMessage[]> {
  if (isFallbackActive()) return (memMessages.get(conversationId) || []).filter((x) => x.display).map((x) => ({ id: x.id, role: x.role, turn: x.turn, content: null, display: x.display, created_at: iso(x.created_at) }));
  const r = await pool.query(`SELECT id, role, turn, display, created_at FROM commerce_messages WHERE tenant_id = $1 AND conversation_id = $2 AND display IS NOT NULL ORDER BY created_at ASC, seq ASC LIMIT 500`, [tenantId, conversationId]);
  return (r.rows as any[]).map((row) => ({ id: row.id, role: row.role, turn: row.turn, content: null, display: jsonb(row.display, null), created_at: iso(row.created_at) }));
}

// ── events ──────────────────────────────────────────────────────────────────

export type EventKind = 'card_shown' | 'card_click' | 'add_to_cart' | 'checkout_staged' | 'checkout_click' | 'purchase' | 'search_empty' | 'lead' | 'widget_open';

export async function logEvent(tenantId: string, kind: EventKind, data: { conversationId?: string | null; productId?: string | null; payload?: Record<string, unknown> }): Promise<void> {
  try {
    if (isFallbackActive()) { memEvents.push({ tenant_id: tenantId, kind, conversation_id: data.conversationId || null, product_id: data.productId || null, payload: data.payload || {}, created_at: new Date() }); return; }
    await pool.query(
      `INSERT INTO commerce_events (tenant_id, kind, conversation_id, product_id, payload) VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [tenantId, kind, data.conversationId || null, data.productId && /^[0-9a-f-]{36}$/i.test(data.productId) ? data.productId : null, JSON.stringify(data.payload || {})],
    );
  } catch (err) {
    console.warn('[commerce/store] logEvent failed:', (err as Error).message);
  }
}

// ── leads ───────────────────────────────────────────────────────────────────

function mapLead(r: any): Lead {
  return { id: r.id, tenant_id: r.tenant_id, conversation_id: r.conversation_id || null, kind: r.kind, status: r.status || 'new', items: jsonb(r.items, []), total: r.total != null ? Number(r.total) : null, currency: r.currency || null, contact: jsonb(r.contact, {}), note: r.note || null, created_at: iso(r.created_at), updated_at: iso(r.updated_at) };
}

export async function createLead(tenantId: string, input: { conversationId?: string | null; kind: LeadKind; items?: any[]; total?: number | null; currency?: string | null; contact?: Record<string, string>; note?: string | null }): Promise<Lead> {
  if (isFallbackActive()) {
    const l = { id: randomUUID(), tenant_id: tenantId, conversation_id: input.conversationId || null, kind: input.kind, status: 'new', items: input.items || [], total: input.total ?? null, currency: input.currency || null, contact: input.contact || {}, note: input.note || null, created_at: new Date(), updated_at: new Date() };
    memLeads.push(l); return mapLead(l);
  }
  const r = await pool.query(
    `INSERT INTO commerce_leads (tenant_id, conversation_id, kind, items, total, currency, contact, note)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8) RETURNING *`,
    [tenantId, input.conversationId && /^[0-9a-f-]{36}$/i.test(input.conversationId) ? input.conversationId : null, input.kind, JSON.stringify(input.items || []), input.total ?? null, input.currency || null, JSON.stringify(input.contact || {}), input.note || null],
  );
  return mapLead((r.rows as any[])[0]);
}

export async function listLeads(tenantId: string, opts: { limit?: number; page?: number; status?: LeadStatus; kind?: LeadKind } = {}): Promise<{ items: Lead[]; total: number }> {
  const limit = Math.min(100, Math.max(1, opts.limit || 30));
  const page = Math.max(1, opts.page || 1);
  if (isFallbackActive()) {
    const all = memLeads.filter((l) => l.tenant_id === tenantId && (!opts.status || l.status === opts.status) && (!opts.kind || l.kind === opts.kind)).sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    return { items: all.slice((page - 1) * limit, page * limit).map(mapLead), total: all.length };
  }
  const where = ['tenant_id = $1']; const vals: any[] = [tenantId];
  if (opts.status) { vals.push(opts.status); where.push(`status = $${vals.length}`); }
  if (opts.kind) { vals.push(opts.kind); where.push(`kind = $${vals.length}`); }
  const total = await pool.query(`SELECT count(*)::int AS n FROM commerce_leads WHERE ${where.join(' AND ')}`, vals);
  vals.push(limit, (page - 1) * limit);
  const r = await pool.query(`SELECT * FROM commerce_leads WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $${vals.length - 1} OFFSET $${vals.length}`, vals);
  return { items: (r.rows as any[]).map(mapLead), total: (total.rows as any[])[0]?.n || 0 };
}

export async function updateLeadStatus(tenantId: string, id: string, status: LeadStatus, note?: string | null): Promise<Lead | null> {
  if (isFallbackActive()) { const l = memLeads.find((x) => x.id === id && x.tenant_id === tenantId); if (!l) return null; l.status = status; if (note !== undefined) l.note = note; l.updated_at = new Date(); return mapLead(l); }
  const r = await pool.query(`UPDATE commerce_leads SET status = $3, note = COALESCE($4, note), updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING *`, [tenantId, id, status, note ?? null]);
  const row = (r.rows as any[])[0];
  return row ? mapLead(row) : null;
}

/** Последний диалог посетителя за окно атрибуции (для пикселя покупки). */
export async function findRecentConversationByVisitor(tenantId: string, visitorId: string, days = 7): Promise<string | null> {
  if (!visitorId) return null;
  if (isFallbackActive()) {
    const c = Array.from(memConversations.values()).filter((x) => x.tenant_id === tenantId && x.visitor_id === visitorId).sort((a, b) => +new Date(b.last_at) - +new Date(a.last_at))[0];
    return c?.id || null;
  }
  const r = await pool.query(`SELECT id FROM commerce_conversations WHERE tenant_id = $1 AND visitor_id = $2 AND last_at > now() - ($3::int * interval '1 day') ORDER BY last_at DESC LIMIT 1`, [tenantId, visitorId, days]);
  return (r.rows as any[])[0]?.id || null;
}

// ── staged changes ──────────────────────────────────────────────────────────

function mapChange(r: any): StagedChange {
  return { id: r.id, tenant_id: r.tenant_id, kind: r.kind, items: jsonb(r.items, []), note: r.note || null, status: r.status || 'staged', created_by: r.created_by || 'agent', created_at: iso(r.created_at), applied_at: r.applied_at ? iso(r.applied_at) : null };
}

export async function createChange(tenantId: string, kind: ChangeKind, items: ChangeItem[], note: string | null, createdBy = 'agent'): Promise<StagedChange> {
  if (isFallbackActive()) { const c = { id: randomUUID(), tenant_id: tenantId, kind, items, note, status: 'staged', created_by: createdBy, created_at: new Date(), applied_at: null }; memChanges.push(c); return mapChange(c); }
  const r = await pool.query(`INSERT INTO commerce_changes (tenant_id, kind, items, note, created_by) VALUES ($1, $2, $3::jsonb, $4, $5) RETURNING *`, [tenantId, kind, JSON.stringify(items), note, createdBy]);
  return mapChange((r.rows as any[])[0]);
}

export async function getChange(tenantId: string, id: string): Promise<StagedChange | null> {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (isFallbackActive()) { const c = memChanges.find((x) => x.id === id && x.tenant_id === tenantId); return c ? mapChange(c) : null; }
  const r = await pool.query(`SELECT * FROM commerce_changes WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [tenantId, id]);
  const row = (r.rows as any[])[0];
  return row ? mapChange(row) : null;
}

export async function listChanges(tenantId: string, status?: 'staged' | 'applied' | 'discarded', limit = 50): Promise<StagedChange[]> {
  if (isFallbackActive()) return memChanges.filter((x) => x.tenant_id === tenantId && (!status || x.status === status)).slice(-limit).reverse().map(mapChange);
  const vals: any[] = [tenantId]; let where = 'tenant_id = $1';
  if (status) { vals.push(status); where += ` AND status = $${vals.length}`; }
  vals.push(limit);
  const r = await pool.query(`SELECT * FROM commerce_changes WHERE ${where} ORDER BY created_at DESC LIMIT $${vals.length}`, vals);
  return (r.rows as any[]).map(mapChange);
}

export async function setChangeStatus(tenantId: string, id: string, status: 'applied' | 'discarded'): Promise<StagedChange | null> {
  if (isFallbackActive()) { const c = memChanges.find((x) => x.id === id && x.tenant_id === tenantId && x.status === 'staged'); if (!c) return null; c.status = status; if (status === 'applied') c.applied_at = new Date(); return mapChange(c); }
  const r = await pool.query(`UPDATE commerce_changes SET status = $3, applied_at = CASE WHEN $3 = 'applied' THEN now() ELSE applied_at END WHERE tenant_id = $1 AND id = $2 AND status = 'staged' RETURNING *`, [tenantId, id, status]);
  const row = (r.rows as any[])[0];
  return row ? mapChange(row) : null;
}

// ── memory ──────────────────────────────────────────────────────────────────

export interface MemoryFact { key: string; value: string; category: string; updated_at?: string }

export async function listMemory(tenantId: string, subjectId: string, opts: { onlyConstraints?: boolean; topic?: string; limit?: number } = {}): Promise<MemoryFact[]> {
  const limit = Math.min(50, opts.limit || 20);
  if (isFallbackActive()) {
    return Array.from(memMemory.values()).filter((m) => m.tenant_id === tenantId && m.subject_id === subjectId && (!opts.onlyConstraints || m.category === 'constraint') && (!opts.topic || `${m.key} ${m.value}`.toLowerCase().includes(opts.topic.toLowerCase()))).slice(0, limit);
  }
  const vals: any[] = [tenantId, subjectId]; let where = 'tenant_id = $1 AND subject_id = $2';
  if (opts.onlyConstraints) where += ` AND category = 'constraint'`;
  if (opts.topic) { vals.push(`%${opts.topic}%`); where += ` AND (key ILIKE $${vals.length} OR value ILIKE $${vals.length})`; }
  vals.push(limit);
  const r = await pool.query(`SELECT key, value, category, updated_at FROM commerce_memory WHERE ${where} ORDER BY updated_at DESC LIMIT $${vals.length}`, vals);
  return (r.rows as any[]).map((row) => ({ key: row.key, value: row.value, category: row.category, updated_at: iso(row.updated_at) }));
}

export async function saveMemory(tenantId: string, subjectId: string, key: string, value: string, category: string): Promise<void> {
  const k = String(key || '').trim().slice(0, 64); const v = String(value || '').trim().slice(0, 300);
  if (!k) return;
  const cat = ['preference', 'constraint', 'context'].includes(category) ? category : 'preference';
  const mk = `${tenantId}|${subjectId}|${k}`;
  if (isFallbackActive()) { if (!v) memMemory.delete(mk); else memMemory.set(mk, { tenant_id: tenantId, subject_id: subjectId, key: k, value: v, category: cat, updated_at: new Date().toISOString() }); return; }
  if (!v) { await pool.query(`DELETE FROM commerce_memory WHERE tenant_id = $1 AND subject_id = $2 AND key = $3`, [tenantId, subjectId, k]); return; }
  await pool.query(
    `INSERT INTO commerce_memory (tenant_id, subject_id, key, value, category) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, subject_id, key) DO UPDATE SET value = EXCLUDED.value, category = EXCLUDED.category, updated_at = now()`,
    [tenantId, subjectId, k, v, cat],
  );
}

// ── stats (для кабинета и агента владельца) ─────────────────────────────────

export interface Snapshot {
  period_days: number;
  current: Record<string, number>;
  previous: Record<string, number>;
  top_products: Array<{ product_id: string; title: string | null; clicks: number; add_to_cart: number }>;
  empty_searches: Array<{ query: string; count: number }>;
}

const EVENT_METRICS: Record<string, string> = { cards_shown: 'card_shown', card_clicks: 'card_click', add_to_cart: 'add_to_cart', checkouts: 'checkout_staged', purchases: 'purchase', empty_searches: 'search_empty', widget_opens: 'widget_open' };

export async function getSnapshot(tenantId: string, periodDays: number): Promise<Snapshot> {
  const days = [1, 7, 14, 30, 90].includes(periodDays) ? periodDays : 7;
  const empty = (): Record<string, number> => ({ dialogs: 0, messages: 0, cards_shown: 0, card_clicks: 0, add_to_cart: 0, checkouts: 0, leads: 0, purchases: 0, revenue: 0, empty_searches: 0, widget_opens: 0 });
  if (isFallbackActive()) return { period_days: days, current: empty(), previous: empty(), top_products: [], empty_searches: [] };
  const win = async (fromDays: number, toDays: number): Promise<Record<string, number>> => {
    const out = empty();
    const conv = await pool.query(`SELECT count(*)::int AS n, COALESCE(sum(message_count),0)::int AS m FROM commerce_conversations WHERE tenant_id = $1 AND channel = 'widget' AND started_at > now() - ($2::int * interval '1 day') AND started_at <= now() - ($3::int * interval '1 day')`, [tenantId, fromDays, toDays]);
    out.dialogs = (conv.rows as any[])[0]?.n || 0; out.messages = (conv.rows as any[])[0]?.m || 0;
    const ev = await pool.query(`SELECT kind, count(*)::int AS n FROM commerce_events WHERE tenant_id = $1 AND created_at > now() - ($2::int * interval '1 day') AND created_at <= now() - ($3::int * interval '1 day') GROUP BY kind`, [tenantId, fromDays, toDays]);
    for (const row of ev.rows as any[]) { const key = Object.keys(EVENT_METRICS).find((k) => EVENT_METRICS[k] === row.kind); if (key) out[key] = row.n; }
    const leads = await pool.query(`SELECT kind, count(*)::int AS n, COALESCE(sum(total),0)::float AS revenue FROM commerce_leads WHERE tenant_id = $1 AND created_at > now() - ($2::int * interval '1 day') AND created_at <= now() - ($3::int * interval '1 day') GROUP BY kind`, [tenantId, fromDays, toDays]);
    for (const row of leads.rows as any[]) {
      if (row.kind === 'purchase') { out.purchases = row.n; out.revenue = Math.round(Number(row.revenue) * 100) / 100; }
      else if (row.kind === 'callback') out.leads += row.n;
    }
    return out;
  };
  const current = await win(days, 0);
  const previous = await win(days * 2, days);
  const top = await pool.query(
    `SELECT e.product_id, p.title, sum(CASE WHEN e.kind = 'card_click' THEN 1 ELSE 0 END)::int AS clicks, sum(CASE WHEN e.kind = 'add_to_cart' THEN 1 ELSE 0 END)::int AS add_to_cart
     FROM commerce_events e LEFT JOIN commerce_products p ON p.id = e.product_id
     WHERE e.tenant_id = $1 AND e.product_id IS NOT NULL AND e.kind IN ('card_click','add_to_cart') AND e.created_at > now() - ($2::int * interval '1 day')
     GROUP BY e.product_id, p.title ORDER BY add_to_cart DESC, clicks DESC LIMIT 10`,
    [tenantId, days],
  );
  const emptyQ = await pool.query(
    `SELECT payload->>'query' AS query, count(*)::int AS n FROM commerce_events WHERE tenant_id = $1 AND kind = 'search_empty' AND created_at > now() - ($2::int * interval '1 day') GROUP BY payload->>'query' ORDER BY n DESC LIMIT 15`,
    [tenantId, days],
  );
  return {
    period_days: days,
    current,
    previous,
    top_products: (top.rows as any[]).map((r) => ({ product_id: r.product_id, title: r.title || null, clicks: r.clicks, add_to_cart: r.add_to_cart })),
    empty_searches: (emptyQ.rows as any[]).filter((r) => r.query).map((r) => ({ query: r.query, count: r.n })),
  };
}

export async function getSeries(tenantId: string, metric: string, periodDays: number, productId?: string | null): Promise<Array<{ date: string; value: number }>> {
  const days = Math.min(90, Math.max(1, periodDays || 7));
  if (isFallbackActive()) return [];
  if (metric === 'dialogs' || metric === 'messages') {
    const r = await pool.query(`SELECT to_char(started_at::date, 'YYYY-MM-DD') AS d, ${metric === 'dialogs' ? 'count(*)::int' : 'COALESCE(sum(message_count),0)::int'} AS v FROM commerce_conversations WHERE tenant_id = $1 AND channel = 'widget' AND started_at > now() - ($2::int * interval '1 day') GROUP BY 1 ORDER BY 1`, [tenantId, days]);
    return (r.rows as any[]).map((x) => ({ date: x.d, value: x.v }));
  }
  if (metric === 'leads' || metric === 'purchases' || metric === 'revenue') {
    const kind = metric === 'leads' ? 'callback' : 'purchase';
    const r = await pool.query(`SELECT to_char(created_at::date, 'YYYY-MM-DD') AS d, ${metric === 'revenue' ? 'COALESCE(sum(total),0)::float' : 'count(*)::int'} AS v FROM commerce_leads WHERE tenant_id = $1 AND kind = $3 AND created_at > now() - ($2::int * interval '1 day') GROUP BY 1 ORDER BY 1`, [tenantId, days, kind]);
    return (r.rows as any[]).map((x) => ({ date: x.d, value: Number(x.v) }));
  }
  const kind = EVENT_METRICS[metric];
  if (!kind) return [];
  const vals: any[] = [tenantId, days, kind]; let extra = '';
  if (productId && /^[0-9a-f-]{36}$/i.test(productId)) { vals.push(productId); extra = ` AND product_id = $${vals.length}`; }
  const r = await pool.query(`SELECT to_char(created_at::date, 'YYYY-MM-DD') AS d, count(*)::int AS v FROM commerce_events WHERE tenant_id = $1 AND kind = $3 AND created_at > now() - ($2::int * interval '1 day')${extra} GROUP BY 1 ORDER BY 1`, vals);
  return (r.rows as any[]).map((x) => ({ date: x.d, value: x.v }));
}

export async function productStats30d(tenantId: string, productId: string): Promise<{ clicks: number; add_to_cart: number; cards_shown: number }> {
  if (isFallbackActive() || !/^[0-9a-f-]{36}$/i.test(productId)) return { clicks: 0, add_to_cart: 0, cards_shown: 0 };
  const r = await pool.query(`SELECT kind, count(*)::int AS n FROM commerce_events WHERE tenant_id = $1 AND product_id = $2 AND created_at > now() - interval '30 days' GROUP BY kind`, [tenantId, productId]);
  const out = { clicks: 0, add_to_cart: 0, cards_shown: 0 };
  for (const row of r.rows as any[]) { if (row.kind === 'card_click') out.clicks = row.n; if (row.kind === 'add_to_cart') out.add_to_cart = row.n; if (row.kind === 'card_shown') out.cards_shown = row.n; }
  return out;
}
