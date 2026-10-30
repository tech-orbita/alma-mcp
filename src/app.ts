import { randomUUID } from 'node:crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Express, NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import type { AppConfig } from './config.js';
import { toAppError } from './errors.js';
import { bearerAuth } from './http/auth.js';
import { fixedWindowRateLimit } from './http/rate-limit.js';
import { createMcpServer } from './mcp/server.js';
import type { ToolService } from './tools/service.js';

interface McpSession {
  transport: NodeStreamableHTTPServerTransport;
  server: McpServer;
  lastSeenAt: number;
}

export interface ApplicationDependencies {
  config: AppConfig;
  logger: Logger;
  tools: ToolService;
  databaseReady: () => Promise<boolean>;
}

export interface Application {
  app: Express;
  closeSessions: () => Promise<void>;
  sessionCount: () => number;
}

function isInitializeRequest(body: unknown): boolean {
  return body !== null && typeof body === 'object' && 'method' in body && body.method === 'initialize';
}

function jsonRpcError(response: Response, status: number, code: number, message: string): void {
  response.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
}

export function createApplication(dependencies: ApplicationDependencies): Application {
  const { config, logger } = dependencies;
  const app = createMcpExpressApp({
    host: config.HOST,
    allowedHosts: config.ALLOWED_HOSTS,
    jsonLimit: config.JSON_BODY_LIMIT,
  });
  const sessions = new Map<string, McpSession>();

  app.set('trust proxy', config.TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use((request: Request, response: Response, next: NextFunction) => {
    const requestId = request.header('x-request-id')?.slice(0, 128) ?? randomUUID();
    response.set('x-request-id', requestId);
    next();
  });

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok', service: 'alma-mcp', version: '1.2.0' });
  });

  app.get('/ready', async (_request, response) => {
    const ready = await dependencies.databaseReady();
    response.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', database: ready ? 'up' : 'down' });
  });

  const mcpGuards = [
    fixedWindowRateLimit({ windowMs: config.RATE_LIMIT_WINDOW_MS, max: config.RATE_LIMIT_MAX }),
    bearerAuth(config.MCP_BEARER_TOKEN),
  ];

  app.post('/mcp', ...mcpGuards, async (request, response) => {
    const suppliedSessionId = request.header('mcp-session-id');
    let session = suppliedSessionId === undefined ? undefined : sessions.get(suppliedSessionId);

    if (suppliedSessionId !== undefined && session === undefined) {
      jsonRpcError(response, 404, -32_000, 'Sesión MCP no encontrada.');
      return;
    }

    if (session === undefined) {
      if (!isInitializeRequest(request.body)) {
        jsonRpcError(response, 400, -32_000, 'Se requiere inicializar una sesión MCP.');
        return;
      }
      if (sessions.size >= config.MCP_MAX_SESSIONS) {
        jsonRpcError(response, 503, -32_603, 'Capacidad temporal de sesiones agotada.');
        return;
      }

      const server = createMcpServer(dependencies.tools);
      const transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        enableJsonResponse: true,
        onsessioninitialized: (sessionId) => {
          sessions.set(sessionId, { transport, server, lastSeenAt: Date.now() });
        },
        onsessionclosed: (sessionId) => {
          sessions.delete(sessionId);
        },
      });
      transport.onerror = (error) => {
        logger.warn({ code: toAppError(error).code }, 'Error de transporte MCP');
      };
      await server.connect(transport);
      session = { transport, server, lastSeenAt: Date.now() };
    }

    session.lastSeenAt = Date.now();
    await session.transport.handleRequest(request, response, request.body);
  });

  const handleSessionRequest = async (request: Request, response: Response): Promise<void> => {
    const sessionId = request.header('mcp-session-id');
    if (sessionId === undefined) {
      jsonRpcError(response, 400, -32_000, 'Falta la cabecera mcp-session-id.');
      return;
    }
    const session = sessions.get(sessionId);
    if (session === undefined) {
      jsonRpcError(response, 404, -32_000, 'Sesión MCP no encontrada.');
      return;
    }
    session.lastSeenAt = Date.now();
    await session.transport.handleRequest(request, response);
  };

  app.get('/mcp', ...mcpGuards, handleSessionRequest);
  app.delete('/mcp', ...mcpGuards, handleSessionRequest);

  app.use((_request, response) => {
    response.status(404).json({ error: 'not_found' });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    void _next;
    const safe = toAppError(error);
    logger.error({ code: safe.code }, 'Solicitud HTTP no controlada');
    if (!response.headersSent) {
      response.status(safe.httpStatus).json({ error: safe.code, message: safe.message });
    }
  });

  const cleanupTimer = setInterval(() => {
    const threshold = Date.now() - config.MCP_SESSION_TTL_MS;
    for (const [sessionId, session] of sessions) {
      if (session.lastSeenAt < threshold) {
        sessions.delete(sessionId);
        void session.server.close().catch((error: unknown) => {
          logger.warn({ code: toAppError(error).code }, 'Error al cerrar sesión MCP expirada');
        });
      }
    }
  }, Math.min(60_000, config.MCP_SESSION_TTL_MS));
  cleanupTimer.unref();

  return {
    app,
    sessionCount: () => sessions.size,
    closeSessions: async () => {
      clearInterval(cleanupTimer);
      const active = [...sessions.values()];
      sessions.clear();
      await Promise.allSettled(active.map((session) => session.server.close()));
    },
  };
}
