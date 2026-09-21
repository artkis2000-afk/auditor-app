import type { RequestHandler } from 'express';
import type { UserRole } from '../../shared/index.js';
import { AuthError, type AuthorizationService, type FirebaseTokenVerifier } from '../auth/index.js';
import type { UserService } from '../services/index.js';

/**
 * Аутентификация (PHASE 5.1): извлекает Bearer Firebase ID-токен, проверяет его (jose/JWKS),
 * при первом входе создаёт профиль users/{uid} и кладёт verified-личность в req.principal.
 * UID берётся ТОЛЬКО из проверенного токена (никогда из body/query/params).
 * Ошибки (нет/кривой/просроченный токен, отключённый аккаунт) → AuthError → 401/403.
 */
export function authenticate(verifier: FirebaseTokenVerifier, userService: UserService): RequestHandler {
  return async (req, _res, next) => {
    try {
      const header = req.headers.authorization;
      if (!header || !header.startsWith('Bearer ')) {
        throw new AuthError('TOKEN_INVALID', 'Требуется авторизация (Bearer token)');
      }
      const token = header.slice('Bearer '.length).trim();
      const identity = await verifier.verify(token);
      const profile = await userService.getOrCreateProfile(identity);
      if (!profile.isActive) {
        throw new AuthError('FORBIDDEN', 'Учётная запись отключена');
      }
      req.principal = userService.toAuthUser(profile, identity);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Требование роли (authorization; переходно — до 5.2 membership). */
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
