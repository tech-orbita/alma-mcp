import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { AlmaClient } from '../alma/client.js';
import type { CitaConsultada } from '../alma/schemas.js';
import { AppError, toAppError } from '../errors.js';
import type { MutationCoordinator } from '../idempotency/types.js';
import type { SlotTokenService } from '../security/slot-token.js';
import { lockFingerprint, stableHash } from '../utils/hash.js';
import type {
  CancelarCitaInput,
  CrearCitaInput,
  ReagendarCitaInput,
  ToolOperation,
  ToolOutput,
} from './schemas.js';

export interface ToolServiceDependencies {
  alma: AlmaClient;
  mutations: MutationCoordinator;
  slotTokens: SlotTokenService;
  timeZone: string;
  logger: Logger;
}

// ID confirmado por OMM para Amsterdam Plaza. El catálogo de servicios de ALMA no acepta sede.
const AUTHORIZED_BRANCH_ID = 1;

export class ToolService {
  public constructor(private readonly dependencies: ToolServiceDependencies) {}

  public listarSucursales() {
    return this.dependencies.alma.listarSucursales();
  }

  public listarServicios(input: { page?: number | undefined }) {
    return this.dependencies.alma.listarServicios(input.page);
  }

  public listarEspecialistas(input: { servicio_id: number; page?: number | undefined }) {
    return this.dependencies.alma.listarEspecialistas(input.servicio_id, input.page);
  }

  public buscarCliente(input: { identificacion: string }) {
    return this.dependencies.alma.buscarCliente(input.identificacion);
  }

  public async consultarDisponibilidad(input: {
    sucursal_id: number;
    servicio_id: number;
    fecha: string;
    especialista_id?: number | undefined;
    page?: number | undefined;
  }) {
    this.requireAuthorizedBranch(input.sucursal_id);
    const result = await this.dependencies.alma.consultarDisponibilidad({
      sucursal: input.sucursal_id,
      servicio: input.servicio_id,
      fecha: input.fecha,
      ...(input.especialista_id === undefined ? {} : { especialista: input.especialista_id }),
      ...(input.page === undefined ? {} : { page: input.page }),
    });
    return {
      ...result,
      zonaHoraria: this.dependencies.timeZone,
      disponibilidad: result.disponibilidad.map((slot) => ({
        ...slot,
        slot_token: this.dependencies.slotTokens.sign({
          sucursal: input.sucursal_id,
          servicio: input.servicio_id,
          especialista: slot.especialistaId,
          fecha: slot.fecha,
          horaInicio: slot.horaInicio,
          horaFin: slot.horaFin,
        }),
      })),
    };
  }

  public async crearCita(input: CrearCitaInput) {
    const slot = this.dependencies.slotTokens.verify(input.slot_token);
    this.requireAuthorizedBranch(slot.sucursal);
    const slotFingerprint = this.dependencies.slotTokens.fingerprint(input.slot_token);
    const contactKey =
      input.tipo_cliente === 'existente'
        ? `cliente:${input.cliente_id}`
        : `documento:${stableHash(input.identificacion)}`;
    const almaInput = {
      sucursal: slot.sucursal,
      servicio: slot.servicio,
      especialista: slot.especialista,
      ...(input.tipo_cliente === 'existente'
        ? { cliente: input.cliente_id }
        : {
            tipoIdentificacion: input.tipo_identificacion,
            identificacion: input.identificacion,
            nombre: input.nombre,
            apellido: input.apellido,
            ...(input.telefono === undefined ? {} : { telefono: input.telefono }),
            ...(input.correo === undefined ? {} : { correo: input.correo }),
          }),
      fecha: slot.fecha,
      horaInicio: slot.horaInicio,
      horaFin: slot.horaFin,
      ...(input.observacion === undefined ? {} : { observacion: input.observacion }),
    };

    return this.dependencies.mutations.execute({
      operation: 'crear_cita',
      idempotencyKey: input.idempotency_key,
      requestHash: stableHash({ input: almaInput, slot: slotFingerprint }),
      lockKeys: [lockFingerprint(contactKey), lockFingerprint(`slot:${slotFingerprint}`)],
      slotTokenHash: slotFingerprint,
      entityType: 'cita',
      run: () => this.dependencies.alma.crearCita(almaInput),
      getEntityId: (response) => String(response.cita.id),
    });
  }

  public consultarCitas(input: {
    cita_id?: number | undefined;
    cliente_id?: number | undefined;
    documento?: string | undefined;
    fecha?: string | undefined;
    estado?: string | undefined;
    page?: number | undefined;
  }) {
    return this.dependencies.alma.consultarCitas({
      ...(input.cita_id === undefined ? {} : { cita: input.cita_id }),
      ...(input.cliente_id === undefined ? {} : { cliente: input.cliente_id }),
      ...(input.documento === undefined ? {} : { documento: input.documento }),
      ...(input.fecha === undefined ? {} : { fecha: input.fecha }),
      ...(input.estado === undefined ? {} : { estado: input.estado }),
      ...(input.page === undefined ? {} : { page: input.page }),
    });
  }

