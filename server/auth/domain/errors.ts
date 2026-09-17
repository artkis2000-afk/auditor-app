export type AuthErrorCode =
  | 'CONFIG'
  | 'MISSING_CREDENTIALS'
  | 'USER_NOT_FOUND'
  | 'INVALID_PASSWORD'
  | 'TOKEN_INVALID'
  | 'TOKEN_EXPIRED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN';

/** Ошибка аутентификации/авторизации; транспорт (PHASE 4.7) отобразит code в HTTP-статус. */
export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
