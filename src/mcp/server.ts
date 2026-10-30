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
      description: 'Lista IDs, nombres, códigos y ciudades de sucursales. Solo para configuración administrativa; Amsterdam Plaza ya está verificada como ID 1; no la llames durante la conversación. No identifica direcciones.',
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
      description: 'Consulta el catálogo operativo paginado: ID, nombre, duración en minutos y valoración. Busca el nombre real y conserva el ID durante la conversación. Si next no es null y no encuentras el servicio, consulta la siguiente página. Si el nombre solicitado no coincide, puedes consultar una opción relacionada para presentarla por su nombre real; no la reserves sin confirmación del cliente.',
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
      description: 'Requiere servicio_id numérico real; page es opcional. Devuelve IDs, nombres y apellidos paginados para ese servicio, sin dirección ni lista inversa de servicios por especialista. No garantiza atención en la sede ni disponibilidad; para ofrecer horarios consulta disponibilidad. Consúltala después de identificar el servicio y antes de consultar disponibilidad.',
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
      description: 'Busca por identificacion como texto; devuelve clientes y sus IDs. Úsala solo cuando sea necesario para crear o localizar una cita. Un resultado vacío no prueba por sí solo identidad. No sustituyas el documento por nombre, teléfono o correo.',
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
        'Consulta espacios reales: requiere sucursal_id y servicio_id numéricos y fecha YYYY-MM-DD; especialista_id y page son opcionales. Usa siempre sucursal_id=1 para Amsterdam Plaza y el servicio elegido; otras sedes se rechazan. Sin especialista devuelve opciones con sus nombres, horas y slot_token. Conserva cada token para su horario exacto; nunca lo muestres ni inventes. next indica más páginas. Reconsulta si cambia la selección o expira el token; ausencia de cupos no demuestra cierre.',
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
        'Tras resumen y confirmación explícita ejecuta esta herramienta, no una acción de seguimiento. Requiere slot_token exacto vigente, confirmacion=true, idempotency_key estable de 16 a 128 caracteres y tipo_cliente. Existente: cliente_id numérico; nuevo: tipo_identificacion, identificacion, nombre y apellido; telefono, correo y observacion opcionales. No envíes fecha, servicio ni sucursal por separado. Confirma al cliente solo si ok=true. Ante resultado incierto no reintentes con una clave nueva; escala.',
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
      description: 'Consulta citas paginadas usando cita_id, cliente_id, documento, fecha o estado; al menos un filtro es obligatorio, page es opcional. Contiene datos personales. Solo tras verificar autorización suficiente; conocer documento no verifica identidad. Evita consultas amplias.',
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
        'Reagenda una cita existente: requiere cita_id numérico, slot_token nuevo vigente, confirmacion=true tras resumen y autorización, e idempotency_key estable. observacion es opcional. Previamente verifica identidad y obtiene disponibilidad del nuevo horario. No envíes fecha ni sucursal separadas; no uses para crear. Ante resultado incierto escala sin cambiar la clave.',
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
        'Cancela una cita existente: requiere cita_id numérico, confirmacion=true tras verificar identidad y obtener confirmación explícita, e idempotency_key estable; motivo es opcional. Es destructiva. Ante resultado incierto escala sin cambiar la clave.',
      inputSchema: cancelarCitaInputSchema as never,
      outputSchema: toolOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    (input) => tools.cancelarCita(cancelarCitaInputSchema.parse(input)),
  );

  return server;
}
