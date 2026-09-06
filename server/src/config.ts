/**
 * All configuration comes from environment variables (see .env.example). In the hosted edition
 * (comag.vibevox.pro) these values live in a super-admin panel and per-tenant settings; here it is
 * one store, so env is enough.
 */
const env = (k: string, d = '') => (process.env[k] ?? d).trim();

/** Single-tenant id used for every table row. Keep it stable — it is part of the primary keys. */
export const TENANT_ID = env('TENANT_ID', 'default');
/** Bearer token for the owner console and the admin API (/api/commerce/*). */
export const ADMIN_TOKEN = env('ADMIN_TOKEN');

export function getAnthropicApiKey(): string { return env('ANTHROPIC_API_KEY'); }
export function getGeminiApiKey(): string { return env('GEMINI_API_KEY'); }
export function getGeminiFlashModel(): string { return env('GEMINI_FLASH_MODEL', 'gemini-2.5-flash'); }
export function getCommerceShoppingModel(): string { return env('COMMERCE_SHOPPING_MODEL'); }
export function getCommerceMerchantModel(): string { return env('COMMERCE_MERCHANT_MODEL'); }
/** Telegram bot for owner notifications (leads, order digests). Optional. */
export function getCommerceTelegramBotToken(): string { return env('COMMERCE_TELEGRAM_BOT_TOKEN'); }
/** Web Push keys (optional): generate with `npx web-push generate-vapid-keys`. */
export function getVapid(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = env('VAPID_PUBLIC_KEY'); const privateKey = env('VAPID_PRIVATE_KEY');
  return publicKey && privateKey ? { publicKey, privateKey, subject: env('VAPID_SUBJECT', 'mailto:owner@example.com') } : null;
}
export function getGeminiApiKeyPool(): string[] { const k = getGeminiApiKey(); return k ? [k] : []; }
