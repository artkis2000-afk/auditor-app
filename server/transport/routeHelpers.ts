import type { Request } from 'express';
import type { AuthUser } from '../../shared/index.js';

/** Аутентифицированный пользователь (после authenticate middleware). */
export function actorOf(req: Request): AuthUser {
  return req.principal!;
}

/** Значение path-параметра :id как строка (в типах Express 5 — string|string[]|undefined). */
export function idParam(req: Request): string {
  return req.params.id as string;
}
