/**
 * Owner console helpers: authorized fetch (Bearer ADMIN_TOKEN from localStorage) and the SSE reader
 * for agent streams. Same shape as the hosted edition, minus the multi-user store.
 */
import { useAppStore } from '../../store/useAppStore';
import i18n from '../../config/i18n';
import { refreshPreview } from '../../components/commerce/widgetPreviewStore';

export function authHeaders(json = true): Record<string, string> {
  const token = useAppStore.getState().token;
  return { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-Lang': (i18n.language || 'en').slice(0, 8) };
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...authHeaders(!(init.body instanceof FormData)), ...(init.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status; err.code = data?.code; err.data = data;
    if (res.status === 401) window.dispatchEvent(new CustomEvent('comag:unauthorized'));
    throw err;
  }
  if ((init.method || 'GET') !== 'GET' && /^\/api\/commerce\/(settings|logo)(\?|$)/.test(path)) refreshPreview();
  return data as T;
}

export type AgentSseEvent =
  | { type: 'meta'; data: any }
  | { type: 'progress'; text: string }
  | { type: 'text'; delta: string }
  | { type: 'component'; component: string; data: any }
  | { type: 'cart'; data: any }
  | { type: 'done'; data?: any }
  | { type: 'error'; message: string };

/** Reads SSE from a POST response (fetch + ReadableStream), calling onEvent for every event. */
export async function readSse(res: Response, onEvent: (ev: AgentSseEvent) => void): Promise<void> {
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    onEvent({ type: 'error', message: data?.error || `HTTP ${res.status}` });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const dataLine = chunk.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      try { onEvent(JSON.parse(dataLine.slice(5).trim())); } catch { /* ignore */ }
    }
  }
}

export function fmtMoney(n: number | null | undefined, currency?: string | null): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 2 }).format(Number(n)); } catch { return `${Number(n).toFixed(2)} ${currency || ''}`; }
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? String(s) : d.toLocaleString();
}
