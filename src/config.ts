import { z } from 'zod';

const integerFromEnv = (minimum: number, maximum: number) =>
  z.coerce.number().int().min(minimum).max(maximum);

const commaSeparatedHosts = z
  .string()
  .min(1)
  .transform((value) =>
    value
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().min(1)).min(1));

const timeZoneSchema = z.string().min(1).refine(
  (timeZone) => {
    try {
      new Intl.DateTimeFormat('es-CO', { timeZone }).format();
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Debe ser una zona horaria IANA válida, por ejemplo America/Bogota' },
);

const urlSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    context.addIssue({ code: 'custom', message: 'Solo se permiten URLs HTTP o HTTPS' });
  }
  if (url.username || url.password) {
    context.addIssue({ code: 'custom', message: 'La URL no debe contener credenciales' });
  }
  if (url.search || url.hash) {
    context.addIssue({ code: 'custom', message: 'La URL base no debe incluir query ni fragmento' });
  }
});

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: integerFromEnv(1, 65_535).default(3000),
    TRUST_PROXY: integerFromEnv(0, 10).default(1),
    ALLOWED_HOSTS: commaSeparatedHosts.default(['localhost', '127.0.0.1']),
    MCP_BEARER_TOKEN: z.string().min(32),
    ALMA_BASE_URL: urlSchema,
    ALMA_API_TOKEN: z.string().min(8),
    ALMA_TIMEOUT_MS: integerFromEnv(500, 60_000).default(8_000),
    ALMA_READ_RETRIES: integerFromEnv(0, 4).default(2),
    ALMA_TIMEZONE: timeZoneSchema.default('America/Bogota'),
    SLOT_TOKEN_SECRET: z.string().min(32),
    SLOT_TOKEN_TTL_SECONDS: integerFromEnv(30, 1_800).default(300),
    DATABASE_URL: z.string().min(1),
    DATABASE_SSL_MODE: z.enum(['disable', 'require']).default('disable'),
    DB_POOL_MAX: integerFromEnv(1, 50).default(10),
    DB_IDLE_TIMEOUT_MS: integerFromEnv(1_000, 300_000).default(30_000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    RATE_LIMIT_WINDOW_MS: integerFromEnv(1_000, 3_600_000).default(60_000),
    RATE_LIMIT_MAX: integerFromEnv(1, 10_000).default(120),
    MCP_SESSION_TTL_MS: integerFromEnv(60_000, 86_400_000).default(1_800_000),
    MCP_MAX_SESSIONS: integerFromEnv(1, 10_000).default(1_000),
    JSON_BODY_LIMIT: z.string().regex(/^\d+(?:kb|mb)$/i).default('256kb'),
    SHUTDOWN_GRACE_MS: integerFromEnv(1_000, 60_000).default(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.MCP_BEARER_TOKEN === value.ALMA_API_TOKEN) {
      context.addIssue({
        code: 'custom',
        path: ['MCP_BEARER_TOKEN'],
        message: 'El token MCP debe ser independiente del token ALMA',
      });
    }
    if (value.SLOT_TOKEN_SECRET === value.MCP_BEARER_TOKEN || value.SLOT_TOKEN_SECRET === value.ALMA_API_TOKEN) {
      context.addIssue({
        code: 'custom',
        path: ['SLOT_TOKEN_SECRET'],
        message: 'El secreto de slots debe ser independiente de los tokens de acceso',
      });
    }
    if (value.NODE_ENV === 'production' && new URL(value.ALMA_BASE_URL).protocol !== 'https:') {
      context.addIssue({
        code: 'custom',
        path: ['ALMA_BASE_URL'],
        message: 'ALMA_BASE_URL debe usar HTTPS en producción',
      });
    }
  });

export type AppConfig = Readonly<z.infer<typeof configSchema>>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const knownEnvironment = Object.fromEntries(
    Object.keys(configSchema.shape).flatMap((key) => {
      const value = environment[key];
      return value === undefined ? [] : [[key, value]];
    }),
  );

  return Object.freeze(configSchema.parse(knownEnvironment));
}
