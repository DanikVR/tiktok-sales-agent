/**
 * Commerce Agents — серверные переводы из тех же файлов, что и фронт: public/locales/<lang>/commerce.json
 * (в проде — apps/frontend/dist/locales). Нужны виджету (строки интерфейса уходят в /w/:slug/config)
 * и стартовым подсказкам. Кэш в памяти на 10 минут, fallback en → ru.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { CrawlStatus } from './types.js';

const __dirname_i = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATE_DIRS = [
  path.resolve(__dirname_i, '../../../locales'),          // repo/locales (dev: server/src/commerce → ../../../)
  path.resolve(__dirname_i, '../../../../locales'),       // repo/locales (built: server/dist/commerce → ../../../../)
];
const cache = new Map<string, { at: number; data: any }>();
const TTL = 10 * 60_000;

export function normalizeLang(input: string | null | undefined): string {
  const raw = String(input || '').trim().toLowerCase().replace('_', '-');
  if (!raw) return 'en';
  if (raw.startsWith('zh')) return 'zh';
  const base = raw.split('-')[0];
  return /^[a-z]{2,3}$/.test(base) ? base : 'en';
}

function loadFile(lang: string): any | null {
  const hit = cache.get(lang);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  for (const dir of CANDIDATE_DIRS) {
    const f = path.join(dir, lang, 'commerce.json');
    try {
      if (fs.existsSync(f)) { const data = JSON.parse(fs.readFileSync(f, 'utf-8')); cache.set(lang, { at: Date.now(), data }); return data; }
    } catch { /* сломанный файл — пробуем следующий */ }
  }
  cache.set(lang, { at: Date.now(), data: null });
  return null;
}

function get(obj: any, key: string): unknown {
  return key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

/** Перевод по ключу с fallback en → ru; {{var}} подставляются из params. */
export function tw(lang: string, key: string, params?: Record<string, string | number>): string {
  const l = normalizeLang(lang);
  let v = get(loadFile(l), key);
  if (typeof v !== 'string' && l !== 'en') v = get(loadFile('en'), key);
  if (typeof v !== 'string') v = get(loadFile('ru'), key);
  let s = typeof v === 'string' ? v : key;
  if (params) for (const [k, val] of Object.entries(params)) s = s.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), () => String(val));
  return s;
}

/** Поддерево строк виджета (w.*) для языка — уходит в конфиг виджета целиком. */
export function widgetStrings(lang: string): Record<string, unknown> {
  const l = normalizeLang(lang);
  const base = (get(loadFile('en'), 'w') as Record<string, unknown>) || (get(loadFile('ru'), 'w') as Record<string, unknown>) || {};
  const own = l === 'en' ? {} : ((get(loadFile(l), 'w') as Record<string, unknown>) || {});
  // Глубокое слияние на два уровня (progress.*, starters.*)
  const out: Record<string, unknown> = { ...base, ...own };
  for (const k of ['progress', 'starters', 'install', 'push', 'consent']) out[k] = { ...((base as any)[k] || {}), ...((own as any)[k] || {}) };
  return out;
}

export function hasLang(lang: string): boolean { return !!loadFile(normalizeLang(lang)); }

// ── Серверные сообщения по языку запроса / владельца ──────────────────────────
export type MsgPart = [string, Record<string, string | number>?];

/** Язык запроса: заголовок X-Lang (кабинет шлёт язык интерфейса), ?lang, Accept-Language. */
export function reqLang(req: { headers?: any; query?: any; acceptsLanguages?: () => string[] }): string {
  const h = req.headers?.['x-lang'];
  const q = req.query?.lang;
  let a = '';
  try { a = req.acceptsLanguages?.()?.[0] || ''; } catch { a = ''; }
  return normalizeLang(String((Array.isArray(h) ? h[0] : h) || q || a || 'en'));
}

/** Язык владельца витрины: последний язык кабинета → язык витрины → ru. */
export function ownerLangOf(s: { owner_lang?: string | null; language?: string | null } | null | undefined): string {
  return normalizeLang(s?.owner_lang || (s?.language && s.language !== 'auto' ? s.language : '') || 'ru');
}

/** Ошибка с ключом словаря: message — русский текст (логи, старые клиенты), key+params — перевод при показе. */
export class LocalizedError extends Error {
  key: string;
  params?: Record<string, string | number>;
  constructor(key: string, params?: Record<string, string | number>) { super(tw('ru', key, params)); this.key = key; this.params = params; }
}
export function errParts(err: unknown): MsgPart[] {
  if (err instanceof LocalizedError) return [[err.key, err.params]];
  return [['srv.raw', { msg: (err as Error)?.message || String(err) }]];
}
export function errText(err: unknown, lang: string): string {
  return err instanceof LocalizedError ? tw(lang, err.key, err.params) : ((err as Error)?.message || String(err));
}
export function renderParts(lang: string, parts: MsgPart[]): string {
  return parts.map(([k, p]) => tw(lang, k, p)).filter(Boolean).join(' ');
}

/** Фаза / итог / трасса задания: в статусе храним ключи, русский текст — как fallback. */
export function setPhase(st: CrawlStatus, key: string, params?: Record<string, string | number>): void {
  st.phase_key = key; st.phase_params = params; st.phase = tw('ru', key, params);
}
export function clearPhase(st: CrawlStatus): void { st.phase = undefined; st.phase_key = undefined; st.phase_params = undefined; }
export function setMessage(st: CrawlStatus, parts: MsgPart[]): void { st.message_parts = parts; st.message = renderParts('ru', parts); }
export function pushTrace(st: CrawlStatus, key: string, params?: Record<string, string | number>): void {
  if (!st.trace_parts) st.trace_parts = [];
  if (!st.trace) st.trace = [];
  st.trace_parts.push([key, params]);
  st.trace.push(tw('ru', key, params));
}
/** Копия статуса с текстами на языке зрителя (для ответа API; в БД остаются ключи). */
export function localizeStatus<T extends CrawlStatus | null | undefined>(st: T, lang: string): T {
  if (!st) return st;
  const out: CrawlStatus = { ...(st as CrawlStatus) };
  if (st.phase_key) out.phase = tw(lang, st.phase_key, st.phase_params);
  if (st.message_parts?.length) out.message = renderParts(lang, st.message_parts);
  if (st.trace_parts?.length) out.trace = st.trace_parts.map(([k, q]) => tw(lang, k, q));
  return out as T;
}
