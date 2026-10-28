import 'dotenv/config';
import { loadConfig } from '../config.js';
import { createPool } from './pool.js';
import { runMigrations } from './migrate.js';

const config = loadConfig();
const pool = createPool(config);

try {
  await runMigrations(pool);
  process.stdout.write('Migraciones aplicadas correctamente.\n');
} finally {
  await pool.end();
}
