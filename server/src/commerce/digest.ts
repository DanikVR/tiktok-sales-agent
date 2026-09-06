/**
 * Ежедневная сводка владельцу: диалоги, карточки, корзина, заявки, покупки, выручка, горячие клиенты,
 * запросы без ответа, изменения на согласовании. Уходит в Telegram (бот платформы / свой) и на почту владельца.
 * Раз в сутки после 06:00 UTC; отметка digest_sent_on в commerce_settings защищает от повторов.
 */
import pool, { isFallbackActive } from '../db.js';
import { getSnapshot, hotConversationsSince, listChanges } from './store.js';
import { notifyOwnerTelegram, notifyOwnerEmail, publicBaseUrl } from './notify.js';
import { tw, ownerLangOf } from './i18n.js';

const HOUR_UTC = 6;
let started = false;

function money(n: number, cur: string): string { try { return new Intl.NumberFormat('en', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n); } catch { return `${Math.round(n)} ${cur}`; } }

/** Текст сводки (HTML для Telegram; для почты теги убираются). null — если диалогов, заявок и покупок не было. */
export async function buildDigest(s: { tenant_id: string; brand_name?: string | null; currency?: string | null; language?: string | null; owner_lang?: string | null }): Promise<{ tg: string; subject: string } | null> {
  const lang = ownerLangOf(s);
  const brand = (s.brand_name || 'Commerce Agents').replace(/[<>&]/g, '');
  const snap = await getSnapshot(s.tenant_id, 1);
  const cur = snap.current || ({} as any);
  const dialogs = Number(cur.dialogs || 0); const leads = Number(cur.leads || 0); const purchases = Number(cur.purchases || 0);
  const hot = await hotConversationsSince(s.tenant_id, 24);
  const pending = (await listChanges(s.tenant_id, 'staged', 50)).length;
  const lines = [tw(lang, 'srv.digest.title', { brand })];
  if (!dialogs && !leads && !purchases && !hot) lines.push(tw(lang, 'srv.digest.quiet'));
  else {
    lines.push(tw(lang, 'srv.digest.dialogs', { n: dialogs }));
    lines.push(tw(lang, 'srv.digest.cards', { n: Number(cur.cards_shown || 0) }));
    lines.push(tw(lang, 'srv.digest.cart', { n: Number(cur.add_to_cart || 0), leads, purchases }));
    if (Number(cur.revenue || 0) > 0) lines.push(tw(lang, 'srv.digest.revenue', { sum: money(Number(cur.revenue || 0), s.currency || 'EUR') }));
    lines.push(tw(lang, 'srv.digest.hot', { n: hot }));
    const empty = (snap.empty_searches || []).slice(0, 3).map((e: any) => e.query).filter(Boolean);
    if (empty.length) lines.push(tw(lang, 'srv.digest.empty', { list: empty.join(', ').replace(/[<>&]/g, '') }));
  }
  if (pending) lines.push(tw(lang, 'srv.digest.pending', { n: pending }));
  lines.push(tw(lang, 'srv.digest.link', { url: `${publicBaseUrl()}/commerce` }));
  return { tg: lines.join('\n'), subject: tw(lang, 'srv.digest.subject', { brand }) };
}

async function tick(): Promise<void> {
  if (isFallbackActive()) return;
  const now = new Date();
  if (now.getUTCHours() < HOUR_UTC) return;
  const today = now.toISOString().slice(0, 10);
  let rows: any[] = [];
  try {
    const r = await pool.query(`UPDATE commerce_settings SET digest_sent_on = $1::date WHERE (digest_sent_on IS NULL OR digest_sent_on < $1::date) AND coalesce(digest_enabled, true) RETURNING tenant_id, brand_name, currency, language, owner_lang, owner_email`, [today]);
    rows = r.rows as any[];
  } catch (e) { console.warn('[commerce/digest] select failed:', (e as Error).message); return; }
  for (const s of rows) {
    try {
      const d = await buildDigest(s);
      if (!d) continue;
      await Promise.all([notifyOwnerTelegram(s.tenant_id, d.tg), notifyOwnerEmail(s.tenant_id, d.subject, d.tg.replace(/<[^>]+>/g, ''))]);
    } catch (e) { console.warn('[commerce/digest] send failed:', s.tenant_id, (e as Error).message); }
  }
}

export function startDailyDigest(): void {
  if (started) return;
  started = true;
  const tm = setInterval(() => { void tick(); }, 10 * 60_000);
  (tm as any).unref?.();
}
