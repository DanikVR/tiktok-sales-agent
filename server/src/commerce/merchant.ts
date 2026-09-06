/**
 * Commerce Agents — агент владельца: исполнители инструментов, guardrails staged-изменений и
 * оркестрация хода. Правила из blueprint: ни одна запись не уходит в живой каталог из чата —
 * только staged-изменение с preview-картой, применить может владелец кнопкой в панели
 * «Изменения»; staging принимает только id, прочитанные в этом разговоре; лимиты проверяются
 * при staging и повторно при apply (цена ±30%, ≤ 25 позиций).
 */

import { runAgentTurn, type TurnUsage } from './agent.js';
import { MERCHANT_FENCE, sanitizeChips } from './fence.js';
import { buildMerchantSystem, buildMerchantContext, MERCHANT_SKILLS } from './prompts.js';
import { buildMerchantTools } from './tools.js';
import { countProducts, getProduct, getProductsByIds, getVariants, listProducts, updateProduct } from './catalog.js';
import pool, { isFallbackActive } from '../db.js';
import { mapProduct } from './catalog.js';
import { getConversation, createConversation, saveConversationState, loadApiHistory, appendTurnMessages, listMemory, saveMemory, getSnapshot, getSeries, productStats30d, createChange, getChange, listChanges, setChangeStatus } from './store.js';
import { makeAnthropicClient, resolveAnthropicKey, merchantModel } from './anthropic.js';
import type { AgentEvent, ChangeItem, CommerceProduct, CommerceSettings, Conversation, StagedChange, ToolOutcome } from './types.js';

export const MAX_PRICE_DELTA_PCT = 30;
export const MAX_ITEMS_PER_CHANGE = 25;
const MERCHANT_SUBJECT = 'merchant';

function listingRow(p: CommerceProduct) {
  const flags: string[] = [];
  if (!p.description) flags.push('missing_description');
  if (!p.image_url) flags.push('missing_image');
  if (!p.category) flags.push('missing_category');
  if (!p.in_stock) flags.push('out_of_stock');
  else if (p.stock != null && p.stock <= 3) flags.push('low_stock');
  if (!p.active) flags.push('inactive');
  return {
    listing_id: p.id, title: p.title, brand: p.brand || undefined, price: p.price, currency: p.currency, compare_at_price: p.compare_at_price || undefined,
    in_stock: p.in_stock, stock: p.stock ?? undefined, category: p.category || undefined, active: p.active,
    has_options: Object.keys(p.options).length > 0, variant_of: p.variant_of || undefined, quality_flags: flags,
  };
}

/** Guardrails: возвращают список нарушений (пусто = можно). Проверяются и при staging, и при apply. */
export function checkGuardrails(kind: StagedChange['kind'], items: ChangeItem[]): string[] {
  const v: string[] = [];
  if (items.length > MAX_ITEMS_PER_CHANGE) v.push(`change touches ${items.length} items and the limit is ${MAX_ITEMS_PER_CHANGE} per change; stage it as separate changes`);
  const seen = new Set<string>();
  for (const it of items) {
    const key = `${it.target}|${it.field}`;
    if (seen.has(key)) v.push(`'${it.field}' on ${it.target} appears more than once in this change`);
    seen.add(key);
    if (kind === 'price_update' && it.field === 'price') {
      const before = Number(it.before); const after = Number(it.after);
      if (!Number.isFinite(after) || after <= 0) v.push(`price for ${it.target} must be a positive amount`);
      else if (!Number.isFinite(before) || before <= 0) v.push(`price for ${it.target} has no grounded current price`);
      else {
        const delta = Math.abs(after - before) / before * 100;
        if (delta > MAX_PRICE_DELTA_PCT) v.push(`price move of ${delta.toFixed(0)}% on ${it.target} exceeds the ${MAX_PRICE_DELTA_PCT}% limit per change`);
      }
    }
    if (kind === 'listing_update' && ['price', 'stock', 'in_stock', 'active', 'currency', 'sku', 'external_id'].includes(it.field)) {
      v.push(`'${it.field}' cannot be changed through a listing update — use the price or inventory tool`);
    }
  }
  return v;
}

