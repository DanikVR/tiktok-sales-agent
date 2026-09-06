/**
 * Commerce Agents — агент покупателя: исполнители инструментов, harness (gates) и оркестрация
 * одного хода. Правила из blueprint:
 *  • в корзину принимаются только product_id, которые инструменты каталога вернули в ЭТОЙ
 *    сессии (provenance gate); семейство с опциями в корзину не идёт — только вариант;
 *  • лимиты на итоговом состоянии: ≤ 10 шт. позиции, ≤ 20 позиций;
 *  • денег у инструментов нет: checkout лишь формирует сводку и ссылку на чекаут магазина;
 *  • карточки заполняет сервер из записей каталога — модель передаёт только id и причину;
 *  • весь чужой текст (каталог, политики, память) уходит модели внутри забора.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { runAgentTurn, type TurnUsage } from './agent.js';
import { countPosts, getPostsByIds, searchPosts } from './posts.js';
import { notifyOwnerTelegram } from './notify.js';
import { tw, ownerLangOf } from './i18n.js';
import { STOREFRONT_FENCE, sanitizeChips } from './fence.js';
import { buildShoppingSystem, buildShoppingContext, SHOPPING_SKILLS } from './prompts.js';
import { buildShoppingTools } from './tools.js';
import { getProduct, getProductsByIds, getVariants, searchProducts } from './catalog.js';
import { getConversation, createConversation, saveConversationState, loadApiHistory, appendTurnMessages, logEvent, createLead, listMemory, saveMemory } from './store.js';
import { makeAnthropicClient, resolveAnthropicKey, shoppingModel } from './anthropic.js';
import type { AgentEvent, Cart, CartItem, CommerceProduct, CommerceSettings, Conversation, ToolOutcome } from './types.js';

const MAX_QTY_PER_ITEM = 10;
const MAX_CART_LINES = 20;

function money(n: number): number { return Math.round(Number(n || 0) * 100) / 100; }
function subtotal(cart: Cart): number { return money(cart.items.reduce((s, i) => s + i.price * i.quantity, 0)); }

/** Компактная запись товара для модели (без картинок и ссылок — их подставит сервер). */
function compact(p: CommerceProduct) {
  const o: Record<string, unknown> = {
    product_id: p.id, title: p.title, brand: p.brand || undefined, price: p.price, currency: p.currency,
    in_stock: p.in_stock, category: p.category || undefined,
  };
  if (p.compare_at_price && p.compare_at_price > p.price) o.compare_at_price = p.compare_at_price;
  if (p.stock != null) o.stock = p.stock;
  if (Object.keys(p.options).length) { o.options = p.options; o.note = 'family with options: buy one of its variants (get_product_details lists them)'; }
  if (Object.keys(p.option_values).length) o.option_values = p.option_values;
  if (p.description) o.short_description = p.description.slice(0, 160);
  return o;
}

function card(p: CommerceProduct, reason?: string) {
  return {
    id: p.id, title: p.title, brand: p.brand, price: p.price, currency: p.currency, compareAtPrice: p.compare_at_price,
    imageUrl: p.image_url, url: p.url, inStock: p.in_stock, category: p.category, reason: reason ? STOREFRONT_FENCE.sanitizeText(reason, 140) : null,
    hasOptions: Object.keys(p.options).length > 0, optionValues: p.option_values,
    // Для оформления карточки: источник (Instagram/TikTok/Telegram), тип (товар/услуга), видео-пост, цена по запросу.
    source: p.attributes?.['Источник'] || null, kind: p.attributes?.['Тип'] || null, isVideo: p.attributes?.['Видео'] === 'да', priceOnRequest: !(Number(p.price) > 0),
  };
}

