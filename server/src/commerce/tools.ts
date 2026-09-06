/**
 * Commerce Agents — определения инструментов (JSON Schema) обоих агентов. Порт из
 * anthropics/commerce-agents с поправкой на наши системы: нет истории заказов и кампаний,
 * зато есть заявка на связь (request_contact) и услуги. Порядок инструментов фиксирован —
 * список кэшируется байт-в-байт (cache_control на последнем).
 */

import type Anthropic from '@anthropic-ai/sdk';
import { SHOPPING_SKILLS, MERCHANT_SKILLS } from './prompts.js';

type Tool = Anthropic.Tool;

const productId = (role = 'A product_id returned by a catalog tool in this session.') => ({ type: 'string', description: role });

const filters = {
  type: 'object',
  description: 'Constraints the customer stated.',
  properties: {
    category: { type: 'string', description: 'Catalog category name.' },
    min_price: { type: 'number', description: 'Lowest acceptable price.' },
    max_price: { type: 'number', description: 'Price ceiling the customer stated.' },
    in_stock_only: { type: 'boolean', description: 'Only items available now.' },
    attributes: { type: 'object', additionalProperties: { type: 'string' }, description: 'Attribute values that must match (size, color, material).' },
    sort: { type: 'string', enum: ['relevance', 'price_asc', 'price_desc'] },
  },
  additionalProperties: false,
};

