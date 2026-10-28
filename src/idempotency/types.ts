export type MutationOperation = 'crear_cita' | 'reagendar_cita' | 'cancelar_cita';

export interface MutationRequest<T> {
  operation: MutationOperation;
  idempotencyKey: string;
  requestHash: string;
  lockKeys: string[];
  slotTokenHash?: string;
  entityType: 'cita';
  entityId?: string;
  run: () => Promise<T>;
  getEntityId?: (response: T) => string | undefined;
}

export interface MutationResult<T> {
  value: T;
  cached: boolean;
}

export interface MutationCoordinator {
  execute<T>(request: MutationRequest<T>): Promise<MutationResult<T>>;
}
