import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/errors.js';
import { InMemoryMutationCoordinator } from '../src/idempotency/in-memory.js';

const base = {
  operation: 'crear_cita' as const,
  idempotencyKey: 'create-appointment-100-0001',
  requestHash: 'hash-a',
  lockKeys: ['contact-a', 'slot-a'],
  slotTokenHash: 'slot-token-hash-a',
  entityType: 'cita' as const,
};

describe('idempotencia y concurrencia', () => {
  it('deduplica dos ejecuciones concurrentes con la misma clave', async () => {
    const coordinator = new InMemoryMutationCoordinator();
    const run = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { cita: { id: 100 } };
    });
    const [first, second] = await Promise.all([
      coordinator.execute({ ...base, run }),
      coordinator.execute({ ...base, run }),
    ]);
    expect(run).toHaveBeenCalledTimes(1);
    expect([first.cached, second.cached].sort()).toEqual([false, true]);
  });

  it('rechaza reutilizar la clave con otros datos', async () => {
    const coordinator = new InMemoryMutationCoordinator();
    await coordinator.execute({ ...base, run: async () => ({ cita: { id: 100 } }) });
    await expect(
      coordinator.execute({ ...base, requestHash: 'hash-b', run: async () => ({ cita: { id: 101 } }) }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCIA_CONFLICTO' } satisfies Partial<AppError>);
  });

  it('impide consumir el mismo slot con otra clave', async () => {
    const coordinator = new InMemoryMutationCoordinator();
    await coordinator.execute({ ...base, run: async () => ({ cita: { id: 100 } }) });
    await expect(
      coordinator.execute({
        ...base,
        idempotencyKey: 'create-appointment-100-0002',
        requestHash: 'hash-b',
        run: async () => ({ cita: { id: 101 } }),
      }),
    ).rejects.toMatchObject({ code: 'SLOT_YA_CONSUMIDO' } satisfies Partial<AppError>);
  });

  it('marca como incierto un fallo de red y no vuelve a ejecutar', async () => {
    const coordinator = new InMemoryMutationCoordinator();
    const run = vi.fn(async () => {
      throw new AppError({ code: 'TIMEOUT_ALMA', message: 'timeout' });
    });
    await expect(coordinator.execute({ ...base, run })).rejects.toMatchObject({ code: 'RESULTADO_MUTACION_INCIERTO' });
    await expect(coordinator.execute({ ...base, run })).rejects.toMatchObject({ code: 'IDEMPOTENCIA_EN_REVISION' });
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('conserva en revisión una respuesta de escritura incierta', async () => {
    const coordinator = new InMemoryMutationCoordinator();
    const run = vi.fn(async () => { throw new AppError({ code: 'RESULTADO_MUTACION_INCIERTO', message: 'respuesta inválida' }); });
    await expect(coordinator.execute({ ...base, run })).rejects.toMatchObject({ code: 'RESULTADO_MUTACION_INCIERTO' });
    await expect(coordinator.execute({ ...base, run })).rejects.toMatchObject({ code: 'IDEMPOTENCIA_EN_REVISION' });
    expect(run).toHaveBeenCalledTimes(1);
  });

});
