/**
 * Web Push покупателям витрины. VAPID-ключи генерируются один раз и хранятся в БД (commerce_push_config).
 * Подписки привязаны к витрине, посетителю (visitor_id из localStorage) и диалогу; рассылка — по диалогу
 * (подписки этого диалога или того же посетителя). Отправка сейчас или по расписанию (commerce_push_jobs,
 * планировщик раз в 30 секунд). Мёртвые подписки (404/410) отключаются.
 */
import webpush from 'web-push';
import pool, { isFallbackActive } from '../db.js';

export const PUSH_DAILY_LIMIT = 5;
const SUBJECT = process.env.WEB_PUSH_SUBJECT || 'mailto:support@vibevox.pro';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let vapid: { publicKey: string; privateKey: string } | null = null;

export async function getVapid(): Promise<{ publicKey: string; privateKey: string } | null> {
  if (vapid) return vapid;
  if (isFallbackActive()) return null;
  let row = ((await pool.query(`SELECT public_key, private_key FROM commerce_push_config WHERE id = 1`)).rows as any[])[0];
  if (!row) {
    const k = webpush.generateVAPIDKeys();
    await pool.query(`INSERT INTO commerce_push_config (id, public_key, private_key) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING`, [k.publicKey, k.privateKey]);
    row = ((await pool.query(`SELECT public_key, private_key FROM commerce_push_config WHERE id = 1`)).rows as any[])[0];
  }
  if (!row) return null;
  vapid = { publicKey: row.public_key, privateKey: row.private_key };
  webpush.setVapidDetails(SUBJECT, vapid.publicKey, vapid.privateKey);
  return vapid;
}

export interface SubInput { endpoint: string; keys: { p256dh: string; auth: string } }

export async function saveSubscription(tenantId: string, slug: string, input: { subscription: SubInput; visitorId: string | null; conversationId: string | null; lang: string | null; ua: string | null }): Promise<void> {
  if (isFallbackActive()) return;
  const sub = input.subscription;
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 2000 || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('bad_subscription');
  const conv = input.conversationId && UUID_RE.test(input.conversationId) ? input.conversationId : null;
  await pool.query(
    `INSERT INTO commerce_push_subs (tenant_id, slug, visitor_id, conversation_id, endpoint, keys, lang, ua, last_ok_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, now())
     ON CONFLICT (endpoint) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, slug = EXCLUDED.slug,
       visitor_id = coalesce(EXCLUDED.visitor_id, commerce_push_subs.visitor_id),
       conversation_id = coalesce(EXCLUDED.conversation_id, commerce_push_subs.conversation_id),
       keys = EXCLUDED.keys, lang = coalesce(EXCLUDED.lang, commerce_push_subs.lang), ua = EXCLUDED.ua,
       disabled_at = NULL, last_ok_at = now()`,
    [tenantId, slug, input.visitorId, conv, sub.endpoint, JSON.stringify({ p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) }), input.lang, input.ua],
  );
}

export async function removeSubscription(endpoint: string): Promise<void> {
  if (isFallbackActive()) return;
  await pool.query(`UPDATE commerce_push_subs SET disabled_at = now() WHERE endpoint = $1`, [endpoint]);
}

const SUBS_WHERE = `s.tenant_id = $1 AND s.disabled_at IS NULL AND (s.conversation_id = $2::uuid OR s.visitor_id = (SELECT visitor_id FROM commerce_conversations WHERE id = $2::uuid))`;

async function subsFor(tenantId: string, conversationId: string | null): Promise<Array<{ id: string; endpoint: string; keys: { p256dh: string; auth: string } }>> {
  if (isFallbackActive()) return [];
  const r = conversationId && UUID_RE.test(conversationId)
    ? await pool.query(`SELECT s.id, s.endpoint, s.keys FROM commerce_push_subs s WHERE ${SUBS_WHERE}`, [tenantId, conversationId])
    : await pool.query(`SELECT s.id, s.endpoint, s.keys FROM commerce_push_subs s WHERE s.tenant_id = $1 AND s.disabled_at IS NULL`, [tenantId]);
  return (r.rows as any[]).map((x) => ({ id: x.id, endpoint: x.endpoint, keys: typeof x.keys === 'string' ? JSON.parse(x.keys) : x.keys }));
}

export async function countSubs(tenantId: string, conversationId: string | null): Promise<number> {
  return (await subsFor(tenantId, conversationId)).length;
}

