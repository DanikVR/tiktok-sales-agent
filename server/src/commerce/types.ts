/**
 * Commerce Agents — доменные типы модуля (каталог, настройки, диалоги, заявки, staged-изменения).
 * Модуль построен по blueprint anthropics/commerce-agents (Apache-2.0): агент покупателя
 * (виджет на сайте клиента) и агент владельца (кабинет comag).
 */

export interface CommerceProduct {
  id: string;
  tenant_id: string;
  external_id: string | null;
  sku: string | null;
  title: string;
  brand: string | null;
  description: string | null;
  price: number;
  currency: string;
  compare_at_price: number | null;
  in_stock: boolean;
  stock: number | null;
  image_url: string | null;
  url: string | null;
  category: string | null;
  attributes: Record<string, string>;
  /** Семейство с опциями: { "Размер": ["S","M"], ... }. Пусто = обычный товар. */
  options: Record<string, string[]>;
  /** Значения опций варианта: { "Размер": "M" }. */
  option_values: Record<string, string>;
  variant_of: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductInput {
  external_id?: string | null;
  sku?: string | null;
  title: string;
  brand?: string | null;
  description?: string | null;
  price?: number;
  currency?: string;
  compare_at_price?: number | null;
  in_stock?: boolean;
  stock?: number | null;
  image_url?: string | null;
  url?: string | null;
  category?: string | null;
  attributes?: Record<string, string>;
  options?: Record<string, string[]>;
  option_values?: Record<string, string>;
  variant_of?: string | null;
  active?: boolean;
}

export type CommercePlatform = 'shopify' | 'woocommerce' | 'tilda' | 'other';

export interface CommerceSettings {
  tenant_id: string;
  slug: string;
  brand_name: string;
  assistant_name: string;
  brand_voice: string;
  greeting: string;
  accent: string;
  theme: 'light' | 'dark' | 'auto';
  logo_url: string | null;
  position: 'bottom-right' | 'bottom-left';
  language: string;
  business_profile: string;
  policies: string;
  currency: string;
  site_url: string | null;
  checkout_url: string | null;
  platform: CommercePlatform;
  enabled: boolean;
  voice_enabled: boolean;
  proactive_enabled: boolean;
  has_anthropic_key: boolean;
  has_gemini_key: boolean;
  shopping_model: string | null;
  merchant_model: string | null;
  crawl_status: CrawlStatus | null;
  /** Ссылка для пересылки: заголовок, описание и обложка превью в мессенджерах. */
  share_title: string;
  share_description: string;
  share_cover_url: string | null;
  /** Стартовые подсказки в виджете (до 4). null = автоматически по каталогу. */
  starters: string[] | null;
  /** Свободные указания владельца агенту: контакты для быстрой связи, кому передавать опт, ссылки, акции. */
  agent_notes: string;
  /** Последний язык интерфейса владельца в кабинете (X-Lang) — для уведомлений и текстов каталога. */
  owner_lang?: string | null;
  /** Имя приложения под иконкой на телефоне покупателя (PWA), до 12 знаков; пусто — первое слово названия. */
  app_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrawlStatus {
  state: 'idle' | 'running' | 'done' | 'error';
  url?: string;
  started_at?: string;
  finished_at?: string;
  pages_seen?: number;
  pages_total?: number;
  products_found?: number;
  message?: string;
  phase?: string;
  platform?: string;
  currency?: string;
  /** Шаги анализа для диагностики («Store API: пусто», «карта сайта: 120 ссылок»). */
  trace?: string[];
  /** Ключи словаря для перевода фазы/итога/трассы при показе (см. i18n.ts). */
  phase_key?: string;
  phase_params?: Record<string, string | number>;
  message_parts?: Array<[string, Record<string, string | number>?]>;
  trace_parts?: Array<[string, Record<string, string | number>?]>;
}

export interface CartItem {
  product_id: string;
  title: string;
  price: number;
  quantity: number;
  image_url?: string | null;
  url?: string | null;
  option_values?: Record<string, string>;
}

export interface Cart {
  items: CartItem[];
  currency: string;
}

export interface Conversation {
  id: string;
  tenant_id: string;
  visitor_id: string;
  channel: 'widget' | 'merchant';
  page_url: string | null;
  lang: string | null;
  cart: Cart;
  seen_ids: string[];
  status: string;
  summary: string | null;
  message_count: number;
  turn_count: number;
  usage: { input: number; output: number; cache_read: number; cache_write: number };
  started_at: string;
  last_at: string;
}

export type LeadKind = 'checkout' | 'callback' | 'purchase' | 'cart';
export type LeadStatus = 'new' | 'contacted' | 'won' | 'lost';

export interface Lead {
  id: string;
  tenant_id: string;
  conversation_id: string | null;
  kind: LeadKind;
  status: LeadStatus;
  items: CartItem[];
  total: number | null;
  currency: string | null;
  contact: Record<string, string>;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export type ChangeKind = 'listing_update' | 'price_update' | 'inventory_action';
export type ChangeStatus = 'staged' | 'applied' | 'discarded';

export interface ChangeItem {
  target: string;      // product id
  target_title?: string;
  field: string;
  before: unknown;
  after: unknown;
}

export interface StagedChange {
  id: string;
  tenant_id: string;
  kind: ChangeKind;
  items: ChangeItem[];
  note: string | null;
  status: ChangeStatus;
  created_by: string;
  created_at: string;
  applied_at: string | null;
}

/** Событие SSE, которое виджет/кабинет рисует. */
export type AgentEvent =
  | { type: 'meta'; data: Record<string, unknown> }
  | { type: 'progress'; text: string }
  | { type: 'text'; delta: string }
  | { type: 'component'; component: string; data: unknown }
  | { type: 'cart'; data: Cart & { subtotal: number } }
  | { type: 'done'; data?: Record<string, unknown> }
  | { type: 'error'; message: string };

export interface ToolOutcome {
  result: string;
  isError?: boolean;
  events?: AgentEvent[];
}
