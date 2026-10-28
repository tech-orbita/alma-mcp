import { describe, expect, it } from 'vitest';
import { ALMA_ROUTES, appointmentRoute, buildAlmaUrl } from '../src/alma/url.js';
import { loadConfig } from '../src/config.js';
import { isAuthorizedBearer } from '../src/http/auth.js';

const validEnvironment = {
  NODE_ENV: 'test',
  MCP_BEARER_TOKEN: 'mcp-token-that-is-at-least-32-characters-long',
  ALMA_BASE_URL: 'https://alma.example/api/',
  ALMA_API_TOKEN: 'alma-token-different',
  SLOT_TOKEN_SECRET: 'slot-token-secret-at-least-32-characters-long',
  DATABASE_URL: 'postgresql://user:pass@db/alma',
};

describe('normalización de URL ALMA', () => {
  it.each([
    ['https://alma.example/api/', 'https://alma.example/api/agendamiento/citas/'],
    ['https://alma.example', 'https://alma.example/api/agendamiento/citas/'],
    ['https://alma.example/custom/api/', 'https://alma.example/custom/api/agendamiento/citas/'],
  ])('evita duplicar /api con base %s', (base, expected) => {
    expect(buildAlmaUrl(base, ALMA_ROUTES.citas).toString()).toBe(expected);
  });

  it('codifica query sin concatenación manual', () => {
    const url = buildAlmaUrl('https://alma.example/api/', ALMA_ROUTES.clientes, { identificacion: 'ABC 123' });
    expect(url.searchParams.get('identificacion')).toBe('ABC 123');
    expect(url.pathname).toBe('/api/agendamiento/clientes/');
  });

  it('rechaza rutas absolutas o traversal', () => {
    expect(() => buildAlmaUrl('https://alma.example/api/', 'https://evil.example/api')).toThrow();
    expect(() => buildAlmaUrl('https://alma.example/api/', '/../secreto')).toThrow();
    expect(() => appointmentRoute(0)).toThrow();
  });
});

describe('autenticación y configuración', () => {
  it('acepta únicamente Bearer exacto', () => {
    const token = validEnvironment.MCP_BEARER_TOKEN;
    expect(isAuthorizedBearer(`Bearer ${token}`, token)).toBe(true);
    expect(isAuthorizedBearer(`Token ${token}`, token)).toBe(false);
    expect(isAuthorizedBearer(`Bearer ${token}x`, token)).toBe(false);
    expect(isAuthorizedBearer(undefined, token)).toBe(false);
  });

  it('exige secretos independientes y zona horaria válida', () => {
    expect(() => loadConfig({ ...validEnvironment, ALMA_API_TOKEN: validEnvironment.MCP_BEARER_TOKEN })).toThrow();
    expect(() => loadConfig({ ...validEnvironment, ALMA_TIMEZONE: 'Mars/Olympus' })).toThrow();
  });

  it('exige HTTPS hacia ALMA en producción', () => {
    expect(() => loadConfig({ ...validEnvironment, NODE_ENV: 'production', ALMA_BASE_URL: 'http://alma.example/api/' })).toThrow();
  });
});
