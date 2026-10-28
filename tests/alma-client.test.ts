import { describe, expect, it, vi } from 'vitest';
import { AlmaClient } from '../src/alma/client.js';
import type { AppError } from '../src/errors.js';
import { silentLogger } from './helpers.js';

const successResponse = () =>
  new Response(
    JSON.stringify({
      success: true,
      message: '',
      data: { sucursales: [{ id: 1, nombre: 'Sede', codigo: '001', ciudadNombre: 'Medellin' }] },
      errors: [],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

function client(fetchImplementation: typeof fetch, readRetries = 2) {
  return new AlmaClient({
    baseUrl: 'https://alma.example/api/',
    token: 'alma-secret-token',
    timeoutMs: 1_000,
    readRetries,
    logger: silentLogger,
    fetchImplementation,
    sleep: async () => undefined,
    random: () => 0,
  });
}

describe('AlmaClient', () => {
  it('reintenta lecturas transitorias y normaliza /api', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(successResponse());
    const result = await client(fetchMock).listarSucursales();
    expect(result.sucursales[0]?.id).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requested = fetchMock.mock.calls[0]?.[0];
    expect(requested).toBeInstanceOf(URL);
    expect((requested as URL).toString()).toBe('https://alma.example/api/agendamiento/sucursales/');
  });

  it('nunca reintenta automáticamente una mutación ambigua', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network down'));
    await expect(
      client(fetchMock).crearCita({
        sucursal: 1,
        servicio: 10,
        especialista: 25,
        cliente: 50,
        fecha: '2026-08-10',
        horaInicio: '09:00',
        horaFin: '09:30',
      }),
    ).rejects.toMatchObject({ code: 'ALMA_NO_DISPONIBLE', retryable: false } satisfies Partial<AppError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rechaza JSON y envelope inválidos', async () => {
    const invalidJson = vi.fn<typeof fetch>().mockResolvedValue(new Response('html', { status: 200 }));
    await expect(client(invalidJson, 0).listarSucursales()).rejects.toMatchObject({ code: 'RESPUESTA_ALMA_INVALIDA' });

    const invalidEnvelope = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }));
    await expect(client(invalidEnvelope, 0).listarSucursales()).rejects.toMatchObject({ code: 'RESPUESTA_ALMA_INVALIDA' });
  });
});
