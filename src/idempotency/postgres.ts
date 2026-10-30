import type { Logger } from 'pino';
import type pg from 'pg';
import { AppError, toAppError, type SafeErrorDetails } from '../errors.js';
import { lockFingerprint, stableHash } from '../utils/hash.js';
import type { MutationCoordinator, MutationRequest, MutationResult } from './types.js';

interface OperationRow {
  request_hash: string;
  status: 'pending' | 'succeeded' | 'failed' | 'uncertain';
  response: unknown;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: SafeErrorDetails;
  } | null;
}

export class PostgresMutationCoordinator implements MutationCoordinator {
  public constructor(private readonly pool: pg.Pool, private readonly logger: Logger) {}

  public async execute<T>(request: MutationRequest<T>): Promise<MutationResult<T>> {
    const client = await this.pool.connect();
    const lockKeys = [...new Set(request.lockKeys.map(lockFingerprint))].sort();
    try {
      for (const lockKey of lockKeys) {
        await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lockKey]);
      }

      await client.query('BEGIN');
      const existing = await client.query<OperationRow>(
        `SELECT request_hash, status, response, error
           FROM mutation_operations
          WHERE operation = $1 AND idempotency_key = $2
          FOR UPDATE`,
        [request.operation, request.idempotencyKey],
      );
      const row = existing.rows[0];
      if (row !== undefined) {
        await client.query('COMMIT');
        return this.replay<T>(row, request.requestHash);
      }

      if (request.slotTokenHash !== undefined) {
        const consumed = await client.query<{ operation: string; idempotency_key: string }>(
          'SELECT operation, idempotency_key FROM consumed_slot_tokens WHERE token_hash = $1',
          [request.slotTokenHash],
        );
        const owner = consumed.rows[0];
        if (owner !== undefined) {
          await client.query('ROLLBACK');
          throw new AppError({
            code: 'SLOT_YA_CONSUMIDO',
            message: 'Este horario ya fue usado en otra operación. Consulte disponibilidad nuevamente.',
            httpStatus: 409,
          });
        }
      }

      await client.query(
        `INSERT INTO mutation_operations
           (operation, idempotency_key, request_hash, status)
         VALUES ($1, $2, $3, 'pending')`,
        [request.operation, request.idempotencyKey, request.requestHash],
      );
      if (request.slotTokenHash !== undefined) {
        await client.query(
          `INSERT INTO consumed_slot_tokens (token_hash, operation, idempotency_key)
           VALUES ($1, $2, $3)`,
          [request.slotTokenHash, request.operation, request.idempotencyKey],
        );
      }
      await client.query('COMMIT');

      let value: T;
      try {
        value = await request.run();
      } catch (error) {
        const safe = toAppError(error);
        const ambiguous = ['TIMEOUT_ALMA', 'ALMA_NO_DISPONIBLE', 'RESULTADO_MUTACION_INCIERTO'].includes(safe.code);
        const storedError = ambiguous
          ? new AppError({
              code: 'RESULTADO_MUTACION_INCIERTO',
              message: 'No se puede confirmar el resultado en ALMA. Requiere reconciliación antes de reintentar.',
              httpStatus: 409,
            })
          : safe;
        await this.complete(client, request, ambiguous ? 'uncertain' : 'failed', null, storedError, request.entityId);
        throw storedError;
      }
      const entityId = request.getEntityId?.(value) ?? request.entityId;
      await this.complete(client, request, 'succeeded', value, null, entityId);
      return { value, cached: false };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // La transacción puede estar ya cerrada; el error original conserva prioridad.
      }
      throw error;
    } finally {
      for (const lockKey of lockKeys.reverse()) {
        try {
          await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey]);
        } catch (error) {
          this.logger.error({ error: toAppError(error).code }, 'No fue posible liberar un advisory lock');
        }
      }
      client.release();
    }
  }

  private replay<T>(row: OperationRow, requestHash: string): MutationResult<T> {
    if (row.request_hash !== requestHash) {
      throw new AppError({
        code: 'IDEMPOTENCIA_CONFLICTO',
        message: 'La clave de idempotencia ya fue usada con datos diferentes.',
        httpStatus: 409,
      });
    }
    if (row.status === 'succeeded') return { value: row.response as T, cached: true };
    if (row.status === 'failed' && row.error !== null) {
      throw new AppError({ ...row.error, httpStatus: 422 });
    }
    throw new AppError({
      code: 'IDEMPOTENCIA_EN_REVISION',
      message: 'La operación está en curso o requiere reconciliación. No la reintente con otra clave.',
      httpStatus: 409,
    });
  }

  private async complete<T>(
    client: pg.PoolClient,
    request: MutationRequest<T>,
    status: 'succeeded' | 'failed' | 'uncertain',
    response: T | null,
    error: AppError | null,
    entityId: string | undefined,
  ): Promise<void> {
    await client.query('BEGIN');
    try {
      const safeError =
        error === null
          ? null
          : { code: error.code, message: error.message, retryable: error.retryable, details: error.details };
      await client.query(
        `UPDATE mutation_operations
            SET status = $3, response = $4, error = $5, updated_at = now(), completed_at = now()
          WHERE operation = $1 AND idempotency_key = $2`,
        [request.operation, request.idempotencyKey, status, response, safeError],
      );
      await client.query(
        `INSERT INTO audit_events
           (correlation_id, operation, outcome, entity_type, entity_id, idempotency_fingerprint)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
        [
          request.operation,
          status,
          request.entityType,
          entityId ?? null,
          stableHash(request.idempotencyKey),
        ],
      );
      await client.query('COMMIT');
    } catch (completionError) {
      await client.query('ROLLBACK');
      throw new AppError({
        code: 'PERSISTENCIA_MUTACION_INCIERTA',
        message: 'La respuesta de ALMA no pudo registrarse de forma segura. Requiere reconciliación.',
        httpStatus: 500,
        cause: completionError,
      });
    }
  }
}
