import type { RequestHandler } from 'express';
import type { UserRole } from '../../shared/index.js';
import { AuthError, type AuthService, type AuthorizationService } from '../auth/index.js';

/**
 * Аутентификация: извлекает Bearer-токен, валидирует через AuthService и кладёт пользователя в req.principal.
 * Ошибки (нет/кривой/невалидный/просроченный токен) → AuthError → 401 в error handler.
 */
export function authenticate(authService: AuthService): RequestHandler {
  return (req, _res, next) => {
    try {
      const header = req.headers.authorization;
      if (!header || !header.startsWith('Bearer ')) {
        throw new AuthError('TOKEN_INVALID', 'Требуется авторизация (Bearer token)');
      }
      const token = header.slice('Bearer '.length);
      req.principal = authService.getCurrentUser(token);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Требование роли. Используется группами routes из 4.7b.2+ (здесь пока не применяется). */
export function requireRole(authz: AuthorizationService, roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    try {
      if (!req.principal) throw new AuthError('UNAUTHORIZED', 'Требуется авторизация');
      authz.requireRole(req.principal, roles);
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireApproveAnomaly(authz: AuthorizationService): RequestHandler {
  return (req, _res, next) => {
    try {
      if (!req.principal) throw new AuthError('UNAUTHORIZED', 'Требуется авторизация');
      authz.requireApproveAnomaly(req.principal);
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireEditNormatives(authz: AuthorizationService): RequestHandler {
  return (req, _res, next) => {
    try {
      if (!req.principal) throw new AuthError('UNAUTHORIZED', 'Требуется авторизация');
      authz.requireEditNormatives(req.principal);
      next();
    } catch (err) {
      next(err);
    }
  };
}
