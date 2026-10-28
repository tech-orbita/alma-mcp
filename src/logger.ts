import pino, { type Logger } from 'pino';

const sensitiveKeys = new Set([
  'authorization',
  'token',
  'access_token',
  'api_token',
  'secret',
  'password',
  'identificacion',
  'documento',
  'telefono',
  'correo',
  'email',
  'nombre',
  'apellido',
  'observacion',
  'motivo',
]);

export function redactForLog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForLog);
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      sensitiveKeys.has(key.toLowerCase()) ? '[REDACTED]' : redactForLog(nested),
    ]),
  );
}

export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: 'alma-mcp' },
    redact: {
      paths: [
        'req.headers.authorization',
        'headers.authorization',
        '*.token',
        '*.secret',
        '*.password',
        '*.identificacion',
        '*.documento',
        '*.telefono',
        '*.correo',
      ],
      censor: '[REDACTED]',
    },
  });
}
