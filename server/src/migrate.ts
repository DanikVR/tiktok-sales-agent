import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Applies sql/schema.sql statement by statement (all idempotent). */
export async function migrate(): Promise<void> {
  const candidates = [path.resolve(here, '../../sql/schema.sql'), path.resolve(here, '../../../sql/schema.sql')];
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) throw new Error('sql/schema.sql not found');
  const text = fs.readFileSync(file, 'utf-8');
  const statements = text.split(/;\s*\n/).map((s) => s.replace(/^--[^\n]*\n/gm, '').trim()).filter(Boolean);
  const client = await pool.connect();
  try {
    for (const st of statements) await client.query(st);
  } finally { client.release(); }
  console.log(`[db] schema ok (${statements.length} statements)`);
}

if (process.argv[1] && /migrate\.(ts|js)$/.test(process.argv[1])) {
  migrate().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
