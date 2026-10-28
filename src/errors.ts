import { z } from 'zod';

export type SafeErrorDetails = Readonly<Record<string, string | number | boolean | null | string[]>>;

export class AppError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly httpStatus: number;
  public readonly details: SafeErrorDetails | undefined;

  public constructor(options: {
    code: string;
    message: string;
    retryable?: boolean;
    httpStatus?: number;
    details?: SafeErrorDetails;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = 'AppError';
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.httpStatus = options.httpStatus ?? 500;
    this.details = options.details;
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof z.ZodError) {
    return new AppError({
      code: 'DATOS_INVALIDOS',
      message: 'Los datos no cumplen el esquema requerido.',
      httpStatus: 400,
      details: { campos: error.issues.map((issue) => issue.path.join('.') || 'entrada') },
      cause: error,
    });
  }
  return new AppError({
    code: 'ERROR_INTERNO',
    message: 'No fue posible completar la operación de forma segura.',
    httpStatus: 500,
    cause: error,
  });
}
