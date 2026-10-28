import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { dateSchema, positiveIdSchema, shortTimeSchema } from '../alma/schemas.js';

const slotPayloadSchema = z
  .object({
    v: z.literal(1),
    sucursal: positiveIdSchema,
    servicio: positiveIdSchema,
    especialista: positiveIdSchema,
    fecha: dateSchema,
    horaInicio: shortTimeSchema,
    horaFin: shortTimeSchema,
    zonaHoraria: z.string().min(1),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
    nonce: z.uuid(),
  })
  .strict();

export type SlotPayload = z.infer<typeof slotPayloadSchema>;

export class SlotTokenService {
  public constructor(
    private readonly secret: string,
    private readonly timeZone: string,
    private readonly ttlSeconds: number,
    private readonly now: () => number = Date.now,
  ) {}

  public sign(input: Pick<SlotPayload, 'sucursal' | 'servicio' | 'especialista' | 'fecha' | 'horaInicio' | 'horaFin'>): string {
    const issuedAt = Math.floor(this.now() / 1_000);
    const payload: SlotPayload = {
      v: 1,
      ...input,
      zonaHoraria: this.timeZone,
      iat: issuedAt,
      exp: issuedAt + this.ttlSeconds,
      nonce: randomUUID(),
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${encodedPayload}.${this.signature(encodedPayload)}`;
  }

  public verify(token: string): SlotPayload {
    const [encodedPayload, signature, extra] = token.split('.');
    if (!encodedPayload || !signature || extra !== undefined) throw this.invalid();

    const expected = Buffer.from(this.signature(encodedPayload));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw this.invalid();

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as unknown;
    } catch {
      throw this.invalid();
    }
    const result = slotPayloadSchema.safeParse(parsed);
    if (!result.success) throw this.invalid();

    const current = Math.floor(this.now() / 1_000);
    if (result.data.exp <= current) {
      throw new AppError({
        code: 'SLOT_EXPIRADO',
        message: 'El horario seleccionado expiró. Consulte disponibilidad nuevamente.',
        httpStatus: 409,
      });
    }
    if (result.data.iat > current + 30 || result.data.exp - result.data.iat > this.ttlSeconds) throw this.invalid();
    if (result.data.zonaHoraria !== this.timeZone) {
      throw new AppError({
        code: 'ZONA_HORARIA_CAMBIO',
        message: 'El horario fue emitido para otra configuración de zona horaria. Consulte disponibilidad nuevamente.',
        httpStatus: 409,
      });
    }
    return result.data;
  }

  public fingerprint(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private signature(encodedPayload: string): string {
    return createHmac('sha256', this.secret).update(encodedPayload).digest('base64url');
  }

  private invalid(): AppError {
    return new AppError({
      code: 'SLOT_INVALIDO',
      message: 'El horario seleccionado no fue emitido por este servidor. Consulte disponibilidad nuevamente.',
      httpStatus: 400,
    });
  }
}
