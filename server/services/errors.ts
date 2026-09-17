export type ServiceErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'PIN_REQUIRED'
  | 'UNSUPPORTED';

/** Единая ошибка сервисного слоя; routes (PHASE 4.7) отобразят code в HTTP-статус. */
export class ServiceError extends Error {
  constructor(
    readonly code: ServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}
