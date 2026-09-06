/**
 * Instagram Direct (instagrapi / private API) — конфиг подключения к сайдкару + статус сессии.
 *
 * Зеркалит whatsapp_baileys/baileys_config. Транспорт живёт в отдельном процессе
 * (services/ig-gateway, Python). Бэкенд общается с ним по HTTP c общим секретом
 * (заголовок X-IG-Secret). НЕ официальный Graph API (см. channels/instagram/* — тот
 * НЕ трогаем; этот канал изолирован, CHANNEL='instagram_private'). Здесь только:
 * адрес/секрет шлюза + мелкая таблица статуса per-tenant (источник живого статуса —
 * сам сайдкар).
 */

import pool from './db.js';

/** База URL сайдкара ig-gateway (без хвостового слэша). */
export function gatewayBaseUrl(): string {
  return (process.env.IG_GATEWAY_URL || 'http://127.0.0.1:8788').replace(/\/+$/, '');
}

/** Общий секрет с сайдкаром (заголовок X-IG-Secret). */
export function gatewaySecret(): string {
  return process.env.IG_GATEWAY_SECRET || '';
}

/** Транспорт сконфигурирован (задан адрес шлюза и секрет). */
export function igpConfigured(): boolean {
  return !!process.env.IG_GATEWAY_URL && !!process.env.IG_GATEWAY_SECRET;
}

export interface IgPrivateSessionRow {
  tenantId: string;
  igUsername: string | null;
  status: string;
}

/** Апсертит статус сессии тенанта (для UI/аудита). Best-effort. */
export async function upsertIgPrivateSession(
  tenantId: string,
  status: string,
  igUsername?: string | null,
): Promise<void> {
  try {
    // $4 — булев флаг «подключено» (отдельный параметр, чтобы Postgres не путал типы $3).
    await pool.query(
      `INSERT INTO ig_private_sessions (tenant_id, ig_username, status, connected_at, updated_at)
       VALUES ($1, $2, $3, CASE WHEN $4 THEN CURRENT_TIMESTAMP ELSE NULL END, CURRENT_TIMESTAMP)
       ON CONFLICT (tenant_id) DO UPDATE SET
         ig_username  = COALESCE(EXCLUDED.ig_username, ig_private_sessions.ig_username),
         status       = EXCLUDED.status,
         connected_at = CASE WHEN $4 THEN CURRENT_TIMESTAMP ELSE ig_private_sessions.connected_at END,
         updated_at   = CURRENT_TIMESTAMP`,
      [tenantId, igUsername ?? null, status, status === 'connected'],
    );
  } catch (e) {
    console.warn('[ig-direct] upsert session failed:', (e as Error).message);
  }
}

/** Статус сессии тенанта из БД (или null). */
export async function getIgPrivateSession(tenantId: string): Promise<IgPrivateSessionRow | null> {
  try {
    const r = await pool.query(
      `SELECT tenant_id, ig_username, status FROM ig_private_sessions WHERE tenant_id = $1 LIMIT 1`,
      [tenantId],
    );
    const row = (r.rows as any[])[0];
    return row
      ? { tenantId: row.tenant_id, igUsername: row.ig_username, status: row.status }
      : null;
  } catch {
    return null;
  }
}
