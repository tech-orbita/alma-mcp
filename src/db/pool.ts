import pg from 'pg';
import type { AppConfig } from '../config.js';

const { Pool } = pg;

export function createPool(config: AppConfig): pg.Pool {
  return new Pool({
    connectionString: config.DATABASE_URL,
    max: config.DB_POOL_MAX,
    idleTimeoutMillis: config.DB_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: 5_000,
    application_name: 'alma-mcp',
    ssl: config.DATABASE_SSL_MODE === 'require' ? { rejectUnauthorized: true } : false,
  });
}

export async function databaseIsReady(pool: pg.Pool): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