export function buildShoppingTools(opts: { hasPolicies: boolean; hasPosts?: boolean }): Tool[] {
  const tools: Tool[] = [
    {
      name: 'load_skill',
      description: 'Load the rules of the flow whose entry in the skill index the request matches; they are not in your prompt. Call it in the same round as the flow\'s first read and follow them for the rest of the flow.',
      input_schema: { type: 'object', properties: { skill_name: { type: 'string', enum: SHOPPING_SKILLS.map((s) => s.name), description: 'Name of the skill as listed in the index.' } }, required: ['skill_name'], additionalProperties: false },
    },
    {
      name: 'search_products',
      description: 'Search the catalog; returns products with id, title, brand, price, and availability; a product with options shows its lowest price and its options. Use a specific query in the catalog\'s vocabulary and put stated constraints in filters. Run one search per distinct item a request names. The search matches words: when a query returns nothing, retry with the product type or a synonym.',
      input_schema: { type: 'object', properties: { query: { type: 'string', description: 'What to look for, in the catalog\'s vocabulary.' }, filters, limit: { type: 'integer', minimum: 1, maximum: 12, description: 'Maximum results to return.' } }, required: ['query'], additionalProperties: false },
    },
    {
      name: 'get_product_details',
      description: 'Full details for one product: description, attributes, and for a product with options, its variants with their ids, prices, and stock. Use for a question about one product, before comparing finalists or choosing a variant, and for the product on the customer\'s current page.',
      input_schema: { type: 'object', properties: { product_id: productId('Catalog product_id to look up.') }, required: ['product_id'], additionalProperties: false },
    },
    {
      name: 'search_posts',
      description: 'Search the store\'s own social posts (Instagram, TikTok, Telegram): examples of work, reviews, promos, news, how-to videos. Returns posts with post_id, source, date, text and whether they have a photo or a video transcript. Use when the customer asks for examples, reviews, news, a promo, "show me", or wants to see the post a product came from. Show results with present_posts.',
      input_schema: { type: 'object', properties: { query: { type: 'string', description: 'What to look for, in the posts\' language; a few words.' }, limit: { type: 'integer', minimum: 1, maximum: 8 } }, required: ['query'], additionalProperties: false },
    },
    { name: 'get_cart', description: 'Current cart contents with quantities and subtotal.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
    {
      name: 'add_to_cart',
      description: 'Add a product, or the chosen variant of a product with options, by a product_id a catalog tool returned this session; quantity defaults to 1. If the result says the item is unavailable, say so and offer an alternative; add that only once the customer chooses it.',
      input_schema: { type: 'object', properties: { product_id: productId(), quantity: { type: 'integer', minimum: 1, description: 'Units to add; omit for one.' } }, required: ['product_id'], additionalProperties: false },
    },
    {
      name: 'update_cart_item',
      description: 'Set the quantity of an item that is already in the cart.',
      input_schema: { type: 'object', properties: { product_id: productId('product_id of a line already in the cart.'), quantity: { type: 'integer', minimum: 1, description: 'New quantity for the line.' } }, required: ['product_id', 'quantity'], additionalProperties: false },
    },
    {
      name: 'remove_from_cart',
      description: 'Remove an item from the cart.',
      input_schema: { type: 'object', properties: { product_id: productId('product_id of the line to remove.') }, required: ['product_id'], additionalProperties: false },
    },
  ];
  if (opts.hasPolicies) {
    tools.push({
      name: 'search_policies',
      description: 'Search the store\'s own terms and help content: delivery, returns, payment, warranty, hours, how to book, and the store\'s buying guides.',
      input_schema: { type: 'object', properties: { query: { type: 'string', description: 'The term or topic to look up.' } }, required: ['query'], additionalProperties: false },
    });
  }
  tools.push(
    {
      name: 'request_contact',
      description: 'Show the customer a short contact form (name and phone or messenger) so the store\'s staff follows up: for a booking, a question the terms do not answer, an order problem, or a quote. The form is filled in by the customer in the widget; you never see or ask for the details in chat. Say in one sentence why the store will call.',
      input_schema: { type: 'object', properties: { reason: { type: 'string', maxLength: 200, description: 'One line on what the store should follow up about, in the customer\'s language.' } }, required: ['reason'], additionalProperties: false },
    },
    {
      name: 'save_memory',
      description: 'Save a durable fact about the customer when they ask you to remember something or state a standing rule about how they shop. Save the need an item reveals, never product or policy text. An empty value clears the key.',
      input_schema: { type: 'object', properties: { key: { type: 'string', maxLength: 64, description: 'Topic key; reuse an existing key to replace its value.' }, value: { type: 'string', maxLength: 200, description: 'The fact, worded to stand on its own later.' }, category: { type: 'string', enum: ['preference', 'constraint', 'context'] } }, required: ['key', 'value'], additionalProperties: false },
    },
    {
      name: 'recall_memories',
      description: 'Search the customer\'s saved facts that are not in the Session context block: older preferences, sizes, past recipients, recurring needs. Use it when such a fact would change your recommendation.',
      input_schema: { type: 'object', properties: { topic: { type: 'string', maxLength: 100, description: 'Topic to search for, in a few words.' } }, required: ['topic'], additionalProperties: false },
    },
    // ── presentation ──
    {
      name: 'present_products',
      description: 'Show a row of product cards: search results, a shortlist, or the items a plan needs. Up to 6 picks, the one you recommend first. Each pick carries a product_id a catalog tool returned and one clause of reason naming the customer\'s own constraint it meets. The UI fills in title, price, image, and availability.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 80, description: 'Short heading for the row, in the customer\'s language.' },
          picks: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'object', properties: { product_id: productId(), reason: { type: 'string', maxLength: 120, description: 'One clause on why it fits.' } }, required: ['product_id'], additionalProperties: false } },
        },
        required: ['picks'],
        additionalProperties: false,
      },
    },
    {
      name: 'present_comparison',
      description: 'Compare two to four finalists side by side on the dimensions the customer raised. Use it instead of another row of cards once the customer has narrowed down. The UI fills in prices and attributes; you name the dimensions and the pick.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 80 },
          product_ids: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'string' }, description: 'product_ids to compare, your pick first.' },
          criteria: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 40 }, description: 'Attribute names to show as rows, in the customer\'s language where the record allows.' },
          recommendation: { type: 'string', maxLength: 160, description: 'One sentence naming the pick and the criterion that decided it.' },
        },
        required: ['product_ids'],
        additionalProperties: false,
      },
    },
    {
      name: 'checkout',
      description: 'Stage the current cart as an order summary the customer confirms on the store\'s own checkout; it places no order and charges nothing. Use only when the customer asks to check out or to buy what is in the cart.',
      input_schema: { type: 'object', properties: { note: { type: 'string', maxLength: 300, description: 'Anything the customer should check before confirming, in their language.' } }, additionalProperties: false },
    },
    {
      name: 'present_posts',
      description: 'Show 1-4 post cards (photo, text, link to the original post) from search_posts results this session. Each pick carries a post_id and one clause of reason in the customer\'s language. The UI fills in photo, text and link.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 80 },
          picks: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', properties: { post_id: { type: 'string' }, reason: { type: 'string', maxLength: 120 } }, required: ['post_id'], additionalProperties: false } },
        },
        required: ['picks'],
        additionalProperties: false,
      },
    },
    {
      name: 'present_suggestions',
      description: 'Give the turn its 1-4 chips; it ends the reply. Call it in the same round as the turn\'s last component, without waiting for that component\'s result. Alone, after the text, only on a turn with no component (a terms answer, a clarifying question, a confirmed add or save).',
      input_schema: { type: 'object', properties: { suggestions: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' }, description: '1-4 chips in the customer\'s language, each a brief imperative and each a different kind of step; leave out anything this turn already displayed.' } }, required: ['suggestions'], additionalProperties: false },
    },
  );
  return opts.hasPosts === false ? tools.filter((t) => t.name !== 'search_posts' && t.name !== 'present_posts') : tools;
}

