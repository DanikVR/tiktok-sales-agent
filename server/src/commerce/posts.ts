/**
 * Commerce Agents — посты владельца из соцсетей (Instagram, TikTok, Telegram) как источник для агента:
 * покупатель просит примеры работ, отзывы, новости, акции — агент ищет по постам (search_posts)
 * и показывает карточки (present_posts) со ссылкой на оригинал. Хранится текст, транскрипт и
 * текст с экрана из видео, локальная обложка; сами видео не хранятся.
 */

import pool, { isFallbackActive } from '../db.js';

export interface CommercePost {
  id: string; tenant_id: string; source: string; post_id: string; url: string; text: string; image_url: string | null;
  taken_at: string | null; transcript: string | null; on_screen: string | null; visual: string | null; views: number | null; is_video?: boolean;
}
export type PostInput = Omit<CommercePost, 'id' | 'tenant_id'>;

const mem = new Map<string, CommercePost[]>();
const COLS = 'id, tenant_id, source, post_id, url, text, image_url, taken_at, transcript, on_screen, visual, views, is_video';

function searchText(p: PostInput): string {
  return [p.text, p.transcript, p.on_screen, p.visual].filter(Boolean).join(' \n ').toLowerCase().slice(0, 20_000);
}

export async function upsertPost(tenantId: string, p: PostInput): Promise<void> {
  if (isFallbackActive()) {
    const list = mem.get(tenantId) || [];
    const i = list.findIndex((x) => x.source === p.source && x.post_id === p.post_id);
    const row: CommercePost = { id: i >= 0 ? list[i].id : `${p.source}:${p.post_id}`, tenant_id: tenantId, ...p };
    if (i >= 0) list[i] = row; else list.push(row);
    mem.set(tenantId, list);
    return;
  }
  await pool.query(
    `INSERT INTO commerce_posts (tenant_id, source, post_id, url, text, image_url, taken_at, transcript, on_screen, visual, views, search_text, is_video)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (tenant_id, source, post_id) DO UPDATE SET
       url = EXCLUDED.url, text = EXCLUDED.text, image_url = COALESCE(EXCLUDED.image_url, commerce_posts.image_url), taken_at = COALESCE(EXCLUDED.taken_at, commerce_posts.taken_at),
       transcript = COALESCE(EXCLUDED.transcript, commerce_posts.transcript), on_screen = COALESCE(EXCLUDED.on_screen, commerce_posts.on_screen),
       visual = COALESCE(EXCLUDED.visual, commerce_posts.visual), views = COALESCE(EXCLUDED.views, commerce_posts.views),
       search_text = EXCLUDED.search_text, is_video = EXCLUDED.is_video, updated_at = now()`,
    [tenantId, p.source, p.post_id, p.url, p.text || '', p.image_url, p.taken_at, p.transcript, p.on_screen, p.visual, p.views, searchText(p), !!p.is_video],
  );
}

export async function countPosts(tenantId: string): Promise<number> {
  if (isFallbackActive()) return (mem.get(tenantId) || []).length;
  const r = await pool.query(`SELECT count(*)::int AS n FROM commerce_posts WHERE tenant_id = $1`, [tenantId]).catch(() => ({ rows: [] as any[] }));
  return (r.rows as any[])[0]?.n || 0;
}

/** Поиск по постам: полнотекст (simple) + подстроки; пустой запрос — последние посты. */
export async function searchPosts(tenantId: string, query: string, limit = 6): Promise<CommercePost[]> {
  const q = String(query || '').trim().toLowerCase();
  const tokens = q.split(/[\s,.;:!?()"'«»]+/).filter((t) => t.length >= 3).slice(0, 6);
  if (isFallbackActive()) {
    const list = mem.get(tenantId) || [];
    const scored = list.map((p) => { const t = searchText(p); return { p, s: tokens.reduce((n, tk) => n + (t.includes(tk) ? 1 : 0), 0) }; });
    return (tokens.length ? scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s) : scored).slice(0, limit).map((x) => x.p);
  }
  if (!tokens.length) {
    const r = await pool.query(`SELECT ${COLS} FROM commerce_posts WHERE tenant_id = $1 ORDER BY taken_at DESC NULLS LAST LIMIT $2`, [tenantId, limit]);
    return r.rows as CommercePost[];
  }
  const r = await pool.query(
    `SELECT ${COLS}, ts_rank(to_tsvector('simple', search_text), plainto_tsquery('simple', $2)) AS rank,
            (SELECT count(*) FROM unnest($3::text[]) t WHERE search_text LIKE t) AS hits
       FROM commerce_posts
      WHERE tenant_id = $1 AND (to_tsvector('simple', search_text) @@ plainto_tsquery('simple', $2) OR search_text LIKE ANY($3::text[]))
      ORDER BY hits DESC, rank DESC, taken_at DESC NULLS LAST
      LIMIT $4`,
    [tenantId, q, tokens.map((t) => `%${t}%`), limit],
  );
  return r.rows as CommercePost[];
}

export async function getPostsByIds(tenantId: string, ids: string[]): Promise<CommercePost[]> {
  const clean = Array.from(new Set(ids.filter(Boolean))).slice(0, 8);
  if (!clean.length) return [];
  if (isFallbackActive()) return (mem.get(tenantId) || []).filter((p) => clean.includes(p.id));
  const uuids = clean.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!uuids.length) return [];
  const r = await pool.query(`SELECT ${COLS} FROM commerce_posts WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, uuids]);
  return r.rows as CommercePost[];
}

export async function listPosts(tenantId: string, opts: { source?: string | null; limit?: number } = {}): Promise<CommercePost[]> {
  const limit = Math.min(200, Math.max(1, opts.limit || 50));
  if (isFallbackActive()) return (mem.get(tenantId) || []).filter((p) => !opts.source || p.source === opts.source).slice(0, limit);
  const r = await pool.query(`SELECT ${COLS} FROM commerce_posts WHERE tenant_id = $1 ${opts.source ? 'AND source = $3' : ''} ORDER BY taken_at DESC NULLS LAST LIMIT $2`, opts.source ? [tenantId, limit, opts.source] : [tenantId, limit]);
  return r.rows as CommercePost[];
}

export async function deletePostsBySource(tenantId: string, source: string): Promise<number> {
  if (isFallbackActive()) { const list = mem.get(tenantId) || []; const keep = list.filter((p) => p.source !== source); mem.set(tenantId, keep); return list.length - keep.length; }
  const r = await pool.query(`DELETE FROM commerce_posts WHERE tenant_id = $1 AND source = $2`, [tenantId, source]);
  return r.rowCount || 0;
}