function policyChunks(settings: CommerceSettings): string[] {
  const text = [settings.policies, settings.business_profile, settings.agent_notes].filter(Boolean).join('\n\n');
  return text.split(/\n\s*\n|(?=^#{1,3} )/m).map((s) => s.trim()).filter((s) => s.length > 20).slice(0, 400);
}

function searchChunks(chunks: string[], query: string, k = 5): string[] {
  const toks = String(query || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 3);
  if (!toks.length) return chunks.slice(0, k);
  return chunks
    .map((c) => ({ c, score: toks.reduce((s, t) => s + (c.toLowerCase().includes(t) ? 1 : 0), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.c);
}

export interface ShoppingTurnInput {
  settings: CommerceSettings;
  conversationId?: string | null;
  visitorId: string;
  message: string;
  lang?: string | null;
  page?: { url?: string | null; title?: string | null; productId?: string | null } | null;
  emit: (e: AgentEvent) => void;
}

export interface ShoppingTurnResult { conversationId: string; text: string; usage: TurnUsage }

const PROGRESS: Record<string, string> = {
  search_products: 'search', search_posts: 'search', get_product_details: 'details', search_policies: 'policies', add_to_cart: 'cart',
  update_cart_item: 'cart', remove_from_cart: 'cart', checkout: 'checkout', recall_memories: 'memory', load_skill: 'think',
};

export async function runShoppingTurn(input: ShoppingTurnInput): Promise<ShoppingTurnResult> {
  const { settings, emit } = input;
  const tenantId = settings.tenant_id;
  const keyInfo = await resolveAnthropicKey(tenantId);
  if (!keyInfo) throw new Error('assistant_not_configured');
  const client = makeAnthropicClient(keyInfo.key);

  let conv: Conversation | null = input.conversationId ? await getConversation(tenantId, input.conversationId) : null;
  if (conv && conv.visitor_id !== input.visitorId) conv = null;
  if (!conv) conv = await createConversation(tenantId, { visitorId: input.visitorId, channel: 'widget', pageUrl: input.page?.url || null, lang: input.lang || null, currency: settings.currency });
  emit({ type: 'meta', data: { conversationId: conv.id } });

  const seen = new Set<string>(conv.seen_ids);
  const cart: Cart = { items: Array.isArray(conv.cart?.items) ? conv.cart.items : [], currency: conv.cart?.currency || settings.currency };
  const memory = await listMemory(tenantId, input.visitorId, { limit: 20 }).catch(() => []);
  const history = await loadApiHistory(tenantId, conv.id, 8);
  const chunks = policyChunks(settings);
  const hasPolicies = chunks.length > 0;
  const hasPosts = (await countPosts(tenantId).catch(() => 0)) > 0;
  const seenPosts = new Set<string>();

  // Контекст страницы: товар, который открыт у покупателя, сразу считается «виденным».
  let page: { url?: string | null; title?: string | null; product?: { id: string; title: string } | null } | null = null;
  if (input.page) {
    page = { url: input.page.url || null, title: input.page.title || null, product: null };
    if (input.page.productId) {
      const p = await getProduct(tenantId, input.page.productId).catch(() => null);
      if (p) { page.product = { id: p.id, title: p.title }; seen.add(p.id); }
    }
  }

  const components: any[] = [];
  const cartEvent = (): AgentEvent => ({ type: 'cart', data: { ...cart, subtotal: subtotal(cart) } });

  const execute = async (name: string, args: Record<string, unknown>): Promise<ToolOutcome> => {
    switch (name) {
      case 'load_skill': {
        const s = SHOPPING_SKILLS.find((x) => x.name === args.skill_name);
        return s ? { result: s.body } : { result: `Unknown skill ${String(args.skill_name)}. Available: ${SHOPPING_SKILLS.map((x) => x.name).join(', ')}`, isError: true };
      }
      case 'search_products': {
        const query = String(args.query || '').trim();
        const f = (args.filters && typeof args.filters === 'object') ? (args.filters as any) : {};
        const limit = Math.min(12, Math.max(1, Number(args.limit) || 8));
        const items = await searchProducts(tenantId, query, {
          category: f.category, min_price: f.min_price, max_price: f.max_price, in_stock_only: !!f.in_stock_only, attributes: f.attributes, sort: f.sort,
        }, limit);
        for (const p of items) seen.add(p.id);
        if (!items.length) {
          void logEvent(tenantId, 'search_empty', { conversationId: conv!.id, payload: { query, filters: f } });
          return { result: STOREFRONT_FENCE.fencePayload({ query, results: [], note: 'No products matched. Retry once with the product type or a synonym and without the narrowest filter; then say the store does not carry it.' }) };
        }
        return { result: STOREFRONT_FENCE.fencePayload({ query, results: items.map(compact) }) };
      }
      case 'get_product_details': {
        const id = String(args.product_id || '');
        const p = await getProduct(tenantId, id);
        if (!p || !p.active) return { result: `product_id ${id} was not found in this store's catalog. Use a product_id from search_products results.`, isError: true };
        seen.add(p.id);
        const variants = Object.keys(p.options).length ? await getVariants(tenantId, p.id) : [];
        for (const v of variants) seen.add(v.id);
        const payload: Record<string, unknown> = { ...compact(p), description: p.description || undefined, attributes: p.attributes, url: p.url ? 'available' : undefined };
        if (variants.length) payload.variants = variants.map((v) => ({ product_id: v.id, title: v.title, price: v.price, in_stock: v.in_stock, option_values: v.option_values, stock: v.stock ?? undefined }));
        return { result: STOREFRONT_FENCE.fencePayload(payload) };
      }
      case 'get_cart':
        return { result: STOREFRONT_FENCE.fencePayload({ items: cart.items.map((i) => ({ product_id: i.product_id, title: i.title, quantity: i.quantity, price: i.price })), subtotal: subtotal(cart), currency: cart.currency }) };
      case 'add_to_cart': {
        const id = String(args.product_id || '');
        if (!seen.has(id)) return { result: `product_id ${id} was not returned by catalog tools in this session. Call get_product_details with this exact id or find it via search_products, then add a product_id from those results.`, isError: true };
        const p = await getProduct(tenantId, id);
        if (!p || !p.active) return { result: `product_id ${id} is not available.`, isError: true };
        if (Object.keys(p.options).length) return { result: `product_id ${id} has options still to choose (${Object.keys(p.options).join(', ')}), so the cart takes one of its variants. Settle each option, ask once with the values as chips when one is open, then add the matching variant's product_id from get_product_details.`, isError: true };
        if (!p.in_stock) return { result: `product_id ${id} is out of stock. Say so and offer an alternative.` };
        const requested = Math.max(1, Math.round(Number(args.quantity) || 1));
        const existing = cart.items.find((i) => i.product_id === id);
        if (!existing && cart.items.length >= MAX_CART_LINES) return { result: 'The cart is full (20 lines).', isError: true };
        const allowed = Math.min(requested, Math.max(0, MAX_QTY_PER_ITEM - (existing?.quantity || 0)));
        if (allowed <= 0) return { result: `This item is already at the per-item limit of ${MAX_QTY_PER_ITEM}.`, isError: true };
        if (existing) existing.quantity += allowed;
        else cart.items.push({ product_id: p.id, title: p.title, price: p.price, quantity: allowed, image_url: p.image_url, url: p.url, option_values: p.option_values });
        await saveConversationState(conv!, { cart, seen_ids: Array.from(seen) });
        void logEvent(tenantId, 'add_to_cart', { conversationId: conv!.id, productId: p.id, payload: { source: 'agent', quantity: allowed } });
        const capped = allowed < requested ? ` (capped at the per-item limit of ${MAX_QTY_PER_ITEM})` : '';
        return { result: `Added ${p.id} x${allowed}${capped}. Cart now has ${cart.items.reduce((s, i) => s + i.quantity, 0)} items, subtotal ${subtotal(cart)} ${cart.currency}.`, events: [cartEvent()] };
      }
      case 'update_cart_item': {
        const id = String(args.product_id || '');
        const line = cart.items.find((i) => i.product_id === id);
        if (!line) return { result: `product_id ${id} is not in the cart.`, isError: true };
        const q = Math.min(MAX_QTY_PER_ITEM, Math.max(1, Math.round(Number(args.quantity) || 1)));
        line.quantity = q;
        await saveConversationState(conv!, { cart });
        return { result: `Updated quantity to ${q}. Subtotal ${subtotal(cart)} ${cart.currency}.`, events: [cartEvent()] };
      }
      case 'remove_from_cart': {
        const id = String(args.product_id || '');
        const before = cart.items.length;
        cart.items = cart.items.filter((i) => i.product_id !== id);
        if (cart.items.length === before) return { result: `product_id ${id} is not in the cart.`, isError: true };
        await saveConversationState(conv!, { cart });
        return { result: `Removed. Cart now has ${cart.items.length} lines, subtotal ${subtotal(cart)} ${cart.currency}.`, events: [cartEvent()] };
      }
      case 'search_policies': {
        const hits = searchChunks(chunks, String(args.query || ''));
        return { result: STOREFRONT_FENCE.fencePayload({ query: args.query, results: hits.length ? hits : [], note: hits.length ? undefined : 'The store\'s terms do not cover this. Say so and offer request_contact.' }) };
      }
      case 'request_contact': {
        const reason = STOREFRONT_FENCE.sanitizeText(String(args.reason || ''), 200);
        const data = { reason };
        components.push({ component: 'lead_form', data });
        return { result: 'Contact form shown to the customer in the widget; they fill it in themselves. Say in one sentence why the store will follow up. Do not ask for the phone in chat.', events: [{ type: 'component', component: 'lead_form', data }] };
      }
      case 'save_memory': {
        await saveMemory(tenantId, input.visitorId, String(args.key || ''), String(args.value ?? ''), String(args.category || 'preference'));
        return { result: String(args.value ?? '').trim() ? 'Saved.' : 'Cleared.' };
      }
      case 'recall_memories': {
        const facts = await listMemory(tenantId, input.visitorId, { topic: String(args.topic || ''), limit: 10 });
        return { result: STOREFRONT_FENCE.fencePayload({ topic: args.topic, facts: facts.length ? facts : 'none' }) };
      }
      case 'present_products': {
        const picks = Array.isArray(args.picks) ? (args.picks as any[]).slice(0, 6) : [];
        const ids = picks.map((p) => String(p?.product_id || '')).filter((id) => seen.has(id));
        const products = await getProductsByIds(tenantId, ids);
        const dropped = picks.length - products.length;
        if (!products.length) return { result: 'present_products rejected: none of the product_ids were returned by catalog tools this session. Search first, then present ids from the results.', isError: true };
        const byId = new Map(products.map((p) => [p.id, p]));
        const items = picks.filter((p) => byId.has(String(p.product_id))).map((p) => card(byId.get(String(p.product_id))!, p.reason));
        const data = { title: STOREFRONT_FENCE.sanitizeText(String(args.title || ''), 80), items };
        components.push({ component: 'products', data });
        for (const it of items) void logEvent(tenantId, 'card_shown', { conversationId: conv!.id, productId: it.id });
        return { result: `Rendered ${items.length} product cards${dropped > 0 ? ` (${dropped} unknown ids dropped)` : ''}. Do not repeat their prices or names in text.`, events: [{ type: 'component', component: 'products', data }] };
      }
      case 'present_comparison': {
        const ids = (Array.isArray(args.product_ids) ? (args.product_ids as any[]) : []).map(String).filter((id) => seen.has(id)).slice(0, 4);
        const products = await getProductsByIds(tenantId, ids);
        if (products.length < 2) return { result: 'present_comparison rejected: need 2-4 product_ids returned by catalog tools this session.', isError: true };
        const criteria = (Array.isArray(args.criteria) ? (args.criteria as any[]) : []).map((c) => STOREFRONT_FENCE.sanitizeText(String(c), 40)).filter(Boolean).slice(0, 6);
        const allKeys = new Set<string>();
        for (const p of products) Object.keys(p.attributes).forEach((k) => allKeys.add(k));
        const rowsKeys = criteria.length ? criteria : Array.from(allKeys).slice(0, 6);
        const rows = rowsKeys.map((k) => ({ label: k, values: products.map((p) => p.attributes[k] || Object.entries(p.attributes).find(([ak]) => ak.toLowerCase() === k.toLowerCase())?.[1] || '—') }));
        const data = { title: STOREFRONT_FENCE.sanitizeText(String(args.title || ''), 80), items: products.map((p) => card(p)), rows, recommendation: STOREFRONT_FENCE.sanitizeText(String(args.recommendation || ''), 160) };
        components.push({ component: 'comparison', data });
        for (const p of products) void logEvent(tenantId, 'card_shown', { conversationId: conv!.id, productId: p.id });
        return { result: `Rendered a comparison of ${products.length} products with rows: ${rowsKeys.join(', ') || 'price only'}. Do not repeat the figures in text.`, events: [{ type: 'component', component: 'comparison', data }] };
      }
      case 'checkout': {
        if (!cart.items.length) return { result: 'The cart is empty; add items before checkout.', isError: true };
        const lead = await createLead(tenantId, { conversationId: conv!.id, kind: 'checkout', items: cart.items, total: subtotal(cart), currency: cart.currency, note: STOREFRONT_FENCE.sanitizeText(String(args.note || ''), 300) || null });
        const data = { leadId: lead.id, items: cart.items, subtotal: subtotal(cart), currency: cart.currency, note: STOREFRONT_FENCE.sanitizeText(String(args.note || ''), 300), checkoutUrl: settings.checkout_url || settings.site_url || null, platform: settings.platform };
        components.push({ component: 'checkout', data });
        void logEvent(tenantId, 'checkout_staged', { conversationId: conv!.id, payload: { total: subtotal(cart), lines: cart.items.length } });
        void notifyOwnerTelegram(tenantId, tw(ownerLangOf(settings), 'srv.tg.order', { brand: (settings.brand_name || '').replace(/[<>&]/g, ''), items: cart.items.map((i) => `• ${String(i.title).replace(/[<>&]/g, '')} × ${i.quantity}`).join('\n'), total: subtotal(cart), currency: cart.currency }));
        return { result: 'Checkout summary staged; the customer confirms it on the store\'s own checkout. Nothing was ordered or charged. Add one sentence with what to check, then present_suggestions.', events: [{ type: 'component', component: 'checkout', data }] };
      }
      case 'search_posts': {
        const query = String(args.query || '').trim();
        const limit = Math.min(8, Math.max(1, Number(args.limit) || 6));
        const posts = await searchPosts(tenantId, query, limit);
        for (const p of posts) seenPosts.add(p.id);
        if (!posts.length) return { result: STOREFRONT_FENCE.fencePayload({ query, results: [], note: 'No posts matched. Retry once with a broader word; then say there is no such post.' }) };
        return { result: STOREFRONT_FENCE.fencePayload({ query, results: posts.map((p) => ({ post_id: p.id, source: p.source, date: p.taken_at ? String(p.taken_at).slice(0, 10) : null, text: (p.text || '').slice(0, 300), has_photo: !!p.image_url, transcript_excerpt: p.transcript ? p.transcript.slice(0, 200) : undefined, on_screen_text: p.on_screen ? p.on_screen.slice(0, 120) : undefined })) }) };
      }
      case 'present_posts': {
        const picks = Array.isArray(args.picks) ? (args.picks as any[]).slice(0, 4) : [];
        const ids = picks.map((p) => String(p?.post_id || '')).filter((id) => seenPosts.has(id));
        const posts = await getPostsByIds(tenantId, ids);
        if (!posts.length) return { result: 'present_posts rejected: none of the post_ids were returned by search_posts this session. Search first, then present ids from the results.', isError: true };
        const byId = new Map(posts.map((p) => [p.id, p]));
        const items = picks.filter((p) => byId.has(String(p.post_id))).map((p) => { const x = byId.get(String(p.post_id))!; return { id: x.id, source: x.source, url: x.url, text: STOREFRONT_FENCE.sanitizeText(x.text || '', 400), imageUrl: x.image_url, takenAt: x.taken_at, isVideo: !!x.is_video, reason: STOREFRONT_FENCE.sanitizeText(String(p.reason || ''), 120) }; });
        const data = { title: STOREFRONT_FENCE.sanitizeText(String(args.title || ''), 80), items };
        components.push({ component: 'posts', data });
        return { result: `Rendered ${items.length} post cards with links to the originals. Do not repeat their text.`, events: [{ type: 'component', component: 'posts', data }] };
      }
      case 'present_suggestions': {
        const chips = sanitizeChips(args.suggestions);
        if (!chips.length) return { result: 'present_suggestions rejected: send 1-4 short plain-text chips.', isError: true };
        components.push({ component: 'suggestions', data: { chips } });
        return { result: 'Chips rendered; the reply ends here.', events: [{ type: 'component', component: 'suggestions', data: { chips } }] };
      }
      default:
        return { result: `Unknown tool ${name}`, isError: true };
    }
  };

  const staticSystem = buildShoppingSystem(settings, hasPolicies, hasPosts);
  const dynamicContext = buildShoppingContext({
    visitorId: input.visitorId, lang: input.lang || conv.lang, memory, cart, page,
    store: { brand: settings.brand_name, currency: settings.currency, checkoutUrl: settings.checkout_url || null }, now: new Date(),
  });
  const userMessage = STOREFRONT_FENCE.sanitizeText(input.message, 4000);

  const result = await runAgentTurn({
    client,
    model: shoppingModel(settings.shopping_model),
    staticSystem,
    dynamicContext,
    tools: buildShoppingTools({ hasPolicies, hasPosts }),
    history,
    userMessage,
    execute,
    emit,
    progressFor: (n) => PROGRESS[n] || null,
    maxRounds: 6,
    maxTokens: 3000,
    effort: 'medium',
  });

  const usage = { input: conv.usage.input + result.usage.input, output: conv.usage.output + result.usage.output, cache_read: conv.usage.cache_read + result.usage.cache_read, cache_write: conv.usage.cache_write + result.usage.cache_write };
  await appendTurnMessages(tenantId, conv.id, conv.turn_count + 1, result.newMessages, { userText: userMessage, assistantText: result.text, components });
  await saveConversationState(conv, { cart, seen_ids: Array.from(seen), page_url: input.page?.url || undefined, usage, message_count_add: 2, turn_add: 1 });
  return { conversationId: conv.id, text: result.text, usage: result.usage };
}

export type { CartItem };
