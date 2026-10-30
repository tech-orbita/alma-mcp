import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AlmaClient } from '../src/alma/client.js';
import { createApplication, type Application } from '../src/app.js';
import { InMemoryMutationCoordinator } from '../src/idempotency/in-memory.js';
import { createMockAlmaApp } from '../src/mock-alma-server.js';
import { SlotTokenService } from '../src/security/slot-token.js';
import { ToolService } from '../src/tools/service.js';
import { closeServer, listenOnRandomPort, silentLogger, testConfig } from './helpers.js';

const token = 'test-mcp-bearer-token-32-characters-minimum';
const almaToken = 'different-test-alma-token';
const accept = 'application/json, text/event-stream';

describe('integración MCP con ALMA simulado', () => {
  let mockHttpServer: Server;
  let mockAppointments: ReturnType<typeof createMockAlmaApp>['appointments'];
  let application: Application;

  beforeEach(async () => {
    const mock = createMockAlmaApp(almaToken);
    mockAppointments = mock.appointments;
    mockHttpServer = createServer(mock.app);
    const port = await listenOnRandomPort(mockHttpServer);
    const config = testConfig({ ALMA_BASE_URL: `http://127.0.0.1:${port}/api/` });
    const alma = new AlmaClient({
      baseUrl: config.ALMA_BASE_URL,
      token: almaToken,
      timeoutMs: 1_000,
      readRetries: 1,
      logger: silentLogger,
    });
    const tools = new ToolService({
      alma,
      mutations: new InMemoryMutationCoordinator(),
      slotTokens: new SlotTokenService(config.SLOT_TOKEN_SECRET, config.ALMA_TIMEZONE, 300),
      timeZone: config.ALMA_TIMEZONE,
      logger: silentLogger,
    });
    application = createApplication({ config, logger: silentLogger, tools, databaseReady: async () => true });
  });

  afterEach(async () => {
    await application.closeSessions();
    await closeServer(mockHttpServer);
  });

  async function initialize(): Promise<string> {
    const response = await request(application.app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', accept)
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'alma-mcp-test', version: '1.0.0' },
        },
      })
      .expect(200);
    const sessionId = response.header['mcp-session-id'];
    expect(response.body.result.serverInfo.name).toBe('alma-mcp');
    expect(sessionId).toBeTypeOf('string');
    return String(sessionId);
  }

  async function rpc(sessionId: string, id: number, method: string, params?: unknown) {
    return request(application.app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', accept)
      .set('mcp-session-id', sessionId)
      .set('mcp-protocol-version', '2025-11-25')
      .send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })
      .expect(200);
  }

  it('protege /mcp y no filtra secretos en health', async () => {
    const health = await request(application.app).get('/health').expect(200);
    expect(JSON.stringify(health.body)).not.toContain(token);
    await request(application.app).post('/mcp').set('Accept', accept).send({}).expect(401);
    await request(application.app).get('/ready').expect(200, { status: 'ready', database: 'up' });
  });

  it('descubre exactamente nueve herramientas', async () => {
    const sessionId = await initialize();
    const response = await rpc(sessionId, 2, 'tools/list');
    expect(response.body.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual(
      [
        'buscar_cliente',
        'cancelar_cita',
        'consultar_citas',
        'consultar_disponibilidad',
        'crear_cita',
        'listar_especialistas',
        'listar_servicios',
        'listar_sucursales',
        'reagendar_cita',
      ].sort(),
    );
  });

  it('rechaza disponibilidad y creación con una sede distinta de Amsterdam Plaza', async () => {
    const sessionId = await initialize();
    const availability = await rpc(sessionId, 2, 'tools/call', {
      name: 'consultar_disponibilidad',
      arguments: { sucursal_id: 2, servicio_id: 10, fecha: '2026-08-10' },
    });
    expect(availability.body.result.structuredContent.error.code).toBe('SUCURSAL_NO_AUTORIZADA');

    const config = testConfig();
    const tokenOtherBranch = new SlotTokenService(config.SLOT_TOKEN_SECRET, config.ALMA_TIMEZONE, 300).sign({
      sucursal: 2, servicio: 10, especialista: 25, fecha: '2026-08-10', horaInicio: '09:00', horaFin: '09:30',
    });
    const created = await rpc(sessionId, 3, 'tools/call', {
      name: 'crear_cita',
      arguments: { tipo_cliente: 'existente', cliente_id: 50, idempotency_key: 'other-branch-create-0001', confirmacion: true, slot_token: tokenOtherBranch },
    });
    expect(created.body.result.structuredContent.error.code).toBe('SUCURSAL_NO_AUTORIZADA');
    expect(mockAppointments).toHaveLength(0);
  });

  it('consulta disponibilidad, crea una sola cita y deduplica la repetición', async () => {
    const sessionId = await initialize();
    const availability = await rpc(sessionId, 2, 'tools/call', {
      name: 'consultar_disponibilidad',
      arguments: { sucursal_id: 1, servicio_id: 10, fecha: '2026-08-10' },
    });
    const slotToken = availability.body.result.structuredContent.data.disponibilidad[0].slot_token as string;

    const argumentsValue = {
      tipo_cliente: 'existente',
      cliente_id: 50,
      idempotency_key: 'create-appointment-integration-0001',
      confirmacion: true,
      slot_token: slotToken,
    };
    const created = await rpc(sessionId, 3, 'tools/call', { name: 'crear_cita', arguments: argumentsValue });
    const replayed = await rpc(sessionId, 4, 'tools/call', { name: 'crear_cita', arguments: argumentsValue });

    expect(created.body.result.structuredContent.ok).toBe(true);
    expect(replayed.body.result.structuredContent.meta.cached).toBe(true);
    expect(mockAppointments).toHaveLength(1);
  });

  it('serializa llamadas concurrentes y evita doble creación', async () => {
    const sessionId = await initialize();
    const availability = await rpc(sessionId, 2, 'tools/call', {
      name: 'consultar_disponibilidad',
      arguments: { sucursal_id: 1, servicio_id: 10, fecha: '2026-08-11' },
    });
    const slotToken = availability.body.result.structuredContent.data.disponibilidad[0].slot_token as string;
    const args = {
      tipo_cliente: 'existente',
      cliente_id: 50,
      idempotency_key: 'create-appointment-concurrent-0001',
      confirmacion: true,
      slot_token: slotToken,
    };
    const [left, right] = await Promise.all([
      rpc(sessionId, 3, 'tools/call', { name: 'crear_cita', arguments: args }),
      rpc(sessionId, 4, 'tools/call', { name: 'crear_cita', arguments: args }),
    ]);
    expect([left.body.result.structuredContent.meta.cached, right.body.result.structuredContent.meta.cached].sort()).toEqual([
      false,
      true,
    ]);
    expect(mockAppointments).toHaveLength(1);
  });

  it('ejecuta el flujo completo de las nueve herramientas', async () => {
    const sessionId = await initialize();
    await rpc(sessionId, 2, 'tools/call', { name: 'listar_sucursales', arguments: {} });
    await rpc(sessionId, 3, 'tools/call', { name: 'listar_servicios', arguments: {} });
    await rpc(sessionId, 4, 'tools/call', {
      name: 'listar_especialistas',
      arguments: { servicio_id: 10 },
    });
    await rpc(sessionId, 5, 'tools/call', {
      name: 'buscar_cliente',
      arguments: { identificacion: '123456789' },
    });

    const availability = await rpc(sessionId, 6, 'tools/call', {
      name: 'consultar_disponibilidad',
      arguments: { sucursal_id: 1, servicio_id: 10, fecha: '2026-08-12' },
    });
    const firstSlot = availability.body.result.structuredContent.data.disponibilidad[0].slot_token as string;
    const created = await rpc(sessionId, 7, 'tools/call', {
      name: 'crear_cita',
      arguments: {
        tipo_cliente: 'existente',
        cliente_id: 50,
        idempotency_key: 'complete-flow-create-0001',
        confirmacion: true,
        slot_token: firstSlot,
      },
    });
    const appointmentId = created.body.result.structuredContent.data.cita.id as number;
    await rpc(sessionId, 8, 'tools/call', {
      name: 'consultar_citas',
      arguments: { cita_id: appointmentId },
    });

    const nextAvailability = await rpc(sessionId, 9, 'tools/call', {
      name: 'consultar_disponibilidad',
      arguments: { sucursal_id: 1, servicio_id: 10, fecha: '2026-08-13' },
    });
    const nextSlot = nextAvailability.body.result.structuredContent.data.disponibilidad[0].slot_token as string;
    const rescheduled = await rpc(sessionId, 10, 'tools/call', {
      name: 'reagendar_cita',
      arguments: {
        cita_id: appointmentId,
        idempotency_key: 'complete-flow-reschedule-0001',
        confirmacion: true,
        slot_token: nextSlot,
      },
    });
    expect(rescheduled.body.result.structuredContent.data.cita.fecha).toBe('2026-08-13');

    const cancelled = await rpc(sessionId, 11, 'tools/call', {
      name: 'cancelar_cita',
      arguments: {
        cita_id: appointmentId,
        idempotency_key: 'complete-flow-cancel-0001',
        confirmacion: true,
        motivo: 'Prueba local autorizada',
      },
    });
    expect(cancelled.body.result.structuredContent.data.cita.estado).toBe('Cancelado');
    expect(mockAppointments).toHaveLength(1);
  });

  it('soporta cierre DELETE de Streamable HTTP', async () => {
    const sessionId = await initialize();
    expect(application.sessionCount()).toBe(1);
    await request(application.app)
      .delete('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', accept)
      .set('mcp-session-id', sessionId)
      .set('mcp-protocol-version', '2025-11-25')
      .expect(200);
    expect(application.sessionCount()).toBe(0);
    await request(application.app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', accept)
      .set('mcp-session-id', sessionId)
      .set('mcp-protocol-version', '2025-11-25')
      .send({ jsonrpc: '2.0', id: 5, method: 'tools/list' })
      .expect(404);
  });
});
