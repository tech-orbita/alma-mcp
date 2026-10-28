import { McpServer } from '@modelcontextprotocol/server';
import type { ToolService } from '../tools/service.js';
import {
  buscarClienteInputSchema,
  cancelarCitaInputSchema,
  consultarCitasInputSchema,
  consultarDisponibilidadInputSchema,
  crearCitaInputSchema,
  listarEspecialistasInputSchema,
  listarServiciosInputSchema,
  listarSucursalesInputSchema,
  reagendarCitaInputSchema,
  toolOutputSchema,
  type ToolOperation,
} from '../tools/schemas.js';

function result(output: Awaited<ReturnType<ToolService['execute']>>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(output.output) }],
    structuredContent: output.output,
    isError: output.isError,
  };
}

export function createMcpServer(tools: ToolService): McpServer {
  const server = new McpServer({ name: 'alma-mcp', version: '1.0.0' });

  const register = (
    name: ToolOperation,
    config: Parameters<McpServer['registerTool']>[1] & { inputSchema: never },
    handler: (input: unknown) => Promise<unknown>,
  ) => {
    server.registerTool(
      name,
      config as never,
      (async (input: unknown) => result(await tools.execute(name, () => handler(input)))) as never,
    );
  };

  register(
    'listar_sucursales',
    {
      title: 'Listar sucursales ALMA',
      description: 'Lista las sucursales activas. Úsala antes de consultar disponibilidad.',
      inputSchema: listarSucursalesInputSchema as never,
      outputSchema: toolOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    () => tools.listarSucursales(),
  );
  register(
    'listar_servicios',
    {
      title: 'Listar servicios ALMA',
      description: 'Lista servicios agendables. Puede pedir una página específica.',
      inputSchema: listarServiciosInputSchema as never,
      outputSchema: toolOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (input) => tools.listarServicios(listarServiciosInputSchema.parse(input)),
  );
  register(
    'listar_especialistas',
    {
      title: 'Listar especialistas por servicio',
      description: 'Lista especialistas habilitados para un servicio ALMA concreto.',
      inputSchema: listarEspecialistasInputSchema as never,
      outputSchema: toolOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (input) => tools.listarEspecialistas(listarEspecialistasInputSchema.parse(input)),
  );
  register(
    'buscar_cliente',
    {
      title: 'Buscar cliente por identificación',
      description: 'Busca un cliente existente por su documento. No use nombre, teléfono ni correo como sustituto.',
      inputSchema: buscarClienteInputSchema as never,
      outputSchema: toolOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (input) => tools.buscarCliente(buscarClienteInputSchema.parse(input)),
  );
  register(
    'consultar_disponibilidad',
    {
      title: 'Consultar disponibilidad',
      description:
        'Consulta horarios por sucursal, servicio y fecha. Devuelve slot_token firmado; nunca invente horarios ni construya tokens.',
      inputSchema: consultarDisponibilidadInputSchema as never,
      outputSchema: toolOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (input) => tools.consultarDisponibilidad(consultarDisponibilidadInputSchema.parse(input)),
  );
  register(
    'crear_cita',
    {
      title: 'Crear cita confirmada',
      description:
        'Crea una cita usando un slot_token vigente. Exige confirmación explícita y clave de idempotencia estable. No repita con otra clave ante un resultado incierto.',
      inputSchema: crearCitaInputSchema as never,
      outputSchema: toolOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    (input) => tools.crearCita(crearCitaInputSchema.parse(input)),
  );
  register(
    'consultar_citas',
    {
      title: 'Consultar citas',
      description: 'Consulta citas por al menos un filtro: cita, cliente, documento, fecha o estado.',
      inputSchema: consultarCitasInputSchema as never,
      outputSchema: toolOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (input) => tools.consultarCitas(consultarCitasInputSchema.parse(input)),
  );
  register(
    'reagendar_cita',
    {
      title: 'Reagendar cita confirmada',
      description:
        'Verifica la cita y la mueve a un slot_token vigente. Exige confirmación explícita e idempotencia. No use para crear una cita nueva.',
      inputSchema: reagendarCitaInputSchema as never,
      outputSchema: toolOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    (input) => tools.reagendarCita(reagendarCitaInputSchema.parse(input)),
  );
  register(
    'cancelar_cita',
    {
      title: 'Cancelar cita confirmada',
      description:
        'Verifica y cancela una cita. Exige confirmación explícita y clave de idempotencia estable. Es una acción destructiva.',
      inputSchema: cancelarCitaInputSchema as never,
      outputSchema: toolOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    (input) => tools.cancelarCita(cancelarCitaInputSchema.parse(input)),
  );

  return server;
}
