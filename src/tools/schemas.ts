import { z } from 'zod';
import { dateSchema, pageSchema, positiveIdSchema } from '../alma/schemas.js';

const strictEmptyObject = z.object({}).strict();
const shortText = z.string().trim().min(1).max(120);
const observation = z.string().trim().min(1).max(500);
const idempotencyKey = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/, 'Use una clave estable de 16 a 128 caracteres');
const slotToken = z.string().min(80).max(2_048);
const confirmation = z.literal(true).describe('Debe ser true solo después de que la persona confirme explícitamente.');

export const listarSucursalesInputSchema = strictEmptyObject;
export const listarServiciosInputSchema = z.object({ page: pageSchema.optional() }).strict();
export const listarEspecialistasInputSchema = z
  .object({ servicio_id: positiveIdSchema, page: pageSchema.optional() })
  .strict();
export const buscarClienteInputSchema = z
  .object({ identificacion: z.string().trim().min(3).max(64) })
  .strict();
export const consultarDisponibilidadInputSchema = z
  .object({
    sucursal_id: positiveIdSchema,
    servicio_id: positiveIdSchema,
    fecha: dateSchema,
    especialista_id: positiveIdSchema.optional(),
    page: pageSchema.optional(),
  })
  .strict();

const crearBase = {
  idempotency_key: idempotencyKey,
  confirmacion: confirmation,
  slot_token: slotToken,
  observacion: observation.optional(),
};

export const crearCitaInputSchema = z.discriminatedUnion('tipo_cliente', [
  z
    .object({
      ...crearBase,
      tipo_cliente: z.literal('existente'),
      cliente_id: positiveIdSchema,
    })
    .strict(),
  z
    .object({
      ...crearBase,
      tipo_cliente: z.literal('nuevo'),
      tipo_identificacion: shortText.max(20),
      identificacion: z.string().trim().min(3).max(64),
      nombre: shortText,
      apellido: shortText,
      telefono: z.string().trim().min(7).max(30).optional(),
      correo: z.email().max(254).optional(),
    })
    .strict(),
]);

export const consultarCitasInputSchema = z
  .object({
    cita_id: positiveIdSchema.optional(),
    cliente_id: positiveIdSchema.optional(),
    documento: z.string().trim().min(3).max(64).optional(),
    fecha: dateSchema.optional(),
    estado: z.string().trim().min(1).max(50).optional(),
    page: pageSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.cita_id !== undefined ||
      value.cliente_id !== undefined ||
      value.documento !== undefined ||
      value.fecha !== undefined ||
      value.estado !== undefined,
    { message: 'Indique al menos un filtro para evitar consultas amplias.' },
  );

export const reagendarCitaInputSchema = z
  .object({
    cita_id: positiveIdSchema,
    idempotency_key: idempotencyKey,
    confirmacion: confirmation,
    slot_token: slotToken,
    observacion: observation.optional(),
  })
  .strict();

export const cancelarCitaInputSchema = z
  .object({
    cita_id: positiveIdSchema,
    idempotency_key: idempotencyKey,
    confirmacion: confirmation,
    motivo: z.string().trim().min(1).max(300).optional(),
  })
  .strict();

export const toolOperationSchema = z.enum([
  'listar_sucursales',
  'listar_servicios',
  'listar_especialistas',
  'buscar_cliente',
  'consultar_disponibilidad',
  'crear_cita',
  'consultar_citas',
  'reagendar_cita',
  'cancelar_cita',
]);

export const toolOutputSchema = z
  .object({
    ok: z.boolean(),
    operation: toolOperationSchema,
    message: z.string(),
    data: z.unknown().nullable(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        retryable: z.boolean(),
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .strict()
      .nullable(),
    meta: z
      .object({
        correlation_id: z.uuid(),
        cached: z.boolean(),
        timezone: z.string(),
      })
      .strict(),
  })
  .strict();

export type ToolOperation = z.infer<typeof toolOperationSchema>;
export type ToolOutput = z.infer<typeof toolOutputSchema>;
export type CrearCitaInput = z.infer<typeof crearCitaInputSchema>;
export type ReagendarCitaInput = z.infer<typeof reagendarCitaInputSchema>;
export type CancelarCitaInput = z.infer<typeof cancelarCitaInputSchema>;