/** Применение staged-изменения (кнопка владельца). Повторно проверяет guardrails. */
export async function applyChange(tenantId: string, changeId: string): Promise<{ ok: boolean; error?: string; change?: StagedChange }> {
  const change = await getChange(tenantId, changeId);
  if (!change) return { ok: false, error: 'not_found' };
  if (change.status !== 'staged') return { ok: false, error: `already_${change.status}` };
  const violations = checkGuardrails(change.kind, change.items);
  if (violations.length) return { ok: false, error: violations.join('; ') };
  const byTarget = new Map<string, ChangeItem[]>();
  for (const it of change.items) byTarget.set(it.target, [...(byTarget.get(it.target) || []), it]);
  for (const [target, items] of byTarget) {
    const p = await getProduct(tenantId, target);
    if (!p) return { ok: false, error: `listing ${target} no longer exists` };
    const patch: any = {};
    for (const it of items) {
      if (it.field.startsWith('attributes.')) { patch.attributes = { ...(patch.attributes || p.attributes), [it.field.slice(11)]: String(it.after ?? '') }; continue; }
      if (it.field === 'price') { if (Number(it.before) !== Number(p.price)) return { ok: false, error: `price of ${p.title} changed since staging (${p.price} now); restage` }; }
      patch[it.field] = it.after;
    }
    if (patch.in_stock === false) patch.in_stock = false;
    await updateProduct(tenantId, target, patch);
  }
  const updated = await setChangeStatus(tenantId, changeId, 'applied');
  return { ok: true, change: updated || change };
}

export interface MerchantTurnInput {
  settings: CommerceSettings;
  conversationId?: string | null;
  operatorId: string;
  message: string;
  lang?: string | null;
  emit: (e: AgentEvent) => void;
}

