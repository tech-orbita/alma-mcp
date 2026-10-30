import { describe, expect, it, vi } from 'vitest';
import type { AlmaClient } from '../src/alma/client.js';
import { InMemoryMutationCoordinator } from '../src/idempotency/in-memory.js';
import { SlotTokenService } from '../src/security/slot-token.js';
import { ToolService } from '../src/tools/service.js';
import { silentLogger } from './helpers.js';

const makeService = (alma: unknown) => new ToolService({ alma: alma as AlmaClient, mutations: new InMemoryMutationCoordinator(), slotTokens: new SlotTokenService('a'.repeat(32), 'America/Bogota', 300), timeZone: 'America/Bogota', logger: silentLogger });

describe('catálogo filtrado', () => {
  it('revisa todas las páginas, filtra sin acentos y reutiliza la caché', async () => {
    const list = vi.fn(async (page?: number) => page === 1
      ? { count: 2, next: 'https://alma.test/?page=2', previous: null, servicios: [{ id: 328, nombre: 'Aerógrafo', duracion: 30, valoracion: false }] }
      : { count: 2, next: null, previous: 'https://alma.test/?page=1', servicios: [{ id: 122, nombre: 'Masaje de relajación', duracion: 60, valoracion: false }] });
    const service = makeService({ listarServicios: list });
    const result = await service.listarServicios({ buscar: 'RELAJACION' });
    expect(result.servicios.map(x => x.id)).toEqual([122]);
    const none = await service.listarServicios({ buscar: 'masaje corporal' });
    expect(none.servicios).toEqual([]);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('limita coincidencias y permite recorrerlas', async () => {
    const list = vi.fn(async () => ({ count: 18, next: null, previous: null, servicios: Array.from({ length: 18 }, (_, i) => ({ id: i + 1, nombre: `Masaje ${i + 1}`, duracion: 30, valoracion: false })) }));
    const service = makeService({ listarServicios: list });
    const first = await service.listarServicios({ buscar: 'masaje' });
    const second = await service.listarServicios({ buscar: 'masaje', page: 2 });
    expect(first.servicios).toHaveLength(15);
    expect(first).toMatchObject({ count: 18, hay_mas: true, pagina: 1 });
    expect(second.servicios).toHaveLength(3);
    expect(second).toMatchObject({ hay_mas: false, pagina: 2 });
  });
});


it('trata una respuesta de escritura con otro servicio como incierta y no reenvía', async () => {
  const tokens = new SlotTokenService('b'.repeat(32), 'America/Bogota', 300);
  const token = tokens.sign({ sucursal: 1, servicio: 10, especialista: 25, fecha: '2026-11-03', horaInicio: '09:00', horaFin: '09:30' });
  const write = vi.fn(async () => ({ cita: { id: 1, estado: 'Pendiente', fecha: '2026-11-03', horaInicio: '09:00', horaFin: '09:30', cliente: 50, especialista: 25, sucursal: 1, servicio: 328 } }));
  const alma = { listarServicios: async () => ({ count: 1, next: null, previous: null, servicios: [{ id: 10, nombre: 'Masaje', duracion: 30, valoracion: false }] }), crearCita: write };
  const service = new ToolService({ alma: alma as unknown as AlmaClient, mutations: new InMemoryMutationCoordinator(), slotTokens: tokens, timeZone: 'America/Bogota', logger: silentLogger });
  const input = { tipo_cliente: 'existente' as const, cliente_id: 50, servicio_id: 10, servicio_nombre: 'Masaje', slot_token: token, confirmacion: true as const, idempotency_key: 'incorrect-provider-response-1' };
  await expect(service.crearCita(input)).rejects.toMatchObject({ code: 'RESULTADO_MUTACION_INCIERTO' });
  await expect(service.crearCita(input)).rejects.toMatchObject({ code: 'IDEMPOTENCIA_EN_REVISION' });
  expect(write).toHaveBeenCalledTimes(1);
});
