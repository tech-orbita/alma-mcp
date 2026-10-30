import type { Logger } from 'pino';
import type { z } from 'zod';
import { AppError } from '../errors.js';
import {
  citaCanceladaDataSchema,
  citaCreadaDataSchema,
  citaReagendadaDataSchema,
  citasDataSchema,
  clientesDataSchema,
  disponibilidadDataSchema,
  especialistasDataSchema,
  parseAlmaEnvelope,
  serviciosDataSchema,
  sucursalesDataSchema,
} from './schemas.js';
import { ALMA_ROUTES, appointmentRoute, buildAlmaUrl } from './url.js';

type FetchImplementation = typeof fetch;

export interface CrearCitaRequest {
  sucursal: number;
  servicio: number;
  especialista: number;
  cliente?: number;
  tipoIdentificacion?: string;
  identificacion?: string;
  nombre?: string;
  apellido?: string;
  telefono?: string;
  correo?: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  observacion?: string;
}

export interface ReagendarCitaRequest {
  sucursal: number;
  servicio: number;
  especialista: number;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  observacion?: string;
}

export interface ConsultarCitasQuery {
  cita?: number;
  cliente?: number;
  documento?: string;
  fecha?: string;
  estado?: string;
  page?: number;
}

export interface AlmaClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  readRetries: number;
  logger: Logger;
  fetchImplementation?: FetchImplementation;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

const transientStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);

export class AlmaClient {
  private readonly fetchImplementation: FetchImplementation;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;

  public constructor(private readonly options: AlmaClientOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.random = options.random ?? Math.random;
  }

  public listarSucursales() {
    return this.request('GET', ALMA_ROUTES.sucursales, {}, undefined, sucursalesDataSchema);
  }

  public listarServicios(page?: number) {
    return this.request('GET', ALMA_ROUTES.servicios, { page }, undefined, serviciosDataSchema);
  }

  public listarEspecialistas(servicio: number, page?: number) {
    return this.request('GET', ALMA_ROUTES.especialistas, { servicio, page }, undefined, especialistasDataSchema);
  }

  public buscarCliente(identificacion: string) {
    return this.request('GET', ALMA_ROUTES.clientes, { identificacion }, undefined, clientesDataSchema);
  }

  public consultarDisponibilidad(input: {
    sucursal: number;
    servicio: number;
    fecha: string;
    especialista?: number;
    page?: number;
  }) {
    return this.request('GET', ALMA_ROUTES.disponibilidad, input, undefined, disponibilidadDataSchema);
  }

  public crearCita(input: CrearCitaRequest) {
    return this.request('POST', ALMA_ROUTES.citas, {}, input, citaCreadaDataSchema);
  }

  public consultarCitas(input: ConsultarCitasQuery) {
    return this.request('GET', ALMA_ROUTES.citas, { ...input }, undefined, citasDataSchema);
  }

  public reagendarCita(citaId: number, input: ReagendarCitaRequest) {
    return this.request('PUT', appointmentRoute(citaId), {}, input, citaReagendadaDataSchema);
  }

  public cancelarCita(citaId: number, motivo?: string) {
    return this.request('DELETE', appointmentRoute(citaId), {}, motivo === undefined ? {} : { motivo }, citaCanceladaDataSchema);
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    route: string,
    query: Readonly<Record<string, string | number | undefined>>,
    body: unknown,
    dataSchema: z.ZodType<T>,
  ): Promise<T> {
    const isRead = method === 'GET';
    const maximumAttempts = isRead ? this.options.readRetries + 1 : 1;

    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
      const startedAt = Date.now();
      try {
        const url = buildAlmaUrl(this.options.baseUrl, route, query);
        const response = await this.fetchImplementation(url, {
          method,
          headers: {
            Accept: 'application/json',
            Authorization: `Token ${this.options.token}`,
            'Content-Type': 'application/json',
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        });
        const elapsedMs = Date.now() - startedAt;

        if (isRead && transientStatuses.has(response.status) && attempt < maximumAttempts) {
          this.options.logger.warn({ route, method, status: response.status, attempt, elapsedMs }, 'Reintentando lectura ALMA');
          await this.backoff(attempt);
          continue;
        }

        // Un 5xx tras una escritura no demuestra que ALMA no la haya aplicado.
        if (!isRead && response.status >= 500) {
          throw new AppError({ code: 'RESULTADO_MUTACION_INCIERTO', message: 'ALMA devolvió un error de servidor después de la escritura. Requiere reconciliación antes de reintentar.', httpStatus: 502 });
        }
        const raw = await this.parseJson(response);
        if (!response.ok) {
          try {
            return parseAlmaEnvelope(raw, dataSchema);
          } catch (error) {
            if (error instanceof AppError && error.code !== 'RESPUESTA_ALMA_INVALIDA') throw error;
            throw new AppError({
              code: 'ERROR_HTTP_ALMA',
              message: 'ALMA no pudo completar la solicitud.',
              retryable: isRead && transientStatuses.has(response.status),
              httpStatus: 502,
              details: { status_alma: response.status },
              cause: error,
            });
          }
        }

        this.options.logger.debug({ route, method, status: response.status, attempt, elapsedMs }, 'Solicitud ALMA completada');
        return parseAlmaEnvelope(raw, dataSchema);
      } catch (error) {
        if (error instanceof AppError) {
          if (!isRead && error.code === 'RESPUESTA_ALMA_INVALIDA') {
            throw new AppError({ code: 'RESULTADO_MUTACION_INCIERTO', message: 'La respuesta de la escritura no permite confirmar su resultado. Requiere reconciliación antes de reintentar.', httpStatus: 502, cause: error });
          }
          throw error;
        }
        const timedOut = controller.signal.aborted;
        if (isRead && attempt < maximumAttempts) {
          this.options.logger.warn({ route, method, attempt, timedOut }, 'Fallo transitorio de lectura ALMA');
          await this.backoff(attempt);
          continue;
        }
        throw new AppError({
          code: timedOut ? 'TIMEOUT_ALMA' : 'ALMA_NO_DISPONIBLE',
          message: timedOut
            ? 'ALMA no respondió dentro del tiempo esperado.'
            : 'No fue posible comunicarse con ALMA.',
          retryable: isRead,
          httpStatus: 502,
          details: { mutacion_ambigua: !isRead },
          cause: error,
        });
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new AppError({ code: 'ALMA_NO_DISPONIBLE', message: 'No fue posible comunicarse con ALMA.' });
  }

  private async parseJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch (error) {
      throw new AppError({
        code: 'RESPUESTA_ALMA_INVALIDA',
        message: 'ALMA respondió con contenido que no es JSON válido.',
        httpStatus: 502,
        cause: error,
      });
    }
  }

  private async backoff(attempt: number): Promise<void> {
    const milliseconds = Math.min(1_500, 150 * 2 ** (attempt - 1)) + Math.floor(this.random() * 75);
    await this.sleep(milliseconds);
  }
}
