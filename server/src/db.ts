/**
 * Postgres pool. DATABASE_URL, e.g. postgres://commerce:commerce@localhost:5432/commerce
 * (docker-compose starts exactly that). isFallbackActive() exists for source compatibility: the
 * self-hosted edition has no in-memory fallback — without a database it fails fast at startup.
 */
import pg from 'pg';

const { Pool } = pg;
const url = process.env.DATABASE_URL || 'postgres://commerce:commerce@localhost:5432/commerce';
const pool = new Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX || 10) });
pool.on('error', (e) => console.error('[db] pool error:', e.message));

export function isFallbackActive(): boolean { return false; }
export default pool;
