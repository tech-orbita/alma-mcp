import type { Server } from 'node:http';
import { once } from 'node:events';
import pino from 'pino';
import type { AppConfig } from '../src/config.js';

export const silentLogger = pino({ level: 'silent' });

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: 3000,
    TRUST_PROXY: 0,
    ALLOWED_HOSTS: ['127.0.0.1', 'localhost'],
    MCP_BEARER_TOKEN: 'test-mcp-bearer-token-32-characters-minimum',
    ALMA_BASE_URL: 'http://127.0.0.1:4010/api/',
    ALMA_API_TOKEN: 'different-test-alma-token',
    ALMA_TIMEOUT_MS: 1_000,
    ALMA_READ_RETRIES: 1,
    ALMA_TIMEZONE: 'America/Bogota',
    SLOT_TOKEN_SECRET: 'test-slot-signing-secret-32-characters-minimum',
    SLOT_TOKEN_TTL_SECONDS: 300,
    DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:5432/unused',
    DATABASE_SSL_MODE: 'disable',
    DB_POOL_MAX: 2,
    DB_IDLE_TIMEOUT_MS: 5_000,
    LOG_LEVEL: 'silent' as AppConfig['LOG_LEVEL'],
    RATE_LIMIT_WINDOW_MS: 60_000,
    RATE_LIMIT_MAX: 120,
    MCP_SESSION_TTL_MS: 60_000,
    MCP_MAX_SESSIONS: 20,
    JSON_BODY_LIMIT: '256kb',
    SHUTDOWN_GRACE_MS: 5_000,
    ...overrides,
  };
}

export async function listenOnRandomPort(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No se obtuvo puerto de prueba');
  return address.port;
}

export async function closeServer(server: Server): Promise<void> {
  server.close();
  await once(server, 'close');
}