export async function sendPush(tenantId: string, opts: { conversationId: string | null; title: string; body: string; url: string; icon?: string | null; tag?: string }): Promise<{ sent: number; failed: number }> {
  const v = await getVapid();
  if (!v) return { sent: 0, failed: 0 };
  const subs = await subsFor(tenantId, opts.conversationId);
  let sent = 0; let failed = 0;
  const payload = JSON.stringify({ title: opts.title, body: opts.body, url: opts.url, icon: opts.icon || undefined, tag: opts.tag || `comag-${tenantId}` });
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 86_400 });
      sent++;
      await pool.query(`UPDATE commerce_push_subs SET last_ok_at = now() WHERE id = $1`, [s.id]).catch(() => {});
    } catch (e: any) {
      failed++;
      const st = e?.statusCode;
      if (st === 404 || st === 410) await pool.query(`UPDATE commerce_push_subs SET disabled_at = now() WHERE id = $1`, [s.id]).catch(() => {});
      else console.warn('[commerce/push] send failed:', st, e?.message || e);
    }
  }));
  return { sent, failed };
}

// ── Задания: сейчас или по расписанию ─────────────────────────────────────────

export interface PushJob { id: string; tenant_id: string; conversation_id: string | null; title: string; body: string; url: string | null; icon: string | null; send_at: string; status: string; sent: number; failed: number; created_at: string; sent_at: string | null }

function mapJob(r: any): PushJob {
  const iso = (v: any) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
  return { id: r.id, tenant_id: r.tenant_id, conversation_id: r.conversation_id || null, title: r.title, body: r.body, url: r.url || null, icon: r.icon || null, send_at: iso(r.send_at) as string, status: r.status, sent: Number(r.sent || 0), failed: Number(r.failed || 0), created_at: iso(r.created_at) as string, sent_at: iso(r.sent_at) };
}

export async function createPushJob(tenantId: string, input: { conversationId: string | null; title: string; body: string; url: string; icon: string | null; sendAt: Date | null }): Promise<PushJob> {
  const scheduled = !!input.sendAt && +input.sendAt > Date.now() + 30_000;
  const r = await pool.query(
    `INSERT INTO commerce_push_jobs (tenant_id, conversation_id, title, body, url, icon, send_at, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [tenantId, input.conversationId, input.title, input.body, input.url, input.icon, scheduled ? input.sendAt : new Date(), scheduled ? 'scheduled' : 'sending'],
  );
  let job = mapJob((r.rows as any[])[0]);
  if (!scheduled) job = await deliver(job);
  return job;
}

async function deliver(job: PushJob): Promise<PushJob> {
  const res = await sendPush(job.tenant_id, { conversationId: job.conversation_id, title: job.title, body: job.body, url: job.url || '/', icon: job.icon, tag: `comag-${job.id}` });
  const r = await pool.query(`UPDATE commerce_push_jobs SET status = 'sent', sent = $2, failed = $3, sent_at = now() WHERE id = $1 RETURNING *`, [job.id, res.sent, res.failed]);
  return mapJob((r.rows as any[])[0] || { ...job, status: 'sent', sent: res.sent, failed: res.failed });
}

export async function listPushJobs(tenantId: string, conversationId: string | null, limit = 20): Promise<PushJob[]> {
  if (isFallbackActive()) return [];
  const r = conversationId
    ? await pool.query(`SELECT * FROM commerce_push_jobs WHERE tenant_id = $1 AND conversation_id = $2::uuid ORDER BY created_at DESC LIMIT $3`, [tenantId, conversationId, limit])
    : await pool.query(`SELECT * FROM commerce_push_jobs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`, [tenantId, limit]);
  return (r.rows as any[]).map(mapJob);
}

export async function cancelPushJob(tenantId: string, id: string): Promise<boolean> {
  if (isFallbackActive() || !UUID_RE.test(id)) return false;
  const r = await pool.query(`UPDATE commerce_push_jobs SET status = 'cancelled' WHERE tenant_id = $1 AND id = $2::uuid AND status = 'scheduled' RETURNING id`, [tenantId, id]);
  return (r.rowCount || 0) > 0;
}

/** Сколько уведомлений ушло/запланировано этому диалогу за сутки (лимит — PUSH_DAILY_LIMIT). */
export async function pushesLast24h(tenantId: string, conversationId: string): Promise<number> {
  if (isFallbackActive() || !UUID_RE.test(conversationId)) return 0;
  const r = await pool.query(`SELECT count(*)::int AS n FROM commerce_push_jobs WHERE tenant_id = $1 AND conversation_id = $2::uuid AND status IN ('scheduled', 'sending', 'sent') AND created_at > now() - interval '24 hours'`, [tenantId, conversationId]);
  return Number((r.rows as any[])[0]?.n || 0);
}

let schedulerStarted = false;
async function tick(): Promise<void> {
  if (isFallbackActive()) return;
  try {
    const r = await pool.query(`UPDATE commerce_push_jobs SET status = 'sending' WHERE status = 'scheduled' AND send_at <= now() RETURNING *`);
    for (const row of r.rows as any[]) { try { await deliver(mapJob(row)); } catch (e) { console.warn('[commerce/push] job failed:', (e as Error).message); } }
  } catch (e) { console.warn('[commerce/push] scheduler:', (e as Error).message); }
}
export function startPushScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const tm = setInterval(() => { void tick(); }, 30_000);
  (tm as any).unref?.();
}