export function buildMerchantTools(): Tool[] {
  const listingId = (role = 'A listing id search_listings or get_listing returned in this conversation.') => ({ type: 'string', description: role });
  return [
    {
      name: 'load_skill',
      description: 'Load the rules of the flow whose entry in the skill index the request matches; they are not in your prompt. Call it in the same round as the flow\'s first read.',
      input_schema: { type: 'object', properties: { skill_name: { type: 'string', enum: MERCHANT_SKILLS.map((s) => s.name) } }, required: ['skill_name'], additionalProperties: false },
    },
    {
      name: 'get_business_snapshot',
      description: 'Headline figures for a period with the prior period beside them: dialogs, messages, product cards shown, add-to-cart clicks, checkouts staged, leads, purchases and revenue (where the pixel is installed), top products by clicks, empty searches (what customers asked for that the catalog did not return), and stock alert counts. Call it before describing performance.',
      input_schema: { type: 'object', properties: { period_days: { type: 'integer', enum: [1, 7, 14, 30, 90], description: 'Length of the period ending today; default 7.' } }, additionalProperties: false },
    },
    {
      name: 'query_metrics',
      description: 'One metric as a daily series over the period, optionally narrowed to one product.',
      input_schema: { type: 'object', properties: { metric: { type: 'string', enum: ['dialogs', 'messages', 'cards_shown', 'add_to_cart', 'checkouts', 'leads', 'purchases', 'revenue', 'empty_searches'] }, period_days: { type: 'integer', minimum: 1, maximum: 90 }, product_id: listingId('Narrow to one product (clicks, cards, add-to-cart).') }, required: ['metric'], additionalProperties: false },
    },
    {
      name: 'search_listings',
      description: 'Search the catalog as the operator sees it: id, title, price, stock, availability, category, and quality flags. An empty query with a quality filter lists candidates for an audit.',
      input_schema: { type: 'object', properties: { query: { type: 'string' }, quality: { type: 'string', enum: ['missing_description', 'missing_image', 'missing_category', 'out_of_stock', 'low_stock', 'inactive'] }, limit: { type: 'integer', minimum: 1, maximum: 30 } }, additionalProperties: false },
    },
    {
      name: 'get_listing',
      description: 'The full record of one listing: description, attributes, price, compare-at price, stock, variants with their ids, and its clicks and add-to-carts over the last 30 days.',
      input_schema: { type: 'object', properties: { listing_id: listingId('Listing id to read.') }, required: ['listing_id'], additionalProperties: false },
    },
    {
      name: 'get_inventory_alerts',
      description: 'Listings that are out of stock or low on stock, with the clicks they still get, and listings customers clicked that are inactive.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'get_pending_changes',
      description: 'Changes staged in this admin that still wait for the operator\'s approval, with their items and notes.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'stage_listing_update',
      description: 'Stage an edit to a listing\'s content (title, description, category, brand, an attribute). Applies only after the operator approves it in the Changes panel. Content fields only; price and stock have their own tools.',
      input_schema: {
        type: 'object',
        properties: {
          listing_id: listingId(),
          fields: { type: 'object', properties: { title: { type: 'string', maxLength: 300 }, description: { type: 'string', maxLength: 8000 }, category: { type: 'string', maxLength: 160 }, brand: { type: 'string', maxLength: 120 }, attributes: { type: 'object', additionalProperties: { type: 'string' } } }, additionalProperties: false },
          note: { type: 'string', maxLength: 240, description: 'One sentence on why the change is right; it goes on the preview.' },
        },
        required: ['listing_id', 'fields', 'note'],
        additionalProperties: false,
      },
    },
    {
      name: 'stage_price_update',
      description: 'Stage new prices for up to 25 listings or variants. A move is capped at 30% per item; to show a markdown as a sale, set compare_at_price to the old price. Applies only after the operator approves it in the Changes panel.',
      input_schema: {
        type: 'object',
        properties: {
          items: { type: 'array', minItems: 1, maxItems: 25, items: { type: 'object', properties: { listing_id: listingId(), new_price: { type: 'number', minimum: 0 }, compare_at_price: { type: 'number', minimum: 0 } }, required: ['listing_id', 'new_price'], additionalProperties: false } },
          note: { type: 'string', maxLength: 240 },
        },
        required: ['items', 'note'],
        additionalProperties: false,
      },
    },
    {
      name: 'stage_inventory_action',
      description: 'Stage a stock action: restock (set the stock quantity), pause (hide the listing from the storefront assistant), or reactivate. Applies only after the operator approves it in the Changes panel.',
      input_schema: {
        type: 'object',
        properties: { listing_id: listingId(), action: { type: 'string', enum: ['restock', 'pause', 'reactivate'] }, quantity: { type: 'integer', minimum: 0, description: 'New stock quantity for restock.' }, note: { type: 'string', maxLength: 240 } },
        required: ['listing_id', 'action', 'note'],
        additionalProperties: false,
      },
    },
    {
      name: 'discard_change',
      description: 'Discard a staged change that the operator asked to drop, by the id a stage_* tool or get_pending_changes returned.',
      input_schema: { type: 'object', properties: { change_id: { type: 'string' } }, required: ['change_id'], additionalProperties: false },
    },
    {
      name: 'save_memory',
      description: 'Save a durable fact about how this store wants to be run: brand voice, naming conventions, a stated goal or a seasonal pattern. Reuse a key to replace its value; an empty value clears it.',
      input_schema: { type: 'object', properties: { key: { type: 'string', maxLength: 64 }, value: { type: 'string', maxLength: 300 }, category: { type: 'string', enum: ['preference', 'constraint', 'context'] } }, required: ['key', 'value'], additionalProperties: false },
    },
    {
      name: 'recall_memories',
      description: 'Search the store\'s saved facts not in the Merchant context block: brand voice, goals, patterns.',
      input_schema: { type: 'object', properties: { topic: { type: 'string', maxLength: 100 } }, required: ['topic'], additionalProperties: false },
    },
    {
      name: 'present_metrics',
      description: 'Show a metrics card: 2 to 6 picks, each a measure a tool returned this conversation, under the tool\'s name for it (dialogs, add_to_cart, leads, revenue, ...), with the period. A projection is not a pick.',
      input_schema: { type: 'object', properties: { title: { type: 'string', maxLength: 80 }, period_days: { type: 'integer', enum: [1, 7, 14, 30, 90] }, picks: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'object', properties: { metric: { type: 'string' }, label: { type: 'string', maxLength: 40, description: 'Label in the operator\'s language.' } }, required: ['metric'], additionalProperties: false } } }, required: ['picks'], additionalProperties: false },
    },
    {
      name: 'present_digest',
      description: 'Show the needs-attention briefing: 3 to 6 entries ranked by money at stake, each with what is wrong, the figure from the payload, and the next action.',
      input_schema: { type: 'object', properties: { title: { type: 'string', maxLength: 80 }, entries: { type: 'array', minItems: 1, maxItems: 7, items: { type: 'object', properties: { kind: { type: 'string', enum: ['stock', 'demand', 'catalog', 'pricing', 'change', 'note'] }, headline: { type: 'string', maxLength: 90 }, detail: { type: 'string', maxLength: 200 }, action: { type: 'string', maxLength: 80 }, listing_id: { type: 'string' } }, required: ['kind', 'headline'], additionalProperties: false } } }, required: ['entries'], additionalProperties: false },
    },
    {
      name: 'present_change_preview',
      description: 'Show the preview card of a staged change (before/after per item, the note, and where it is approved) by the change id a stage_* tool returned.',
      input_schema: { type: 'object', properties: { change_id: { type: 'string' }, headline: { type: 'string', maxLength: 90 } }, required: ['change_id'], additionalProperties: false },
    },
    {
      name: 'present_suggestions',
      description: 'Give the turn its 1-4 chips; it ends the reply. Call it in the same round as the turn\'s last present_* call, without waiting for that call\'s result. Alone, after the text, only on a turn with no other component.',
      input_schema: { type: 'object', properties: { suggestions: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' } } }, required: ['suggestions'], additionalProperties: false },
    },
  ];
}
