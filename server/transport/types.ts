import type { AuthUser } from '../../shared/index.js';

// Расширение Express.Request: аутентифицированный пользователь (устанавливается authenticate middleware).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: AuthUser;
      validatedQuery?: unknown;
    }
  }
}

export {};