  public async reagendarCita(input: ReagendarCitaInput) {
    const slot = this.dependencies.slotTokens.verify(input.slot_token);
    this.requireAuthorizedBranch(slot.sucursal);
    const slotFingerprint = this.dependencies.slotTokens.fingerprint(input.slot_token);
    const almaInput = {
      sucursal: slot.sucursal,
      servicio: slot.servicio,
      especialista: slot.especialista,
      fecha: slot.fecha,
      horaInicio: slot.horaInicio,
      horaFin: slot.horaFin,
      ...(input.observacion === undefined ? {} : { observacion: input.observacion }),
    };

    return this.dependencies.mutations.execute({
      operation: 'reagendar_cita',
      idempotencyKey: input.idempotency_key,
      requestHash: stableHash({ cita: input.cita_id, input: almaInput, slot: slotFingerprint }),
      lockKeys: [
        lockFingerprint(`cita:${input.cita_id}`),
        lockFingerprint(`slot:${slotFingerprint}`),
      ],
      slotTokenHash: slotFingerprint,
      entityType: 'cita',
      entityId: String(input.cita_id),
      run: async () => {
        await this.requireEditableAppointment(input.cita_id);
        return this.dependencies.alma.reagendarCita(input.cita_id, almaInput);
      },
      getEntityId: (response) => String(response.cita.id),
    });
  }

  public cancelarCita(input: CancelarCitaInput) {
    return this.dependencies.mutations.execute({
      operation: 'cancelar_cita',
      idempotencyKey: input.idempotency_key,
      requestHash: stableHash({ cita: input.cita_id, motivo: input.motivo }),
      lockKeys: [lockFingerprint(`cita:${input.cita_id}`)],
      entityType: 'cita',
      entityId: String(input.cita_id),
      run: async () => {
        await this.requireEditableAppointment(input.cita_id);
        return this.dependencies.alma.cancelarCita(input.cita_id, input.motivo);
      },
      getEntityId: (response) => String(response.cita.id),
    });
  }

  public async execute(operation: ToolOperation, handler: () => Promise<unknown>): Promise<{
    output: ToolOutput;
    isError: boolean;
  }> {
    const correlationId = randomUUID();
    try {
      const raw = await handler();
      const mutationResult = this.isMutationResult(raw) ? raw : undefined;
      const data = mutationResult?.value ?? raw;
      return {
        output: {
          ok: true,
          operation,
          message: this.successMessage(operation, mutationResult?.cached ?? false),
          data,
          error: null,
          meta: {
            correlation_id: correlationId,
            cached: mutationResult?.cached ?? false,
            timezone: this.dependencies.timeZone,
          },
        },
        isError: false,
      };
    } catch (error) {
      const safe = toAppError(error);
      this.dependencies.logger.warn({ correlationId, operation, code: safe.code }, 'Herramienta MCP rechazada');
      return {
        output: {
          ok: false,
          operation,
          message: safe.message,
          data: null,
          error: {
            code: safe.code,
            message: safe.message,
            retryable: safe.retryable,
            ...(safe.details === undefined ? {} : { details: safe.details }),
          },
          meta: { correlation_id: correlationId, cached: false, timezone: this.dependencies.timeZone },
        },
        isError: true,
      };
    }
  }

  private async requireEditableAppointment(citaId: number): Promise<CitaConsultada> {
    const current = await this.dependencies.alma.consultarCitas({ cita: citaId });
    const appointment = current.citas.find((candidate) => candidate.citaId === citaId);
    if (appointment === undefined) {
      throw new AppError({
        code: 'CITA_NO_ENCONTRADA',
        message: 'La cita no existe o ya no está disponible.',
        httpStatus: 404,
      });
    }
    this.requireAuthorizedBranch(appointment.sucursalId);
    if (appointment.estado.toLocaleLowerCase('es').includes('cancel')) {
      throw new AppError({
        code: 'CITA_YA_CANCELADA',
        message: 'La cita ya se encuentra cancelada.',
        httpStatus: 409,
      });
    }
    return appointment;
  }

  private requireAuthorizedBranch(sucursalId: number): void {
    if (sucursalId !== AUTHORIZED_BRANCH_ID) {
      throw new AppError({
        code: 'SUCURSAL_NO_AUTORIZADA',
        message: 'Esta operación solo está autorizada para Amsterdam Plaza.',
        httpStatus: 403,
      });
    }
  }

  private isMutationResult(value: unknown): value is { value: unknown; cached: boolean } {
    return (
      value !== null &&
      typeof value === 'object' &&
      'value' in value &&
      'cached' in value &&
      typeof value.cached === 'boolean'
    );
  }

  private successMessage(operation: ToolOperation, cached: boolean): string {
    if (cached) return 'Operación ya procesada; se devuelve el resultado idempotente almacenado.';
    const messages: Record<ToolOperation, string> = {
      listar_sucursales: 'Sucursales consultadas.',
      listar_servicios: 'Servicios consultados.',
      listar_especialistas: 'Especialistas consultados.',
      buscar_cliente: 'Búsqueda de cliente completada.',
      consultar_disponibilidad: 'Disponibilidad consultada. Use el slot_token del horario elegido.',
      crear_cita: 'Cita creada y registrada de forma idempotente.',
      consultar_citas: 'Citas consultadas.',
      reagendar_cita: 'Cita reagendada y registrada de forma idempotente.',
      cancelar_cita: 'Cita cancelada y registrada de forma idempotente.',
    };
    return messages[operation];
  }
}