export async function runMerchantTurn(input: MerchantTurnInput): Promise<{ conversationId: string; text: string; usage: TurnUsage }> {
  const { settings, emit } = input;
  const tenantId = settings.tenant_id;
  const keyInfo = await resolveAnthropicKey(tenantId);
  if (!keyInfo) throw new Error('assistant_not_configured');
  const client = makeAnthropicClient(keyInfo.key);

  let conv: Conversation | null = input.conversationId ? await getConversation(tenantId, input.conversationId) : null;
  if (conv && conv.channel !== 'merchant') conv = null;
  if (!conv) conv = await createConversation(tenantId, { visitorId: `merchant:${input.operatorId}`, channel: 'merchant', lang: input.lang || null, currency: settings.currency });
  emit({ type: 'meta', data: { conversationId: conv.id } });

  const seen = new Set<string>(conv.seen_ids);
  const memory = await listMemory(tenantId, MERCHANT_SUBJECT, { limit: 20 }).catch(() => []);
  const history = await loadApiHistory(tenantId, conv.id, 8);
  const components: any[] = [];
  const productsCount = await countProducts(tenantId);

  const changePreview = async (change: StagedChange) => {
    const ids = Array.from(new Set(change.items.map((i) => i.target)));
    const prods = await getProductsByIds(tenantId, ids);
    const titles = new Map(prods.map((p) => [p.id, p.title]));
    return {
      changeId: change.id, kind: change.kind, status: change.status, note: change.note, createdAt: change.created_at,
      items: change.items.map((i) => ({ ...i, target_title: titles.get(i.target) || i.target_title || i.target })),
      approvalSurface: 'Changes panel',
    };
  };

  const execute = async (name: string, args: Record<string, unknown>): Promise<ToolOutcome> => {
    switch (name) {
      case 'load_skill': {
        const s = MERCHANT_SKILLS.find((x) => x.name === args.skill_name);
        return s ? { result: s.body } : { result: `Unknown skill. Available: ${MERCHANT_SKILLS.map((x) => x.name).join(', ')}`, isError: true };
      }
      case 'get_business_snapshot': {
        const snap = await getSnapshot(tenantId, Number(args.period_days) || 7);
        for (const t of snap.top_products) seen.add(t.product_id);
        const alerts = await inventoryAlerts(tenantId);
        return { result: MERCHANT_FENCE.fencePayload({ ...snap, alerts: { out_of_stock: alerts.out_of_stock.length, low_stock: alerts.low_stock.length } }) };
      }
      case 'query_metrics': {
        const series = await getSeries(tenantId, String(args.metric || ''), Number(args.period_days) || 7, args.product_id ? String(args.product_id) : null);
        return { result: MERCHANT_FENCE.fencePayload({ metric: args.metric, period_days: Number(args.period_days) || 7, product_id: args.product_id || undefined, series, note: series.length ? undefined : 'no data for this metric and period' }) };
      }
      case 'search_listings': {
        const limit = Math.min(30, Math.max(1, Number(args.limit) || 15));
        const q = String(args.query || '').trim();
        const quality = String(args.quality || '');
        const { items } = await listProducts(tenantId, { q: q || undefined, limit: quality ? 200 : limit, includeInactive: true });
        let rows = items.map(listingRow);
        if (quality) rows = rows.filter((r) => r.quality_flags.includes(quality)).slice(0, limit);
        for (const r of rows) seen.add(r.listing_id);
        return { result: MERCHANT_FENCE.fencePayload({ query: q, quality: quality || undefined, results: rows, total_active_products: productsCount }) };
      }
      case 'get_listing': {
        const id = String(args.listing_id || '');
        const p = await getProduct(tenantId, id);
        if (!p) return { result: `listing ${id} not found`, isError: true };
        seen.add(p.id);
        const variants = Object.keys(p.options).length ? await getVariants(tenantId, p.id) : [];
        for (const v of variants) seen.add(v.id);
        const stats = await productStats30d(tenantId, p.id);
        return { result: MERCHANT_FENCE.fencePayload({ ...listingRow(p), description: p.description || null, attributes: p.attributes, options: p.options, option_values: p.option_values, url: p.url, image: p.image_url ? 'present' : 'missing', sku: p.sku, stats_30d: stats, variants: variants.map((v) => ({ ...listingRow(v), option_values: v.option_values })) }) };
      }
      case 'get_inventory_alerts': {
        const a = await inventoryAlerts(tenantId);
        for (const r of [...a.out_of_stock, ...a.low_stock, ...a.clicked_inactive]) seen.add(r.listing_id);
        return { result: MERCHANT_FENCE.fencePayload(a) };
      }
      case 'get_pending_changes': {
        const changes = await listChanges(tenantId, 'staged', 30);
        return { result: MERCHANT_FENCE.fencePayload({ pending: changes.map((c) => ({ change_id: c.id, kind: c.kind, note: c.note, items: c.items, created_at: c.created_at })) }) };
      }
      case 'stage_listing_update': {
        const id = String(args.listing_id || '');
        if (!seen.has(id)) return { result: `listing ${id} was not read in this conversation; call get_listing or search_listings first.`, isError: true };
        const p = await getProduct(tenantId, id);
        if (!p) return { result: `listing ${id} not found`, isError: true };
        const fields = (args.fields && typeof args.fields === 'object') ? (args.fields as any) : {};
        const items: ChangeItem[] = [];
        for (const f of ['title', 'description', 'category', 'brand']) {
          if (typeof fields[f] === 'string' && fields[f].trim() && fields[f].trim() !== (p as any)[f]) items.push({ target: p.id, target_title: p.title, field: f, before: (p as any)[f], after: fields[f].trim() });
        }
        if (fields.attributes && typeof fields.attributes === 'object') {
          for (const [k, v] of Object.entries(fields.attributes).slice(0, 20)) if (String(v).trim() !== (p.attributes[k] || '')) items.push({ target: p.id, target_title: p.title, field: `attributes.${k}`, before: p.attributes[k] ?? null, after: String(v).trim() });
        }
        if (!items.length) return { result: 'Nothing to stage: the fields equal the record.', isError: true };
        const violations = checkGuardrails('listing_update', items);
        if (violations.length) return { result: `Guardrail held the change: ${violations.join('; ')}`, isError: true };
        const change = await createChange(tenantId, 'listing_update', items, MERCHANT_FENCE.sanitizeText(String(args.note || ''), 240) || null);
        const data = await changePreview(change);
        components.push({ component: 'change_preview', data });
        return { result: `Staged change ${change.id} with ${items.length} field(s); it waits for approval in the Changes panel. The preview card is shown.`, events: [{ type: 'component', component: 'change_preview', data }] };
      }
      case 'stage_price_update': {
        const list = Array.isArray(args.items) ? (args.items as any[]).slice(0, MAX_ITEMS_PER_CHANGE + 1) : [];
        if (!list.length) return { result: 'items are required', isError: true };
        const items: ChangeItem[] = [];
        for (const it of list) {
          const id = String(it?.listing_id || '');
          if (!seen.has(id)) return { result: `listing ${id} was not read in this conversation; call get_listing or search_listings first.`, isError: true };
          const p = await getProduct(tenantId, id);
          if (!p) return { result: `listing ${id} not found`, isError: true };
          const np = Number(it.new_price);
          items.push({ target: p.id, target_title: p.title, field: 'price', before: p.price, after: Math.round(np * 100) / 100 });
          if (it.compare_at_price != null) items.push({ target: p.id, target_title: p.title, field: 'compare_at_price', before: p.compare_at_price, after: Math.round(Number(it.compare_at_price) * 100) / 100 });
        }
        const violations = checkGuardrails('price_update', items);
        if (violations.length) return { result: `Guardrail held the change: ${violations.join('; ')}. Propose a figure inside the limit instead.`, isError: true };
        const change = await createChange(tenantId, 'price_update', items, MERCHANT_FENCE.sanitizeText(String(args.note || ''), 240) || null);
        const data = await changePreview(change);
        components.push({ component: 'change_preview', data });
        return { result: `Staged price change ${change.id} for ${list.length} listing(s); it waits for approval in the Changes panel. The preview card is shown.`, events: [{ type: 'component', component: 'change_preview', data }] };
      }
      case 'stage_inventory_action': {
        const id = String(args.listing_id || '');
        if (!seen.has(id)) return { result: `listing ${id} was not read in this conversation; call get_listing or search_listings first.`, isError: true };
        const p = await getProduct(tenantId, id);
        if (!p) return { result: `listing ${id} not found`, isError: true };
        const action = String(args.action || '');
        const items: ChangeItem[] = [];
        if (action === 'restock') {
          const q = Math.max(0, Math.round(Number(args.quantity)));
          if (!Number.isFinite(q)) return { result: 'quantity is required for restock', isError: true };
          items.push({ target: p.id, target_title: p.title, field: 'stock', before: p.stock, after: q });
          items.push({ target: p.id, target_title: p.title, field: 'in_stock', before: p.in_stock, after: q > 0 });
        } else if (action === 'pause') {
          items.push({ target: p.id, target_title: p.title, field: 'active', before: p.active, after: false });
        } else if (action === 'reactivate') {
          items.push({ target: p.id, target_title: p.title, field: 'active', before: p.active, after: true });
          items.push({ target: p.id, target_title: p.title, field: 'in_stock', before: p.in_stock, after: true });
        } else return { result: 'unknown action', isError: true };
        const change = await createChange(tenantId, 'inventory_action', items, MERCHANT_FENCE.sanitizeText(String(args.note || ''), 240) || null);
        const data = await changePreview(change);
        components.push({ component: 'change_preview', data });
        return { result: `Staged inventory action ${change.id} (${action}); it waits for approval in the Changes panel.`, events: [{ type: 'component', component: 'change_preview', data }] };
      }
      case 'discard_change': {
        const c = await setChangeStatus(tenantId, String(args.change_id || ''), 'discarded');
        return c ? { result: `Change ${c.id} discarded.` } : { result: 'change not found or not staged', isError: true };
      }
      case 'save_memory': {
        await saveMemory(tenantId, MERCHANT_SUBJECT, String(args.key || ''), String(args.value ?? ''), String(args.category || 'preference'));
        return { result: String(args.value ?? '').trim() ? 'Saved.' : 'Cleared.' };
      }
      case 'recall_memories': {
        const facts = await listMemory(tenantId, MERCHANT_SUBJECT, { topic: String(args.topic || ''), limit: 10 });
        return { result: MERCHANT_FENCE.fencePayload({ topic: args.topic, facts: facts.length ? facts : 'none' }) };
      }
      case 'present_metrics': {
        const days = Number(args.period_days) || 7;
        const snap = await getSnapshot(tenantId, days);
        const picks = (Array.isArray(args.picks) ? (args.picks as any[]) : []).slice(0, 6);
        const tiles = picks.map((p) => { const m = String(p?.metric || ''); return { metric: m, label: MERCHANT_FENCE.sanitizeText(String(p?.label || m), 40), value: snap.current[m] ?? null, previous: snap.previous[m] ?? null }; }).filter((t) => t.value !== null);
        if (!tiles.length) return { result: `present_metrics rejected: unknown metrics. Known: ${Object.keys(snap.current).join(', ')}.`, isError: true };
        const data = { title: MERCHANT_FENCE.sanitizeText(String(args.title || ''), 80), periodDays: days, tiles, currency: settings.currency };
        components.push({ component: 'metrics', data });
        return { result: `Rendered ${tiles.length} metric tiles for ${days} days (with prior period). Do not restate the figures.`, events: [{ type: 'component', component: 'metrics', data }] };
      }
      case 'present_digest': {
        const entries = (Array.isArray(args.entries) ? (args.entries as any[]) : []).slice(0, 7).map((e) => ({ kind: String(e?.kind || 'note'), headline: MERCHANT_FENCE.sanitizeText(String(e?.headline || ''), 90), detail: MERCHANT_FENCE.sanitizeText(String(e?.detail || ''), 200), action: MERCHANT_FENCE.sanitizeText(String(e?.action || ''), 80), listingId: e?.listing_id && seen.has(String(e.listing_id)) ? String(e.listing_id) : null })).filter((e) => e.headline);
        if (!entries.length) return { result: 'present_digest rejected: entries need headlines.', isError: true };
        const data = { title: MERCHANT_FENCE.sanitizeText(String(args.title || ''), 80), entries };
        components.push({ component: 'digest', data });
        return { result: `Rendered a digest with ${entries.length} entries.`, events: [{ type: 'component', component: 'digest', data }] };
      }
      case 'present_change_preview': {
        const c = await getChange(tenantId, String(args.change_id || ''));
        if (!c) return { result: 'change not found', isError: true };
        const data = { ...(await changePreview(c)), headline: MERCHANT_FENCE.sanitizeText(String(args.headline || ''), 90) };
        components.push({ component: 'change_preview', data });
        return { result: 'Preview card rendered.', events: [{ type: 'component', component: 'change_preview', data }] };
      }
      case 'present_suggestions': {
        const chips = sanitizeChips(args.suggestions, MERCHANT_FENCE);
        if (!chips.length) return { result: 'present_suggestions rejected: send 1-4 short plain-text chips.', isError: true };
        components.push({ component: 'suggestions', data: { chips } });
        return { result: 'Chips rendered; the reply ends here.', events: [{ type: 'component', component: 'suggestions', data: { chips } }] };
      }
      default:
        return { result: `Unknown tool ${name}`, isError: true };
    }
  };

  const userMessage = MERCHANT_FENCE.sanitizeText(input.message, 6000);
  const result = await runAgentTurn({
    client,
    model: merchantModel(settings.merchant_model),
    staticSystem: buildMerchantSystem(settings),
    dynamicContext: buildMerchantContext({ store: { brand: settings.brand_name, currency: settings.currency, products: productsCount, site_url: settings.site_url, platform: settings.platform, widget_enabled: settings.enabled }, memory, now: new Date() }),
    tools: buildMerchantTools(),
    history,
    userMessage,
    execute,
    emit,
    progressFor: (n) => (/^(get_|query_|search_)/.test(n) ? 'read' : n.startsWith('stage_') ? 'stage' : n === 'load_skill' ? 'think' : null),
    maxRounds: 8,
    maxTokens: 4000,
    effort: 'high',
  });

  const usage = { input: conv.usage.input + result.usage.input, output: conv.usage.output + result.usage.output, cache_read: conv.usage.cache_read + result.usage.cache_read, cache_write: conv.usage.cache_write + result.usage.cache_write };
  await appendTurnMessages(tenantId, conv.id, conv.turn_count + 1, result.newMessages, { userText: userMessage, assistantText: result.text, components });
  await saveConversationState(conv, { seen_ids: Array.from(seen), usage, message_count_add: 2, turn_add: 1 });
  return { conversationId: conv.id, text: result.text, usage: result.usage };
}

