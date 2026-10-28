import { z } from 'zod';
import { AppError } from '../errors.js';

export const positiveIdSchema = z.number().int().positive();
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use fecha YYYY-MM-DD');
export const shortTimeSchema = z.string().regex(/^\d{2}:\d{2}$/, 'Use hora HH:mm');
export const providerTimeSchema = z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/);
export const pageSchema = z.number().int().positive().max(10_000);

export const sucursalSchema = z
  .object({
    id: positiveIdSchema,
    nombre: z.string(),
    codigo: z.string(),
    ciudadNombre: z.string(),
  })
  .strict();

export const servicioSchema = z
  .object({
    id: positiveIdSchema,
    nombre: z.string(),
    duracion: z.number().int().positive(),
    valoracion: z.boolean(),
  })
  .strict();

export const especialistaSchema = z
  .object({ id: positiveIdSchema, nombre: z.string(), apellido: z.string() })
  .strict();

export const clienteSchema = z
  .object({
    id: positiveIdSchema,
    nombre: z.string(),
    apellido: z.string(),
    tipoIdentificacion: z.string(),
    identificacion: z.string(),
    telefono: z.string(),
    correo: z.string(),
  })
  .strict();

export const disponibilidadSchema = z
  .object({
    especialistaId: positiveIdSchema,
    especialistaNombre: z.string(),
    especialistaApellido: z.string(),
    fecha: dateSchema,
    horaInicio: shortTimeSchema,
    horaFin: shortTimeSchema,
  })
  .strict();

export const citaCreadaSchema = z
  .object({
    id: positiveIdSchema,
    estado: z.string(),
    fecha: dateSchema,
    horaInicio: shortTimeSchema,
    horaFin: shortTimeSchema,
    cliente: positiveIdSchema,
    especialista: positiveIdSchema,
    sucursal: positiveIdSchema,
    servicio: positiveIdSchema,
  })
  .strict();

export const citaConsultadaSchema = z
  .object({
    citaId: positiveIdSchema,
    estado: z.string(),
    fecha: dateSchema,
    horaInicio: providerTimeSchema,
    horaFin: providerTimeSchema,
    observacion: z.string(),
    clienteId: positiveIdSchema,
    clienteNombre: z.string(),
    clienteApellido: z.string(),
    clienteDocumento: z.string(),
    clienteTelefono: z.string(),
    clienteCorreo: z.string(),
    especialistaId: positiveIdSchema,
    especialistaNombre: z.string(),
    especialistaApellido: z.string(),
    sucursalId: positiveIdSchema,
    sucursalNombre: z.string(),
    servicioId: positiveIdSchema,
    servicioNombre: z.string(),
  })
  .strict();

export const citaReagendadaSchema = z
  .object({
    id: positiveIdSchema,
    estado: z.string(),
    fecha: dateSchema,
    horaInicio: shortTimeSchema,
    horaFin: shortTimeSchema,
    especialista: positiveIdSchema,
    sucursal: positiveIdSchema,
    servicio: positiveIdSchema,
  })
  .strict();

export const citaCanceladaSchema = z
  .object({
    id: positiveIdSchema,
    estado: z.string(),
    fecha: dateSchema,
    horaInicio: shortTimeSchema,
    horaFin: shortTimeSchema,
  })
  .strict();

const paginatedBase = {
  count: z.number().int().nonnegative(),
  next: z.url().nullable(),
  previous: z.url().nullable(),
};

export const sucursalesDataSchema = z.object({ sucursales: z.array(sucursalSchema) }).strict();
export const serviciosDataSchema = z.object({ ...paginatedBase, servicios: z.array(servicioSchema) }).strict();
export const especialistasDataSchema = z
  .object({ ...paginatedBase, especialistas: z.array(especialistaSchema) })
  .strict();
export const clientesDataSchema = z.object({ clientes: z.array(clienteSchema) }).strict();
export const disponibilidadDataSchema = z
  .object({ ...paginatedBase, disponibilidad: z.array(disponibilidadSchema) })
  .strict();
export const citasDataSchema = z.object({ ...paginatedBase, citas: z.array(citaConsultadaSchema) }).strict();
export const citaCreadaDataSchema = z.object({ cita: citaCreadaSchema }).strict();
export const citaReagendadaDataSchema = z.object({ cita: citaReagendadaSchema }).strict();
export const citaCanceladaDataSchema = z.object({ cita: citaCanceladaSchema }).strict();

const providerErrorSchema = z.object({ code: z.string(), detail: z.string() }).strict();
const rawEnvelopeSchema = z
  .object({
    success: z.boolean(),
    message: z.string(),
    data: z.unknown(),
    errors: z.array(providerErrorSchema),
  })
  .strict();

export function parseAlmaEnvelope<T>(raw: unknown, dataSchema: z.ZodType<T>): T {
  const envelopeResult = rawEnvelopeSchema.safeParse(raw);
  if (!envelopeResult.success) {
    throw new AppError({
      code: 'RESPUESTA_ALMA_INVALIDA',
      message: 'ALMA respondió con un formato no reconocido.',
      retryable: false,
      details: { etapa: 'envelope' },
      cause: envelopeResult.error,
    });
  }

  const envelope = envelopeResult.data;
  if (!envelope.success) {
    throw new AppError({
      code: envelope.errors[0]?.code ?? 'ERROR_ALMA',
      message: envelope.message || 'ALMA rechazó la operación.',
      retryable: false,
      httpStatus: 422,
      details: { codigos_alma: envelope.errors.map((item) => item.code) },
    });
  }

  const dataResult = dataSchema.safeParse(envelope.data);
  if (!dataResult.success) {
    throw new AppError({
      code: 'RESPUESTA_ALMA_INVALIDA',
      message: 'ALMA respondió con datos incompatibles con el contrato documentado.',
      retryable: false,
      details: { etapa: 'data' },
      cause: dataResult.error,
    });
  }
  return dataResult.data;
}

export type Sucursal = z.infer<typeof sucursalSchema>;
export type Servicio = z.infer<typeof servicioSchema>;
export type Especialista = z.infer<typeof especialistaSchema>;
export type Cliente = z.infer<typeof clienteSchema>;
export type Disponibilidad = z.infer<typeof disponibilidadSchema>;
export type CitaConsultada = z.infer<typeof citaConsultadaSchema>;
