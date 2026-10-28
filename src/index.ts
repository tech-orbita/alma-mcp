import 'dotenv/config';
import { AlmaClient } from './alma/client.js';
import { createApplication } from './app.js';
import { loadConfig } from './config.js';
import { createPool, databaseIsReady } from './db/pool.js';
import { toAppError } from './errors.js';
import { PostgresMutationCoordinator } from './idempotency/postgres.js';
import { createLogger } from './logger.js';
import { SlotTokenService } from './security/slot-token.js';
import { ToolService } from './tools/service.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const pool = createPool(config);
const alma = new AlmaClient({
  baseUrl: config.ALMA_BASE_URL,
  token: config.ALMA_API_TOKEN,
  timeoutMs: config.ALMA_TIMEOUT_MS,
  readRetries: config.ALMA_READ_RETRIES,
  logger,
});
const mutations = new PostgresMutationCoordinator(pool, logger);
const slotTokens = new SlotTokenService(
  config.SLOT_TOKEN_SECRET,
  config.ALMA_TIMEZONE,
  config.SLOT_TOKEN_TTL_SECONDS,
);
const tools = new ToolService({ alma, mutations, slotTokens, timeZone: config.ALMA_TIMEZONE, logger });
const application = createApplication({
  config,
  logger,
  tools,
  databaseReady: () => databaseIsReady(pool),
});

const httpServer = application.app.listen(config.PORT, config.HOST, () => {
  logger.info({ host: config.HOST, port: config.PORT }, 'ALMA MCP iniciado');
});
httpServer.requestTimeout = 30_000;
httpServer.headersTimeout = 10_000;
httpServer.keepAliveTimeout = 5_000;
httpServer.maxRequestsPerSocket = 1_000;

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Iniciando apagado ordenado');

  const forcedExit = setTimeout(() => {
    logger.fatal('Tiempo de apagado agotado');
    process.exit(1);
  }, config.SHUTDOWN_GRACE_MS);
  forcedExit.unref();

  httpServer.close();
  try {
    await application.closeSessions();
    await pool.end();
    clearTimeout(forcedExit);
    logger.info('Apagado completado');
    process.exit(0);
  } catch (error) {
    logger.error({ code: toAppError(error).code }, 'Fallo durante el apagado');
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  logger.fatal({ code: toAppError(error).code }, 'Excepción no controlada');
  void shutdown('uncaughtException');
});
process.on('unhandledRejection', (error) => {
  logger.fatal({ code: toAppError(error).code }, 'Promesa rechazada no controlada');
  void shutdown('unhandledRejection');
});