async function inventoryAlerts(tenantId: string): Promise<{ out_of_stock: any[]; low_stock: any[]; clicked_inactive: any[] }> {
  if (isFallbackActive()) return { out_of_stock: [], low_stock: [], clicked_inactive: [] };
  const rows = await pool.query(
    `SELECT p.*, COALESCE(e.clicks, 0)::int AS clicks FROM commerce_products p
     LEFT JOIN (SELECT product_id, count(*) AS clicks FROM commerce_events WHERE tenant_id = $1 AND kind IN ('card_click','add_to_cart') AND created_at > now() - interval '30 days' GROUP BY product_id) e ON e.product_id = p.id
     WHERE p.tenant_id = $1 AND (p.in_stock = false OR (p.stock IS NOT NULL AND p.stock <= 3) OR (p.active = false AND COALESCE(e.clicks,0) > 0))
     ORDER BY COALESCE(e.clicks,0) DESC, p.updated_at DESC LIMIT 60`,
    [tenantId],
  );
  const out = { out_of_stock: [] as any[], low_stock: [] as any[], clicked_inactive: [] as any[] };
  for (const r of rows.rows as any[]) {
    const p = mapProduct(r);
    const row = { ...listingRow(p), clicks_30d: r.clicks };
    if (!p.active && r.clicks > 0) out.clicked_inactive.push(row);
    else if (!p.in_stock) out.out_of_stock.push(row);
    else out.low_stock.push(row);
  }
  return out;
}
