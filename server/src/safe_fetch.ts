/**
 * Анти-SSRF fetch для URL, пришедших из НЕДОВЕРЕННЫХ источников (тела вебхуков каналов,
 * вложения Chatwoot, ссылки в сообщениях). Аудит В10.
 *
 *  - только http/https;
 *  - хост резолвится в IP, приватные/loopback/link-local/CGNAT диапазоны запрещены;
 *  - редиректы проходим вручную (до 3), каждый адрес проверяем заново (redirect-to-internal);
 *  - таймаут по умолчанию 15 с.
 *
 * Хосты, которым доверяем независимо от IP (свой Chatwoot на этом же VPS и т.п.), добавляются
 * через allowPublicFetchHost(). Логика приватных диапазонов — та же, что в link_preview.
 */

import dns from 'dns/promises';
import net from 'net';

const ALLOWED_HOSTS = new Set<string>();

/** Разрешить хост (например, домен своего Chatwoot), даже если он резолвится в приватный IP. */
export function allowPublicFetchHost(hostOrUrl: string | null | undefined): void {
  if (!hostOrUrl) return;
  try {
    const host = /^[a-z]+:\/\//i.test(hostOrUrl) ? new URL(hostOrUrl).hostname : hostOrUrl;
    if (host) ALLOWED_HOSTS.add(host.toLowerCase());
  } catch { /* невалидный URL — игнорируем */ }
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) // CGNAT
    );
  }
  const low = ip.toLowerCase();
  if (low.startsWith('::ffff:')) return isPrivateIp(low.slice(7)); // IPv4-mapped
  return low === '::1' || low === '::' || low.startsWith('fc') || low.startsWith('fd') || low.startsWith('fe80');
}

/** Проверяет, что URL указывает наружу. Бросает Error с префиксом `ssrf:` при нарушении. */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let u: URL;
  try { u = new URL(String(rawUrl)); } catch { throw new Error('ssrf: invalid url'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('ssrf: scheme not allowed');
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) throw new Error('ssrf: empty host');
  if (ALLOWED_HOSTS.has(host)) return u;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('ssrf: local host');
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('ssrf: private ip');
    return u;
  }
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('ssrf: resolves to private ip');
  return u;
}

type FetchInit = NonNullable<Parameters<typeof fetch>[1]> & { timeoutMs?: number };

/** fetch с анти-SSRF проверкой адреса (и каждого редиректа) и таймаутом. */
export async function safeFetch(rawUrl: string, init?: FetchInit): Promise<Response> {
  await assertPublicUrl(rawUrl);
  const { timeoutMs = 15_000, ...rest } = init || {};
  let res = await fetch(rawUrl, { ...rest, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  let current = rawUrl;
  for (let hops = 0; hops < 3 && [301, 302, 303, 307, 308].includes(res.status); hops++) {
    const loc = res.headers.get('location');
    if (!loc) break;
    const next = new URL(loc, current).toString();
    await assertPublicUrl(next);
    current = next;
    res = await fetch(next, { ...rest, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  }
  return res;
}
