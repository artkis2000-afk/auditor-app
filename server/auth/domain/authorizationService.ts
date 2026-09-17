import type { UserRole } from '../../../shared/index.js';
import { AuthError } from './errors.js';

/**
 * Правила авторизации — перенос legacy role/username-предикатов 1:1.
 * ВНИМАНИЕ: часть привилегий в legacy привязана к username ('boss'/'admin'), а не к роли —
 * сохраняем как есть (не заменяем ролями), см. KI по auth.
 */
export interface AuthPrincipal {
  id?: string;
  username: string;
  role: UserRole;
}

export class AuthorizationService {
  hasRole(user: AuthPrincipal, roles: UserRole[]): boolean {
    return roles.includes(user.role);
  }

  isAdmin(user: AuthPrincipal): boolean {
    return user.role === 'admin';
  }

  /** Одобрять аномалии может только Владелец: role=admin И username != 'admin' (фактически boss). */
  canApproveAnomaly(user: AuthPrincipal): boolean {
    return user.role === 'admin' && user.username !== 'admin';
  }

  /** Задавать/менять нормативный срок службы может только boss. */
  canEditNormatives(user: AuthPrincipal): boolean {
    return user.username === 'boss';
  }

  requireRole(user: AuthPrincipal, roles: UserRole[]): void {
    if (!this.hasRole(user, roles)) {
      throw new AuthError('FORBIDDEN', 'Недостаточно прав для выполнения операции');
    }
  }

  requireApproveAnomaly(user: AuthPrincipal): void {
    if (!this.canApproveAnomaly(user)) {
      throw new AuthError('FORBIDDEN', 'У вас нет прав для одобрения аномалий. Данная операция доступна только Владельцу (boss)');
    }
  }

  requireEditNormatives(user: AuthPrincipal): void {
    if (!this.canEditNormatives(user)) {
      throw new AuthError('FORBIDDEN', 'Задавать нормативный срок службы запчастей может только Владелец (boss)');
    }
  }
}
