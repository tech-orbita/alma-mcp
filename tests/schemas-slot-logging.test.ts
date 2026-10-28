import { describe, expect, it } from 'vitest';
import { parseAlmaEnvelope, sucursalesDataSchema } from '../src/alma/schemas.js';
import { AppError } from '../src/errors.js';
import { redactForLog } from '../src/logger.js';
import { SlotTokenService } from '../src/security/slot-token.js';
import {
  cancelarCitaInputSchema,
  consultarCitasInputSchema,
  crearCitaInputSchema,
} from '../src/tools/schemas.js';

describe('esquemas estrictos y envelope', () => {
  it('valida una respuesta documentada y rechaza campos inesperados', () => {
    const raw = {
      success: true,
      message: '',
      data: { sucursales: [{ id: 1, nombre: 'Sede', codigo: '001', ciudadNombre: 'Medellin' }] },
      errors: [],
    };
    expect(parseAlmaEnvelope(raw, sucursalesDataSchema).sucursales).toHaveLength(1);
    expect(() => parseAlmaEnvelope({ ...raw, secreto: 'no' }, sucursalesDataSchema)).toThrow('formato no reconocido');
  });

  it('convierte errores ALMA en errores sanitizados', () => {
    try {
      parseAlmaEnvelope(
        {
          success: false,
          message: 'horario no disponible',
          data: {},
          errors: [{ code: 'HORARIO_NO_DISPONIBLE', detail: 'cruce' }],
        },
        sucursalesDataSchema,
      );
      throw new Error('Se esperaba error');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('HORARIO_NO_DISPONIBLE');
    }
  });

  it('exige confirmación literal y entrada sin campos extra', () => {
    expect(
      cancelarCitaInputSchema.safeParse({
        cita_id: 100,
        idempotency_key: 'cancel-appointment-100-0001',
        confirmacion: false,
      }).success,
    ).toBe(false);
    expect(
      crearCitaInputSchema.safeParse({
        tipo_cliente: 'existente',
        cliente_id: 50,
        idempotency_key: 'create-appointment-100-0001',
        confirmacion: true,
        slot_token: 'x'.repeat(100),
        campo_inventado: true,
      }).success,
    ).toBe(false);
    expect(consultarCitasInputSchema.safeParse({ page: 1 }).success).toBe(false);
  });
});

describe('slot tokens', () => {
  const slot = {
    sucursal: 1,
    servicio: 10,
    especialista: 25,
    fecha: '2026-08-10',
    horaInicio: '09:00',
    horaFin: '09:30',
  };

  it('firma, valida y detecta manipulación', () => {
    const service = new SlotTokenService('a'.repeat(32), 'America/Bogota', 300, () => 1_000_000);
    const token = service.sign(slot);
    expect(service.verify(token)).toMatchObject(slot);
    expect(() => service.verify(`${token.slice(0, -1)}x`)).toThrow('no fue emitido');
    expect(service.fingerprint(token)).toHaveLength(64);
  });

  it('rechaza slots vencidos', () => {
    let now = 1_000_000;
    const service = new SlotTokenService('b'.repeat(32), 'America/Bogota', 30, () => now);
    const token = service.sign(slot);
    now += 31_000;
    expect(() => service.verify(token)).toThrow('expiró');
  });
});

it('redacta PII y secretos de estructuras de log', () => {
  expect(
    redactForLog({ identificacion: '123', nested: { correo: 'x@example.com', ok: 1 }, token: 'secret' }),
  ).toEqual({ identificacion: '[REDACTED]', nested: { correo: '[REDACTED]', ok: 1 }, token: '[REDACTED]' });
});
