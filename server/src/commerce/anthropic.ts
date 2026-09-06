/**
 * Commerce Agents — клиент Anthropic и выбор моделей.
 *
 * Ключ, по приоритету: свой ключ тенанта (зашифрован в commerce_settings) → ключ платформы из
 * суперадминки (system-config `anthropicApiKey`) → env ANTHROPIC_API_KEY. Модели по умолчанию —
 * как рекомендует blueprint: Sonnet для агента покупателя (задержка), Opus для агента владельца
 * (анализ); переопределяются в суперадминке и per-tenant.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicApiKey, getCommerceShoppingModel, getCommerceMerchantModel } from '../config.js';
import { getTenantAnthropicKey, getTenantGeminiKey } from './settings.js';
import { getGeminiApiKey } from '../config.js';

export const DEFAULT_SHOPPING_MODEL = 'claude-sonnet-5';
export const DEFAULT_MERCHANT_MODEL = 'claude-opus-5';

export async function resolveAnthropicKey(tenantId: string | null | undefined): Promise<{ key: string; source: 'tenant' | 'platform' } | null> {
  if (tenantId) {
    try {
      const own = await getTenantAnthropicKey(tenantId);
      if (own) return { key: own, source: 'tenant' };
    } catch (err) {
      console.warn('[commerce/anthropic] не удалось прочитать ключ тенанта:', (err as Error).message);
    }
  }
  const platform = getAnthropicApiKey();
  if (platform) return { key: platform, source: 'platform' };
  return null;
}

export function makeAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
}

export function shoppingModel(override?: string | null): string {
  return (override && override.trim()) || getCommerceShoppingModel() || DEFAULT_SHOPPING_MODEL;
}

export function merchantModel(override?: string | null): string {
  return (override && override.trim()) || getCommerceMerchantModel() || DEFAULT_MERCHANT_MODEL;
}

/** Ключ Gemini: свой ключ тенанта → ключ платформы (суперадмин / env). */
export async function resolveGeminiKey(tenantId: string | null | undefined): Promise<{ key: string; source: 'tenant' | 'platform' } | null> {
  if (tenantId) {
    try { const own = await getTenantGeminiKey(tenantId); if (own) return { key: own, source: 'tenant' }; } catch { /* ignore */ }
  }
  const platform = getGeminiApiKey();
  return platform ? { key: platform, source: 'platform' } : null;
}
