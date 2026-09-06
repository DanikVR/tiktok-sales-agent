/**
 * Instagram Direct (instagrapi) — клиент к сайдкару ig-gateway.
 *
 * Зеркалит whatsapp_baileys/baileys_client. Отправка идёт через живую сессию сайдкара
 * (не Graph API). Медиа отдаём абсолютным публичным URL (/api/uploads/...), сайдкар
 * скачивает его и шлёт клиенту. Instagram Direct не поддерживает подпись к медиа →
 * подпись передаём как отдельный текст (сайдкар шлёт медиа, затем текст).
 * Анти-бан: бот отвечает ТОЛЬКО на входящее (см. igp_inbound) + пейсинг в сайдкаре.
 */

import { gatewayBaseUrl, gatewaySecret } from './igp_config.js';
import { toAbsolutePublicMediaUrl } from './public_uploads.js';

export interface IgOutMedia {
  url?: string | null;
  mime?: string | null;
  kind?: 'image' | 'video';
}

export interface IgStatusResult {
  status: string;                 // connecting|challenge_required|connected|disconnected|error
  username: string | null;
  challenge?: { method?: string } | null;
  error?: string | null;
}

async function gw(pathname: string, init: RequestInit): Promise<Response> {
  return fetch(`${gatewayBaseUrl()}${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-ig-secret': gatewaySecret(), ...(init.headers || {}) },
  });
}

/** Доставить клиенту текст и/или медиа по thread_id. true при успехе. Best-effort (не бросает). */
export async function sendIgDirect(
  tenantId: string,
  toThreadId: string,
  msg: { text?: string | null; media?: IgOutMedia | null },
): Promise<boolean> {
  try {
    const media = msg.media && msg.media.url
      ? { url: toAbsolutePublicMediaUrl(msg.media.url, 'relative'), kind: msg.media.kind || 'image', mime: msg.media.mime || null }
      : null;
    const r = await gw(`/sessions/${encodeURIComponent(tenantId)}/send`, {
      method: 'POST',
      body: JSON.stringify({ to_thread_id: toThreadId, text: msg.text || null, media }),
    });
    if (!r.ok) {
      console.error('[ig-direct] send failed:', r.status, await r.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (e) {
    console.error('[ig-direct] send error:', (e as Error).message);
    return false;
  }
}

/** Старт сессии (логин уходит в фон на сайдкаре; статус поллим отдельно). */
export async function connectIg(
  tenantId: string,
  creds: { username: string; password: string; proxy?: string | null },
): Promise<IgStatusResult> {
  const r = await gw(`/sessions/${encodeURIComponent(tenantId)}/connect`, {
    method: 'POST',
    body: JSON.stringify({ username: creds.username, password: creds.password, proxy: creds.proxy || null }),
  });
  const d: any = await r.json().catch(() => ({}));
  return { status: d.status || 'disconnected', username: d.username || null };
}

/** Досылка кода 2FA / челленджа (подозрительный вход). */
export async function igChallenge(tenantId: string, code: string): Promise<IgStatusResult> {
  const r = await gw(`/sessions/${encodeURIComponent(tenantId)}/challenge`, {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  const d: any = await r.json().catch(() => ({}));
  return { status: d.status || 'disconnected', username: d.username || null };
}

/** Живой статус сессии (state + username + challenge, если ещё вводится код). */
export async function igStatus(tenantId: string): Promise<IgStatusResult> {
  const r = await gw(`/sessions/${encodeURIComponent(tenantId)}/status`, { method: 'GET' });
  const d: any = await r.json().catch(() => ({}));
  return {
    status: d.status || 'disconnected',
    username: d.username || null,
    challenge: d.challenge || null,
    error: d.error || null,
  };
}

/** Разлогин + чистка сессии на сайдкаре. */
export async function logoutIg(tenantId: string): Promise<void> {
  await gw(`/sessions/${encodeURIComponent(tenantId)}/logout`, { method: 'POST', body: '{}' }).catch(() => {});
}

export interface IgProxyTestResult { ok: boolean; ip?: string | null; country?: string | null; asn?: string | null; error?: string }

/** Проверка прокси-строки через сайдкар (кнопка «Проверить» в супер-админке): возвращает выходной IP/страну. */
export async function testIgProxy(proxyUrl: string): Promise<IgProxyTestResult> {
  const r = await gw(`/proxy/test`, { method: 'POST', body: JSON.stringify({ proxy: proxyUrl }) });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) return { ok: false, error: d.error || `HTTP ${r.status}` };
  return { ok: true, ip: d.ip || null, country: d.country || null, asn: d.asn || null };
}
