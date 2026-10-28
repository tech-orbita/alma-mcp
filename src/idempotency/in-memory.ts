import { AppError, toAppError } from '../errors.js';
import type { MutationCoordinator, MutationRequest, MutationResult } from './types.js';

interface StoredOperation {
  requestHash: string;
  status: 'pending' | 'succeeded' | 'failed' | 'uncertain';
  response?: unknown;
  error?: AppError;
}

export class InMemoryMutationCoordinator implements MutationCoordinator {
  private readonly operations = new Map<string, StoredOperation>();
  private readonly consumedSlots = new Map<string, string>();
  private readonly lockTails = new Map<string, Promise<void>>();

  public async execute<T>(request: MutationRequest<T>): Promise<MutationResult<T>> {
    const releases: (() => void)[] = [];
    for (const key of [...new Set(request.lockKeys)].sort()) {
      releases.push(await this.acquire(key));
    }

    try {
      const operationKey = `${request.operation}:${request.idempotencyKey}`;
      const existing = this.operations.get(operationKey);
      if (existing !== undefined) return this.replay<T>(existing, request.requestHash);

      if (request.slotTokenHash !== undefined) {
        const owner = this.consumedSlots.get(request.slotTokenHash);
        if (owner !== undefined && owner !== operationKey) {
          throw new AppError({
            code: 'SLOT_YA_CONSUMIDO',
            message: 'Este horario ya fue usado en otra operación. Consulte disponibilidad nuevamente.',
            httpStatus: 409,
          });
        }
        this.consumedSlots.set(request.slotTokenHash, operationKey);
      }
      const stored: StoredOperation = { requestHash: request.requestHash, status: 'pending' };
      this.operations.set(operationKey, stored);

      try {
        const value = await request.run();
        stored.status = 'succeeded';
        stored.response = value;
        return { value, cached: false };
      } catch (error) {
        const safe = toAppError(error);
        const ambiguous = safe.code === 'TIMEOUT_ALMA' || safe.code === 'ALMA_NO_DISPONIBLE';
        stored.status = ambiguous ? 'uncertain' : 'failed';
        stored.error = ambiguous
          ? new AppError({
              code: 'RESULTADO_MUTACION_INCIERTO',
              message: 'No se puede confirmar el resultado en ALMA. Requiere reconciliación antes de reintentar.',
              httpStatus: 409,
            })
          : safe;
        throw stored.error;
      }
    } finally {
      for (const release of releases.reverse()) release();
    }
  }

  private replay<T>(stored: StoredOperation, requestHash: string): MutationResult<T> {
    if (stored.requestHash !== requestHash) {
      throw new AppError({
        code: 'IDEMPOTENCIA_CONFLICTO',
        message: 'La clave de idempotencia ya fue usada con datos diferentes.',
        httpStatus: 409,
      });
    }
    if (stored.status === 'succeeded') return { value: stored.response as T, cached: true };
    if (stored.status === 'failed' && stored.error !== undefined) throw stored.error;
    throw new AppError({
      code: 'IDEMPOTENCIA_EN_REVISION',
      message: 'La operación está en curso o requiere reconciliación. No la reintente con otra clave.',
      httpStatus: 409,
    });
  }

  private async acquire(key: string): Promise<() => void> {
    const previous = this.lockTails.get(key) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const tail = previous.then(() => current);
    this.lockTails.set(key, tail);
    await previous;
    return () => {
      releaseCurrent();
      if (this.lockTails.get(key) === tail) this.lockTails.delete(key);
    };
  }
}
