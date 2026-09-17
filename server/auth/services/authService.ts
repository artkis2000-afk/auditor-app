import type { AuthUser, LoginResponse } from '../../../shared/index.js';
import type { ServiceContext } from '../../services/context.js';
import { AuthError } from '../domain/errors.js';
import type { PasswordHasher } from '../domain/passwordHasher.js';
import { TokenService, type TokenSubject } from '../domain/tokenService.js';

/**
 * Оркестрация аутентификации (перенос /api/auth/login и /api/auth/me).
 * Сессия stateless (нет серверного store) → серверный logout НЕ реализуется (по legacy).
 */
export class AuthService {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly tokenService: TokenService,
    private readonly hasher: PasswordHasher,
  ) {}

  /** Вход. Ошибки/сообщения — как в legacy. */
  async login(username: string, password: string): Promise<LoginResponse> {
    if (!username || !password) {
      throw new AuthError('MISSING_CREDENTIALS', 'Введите имя пользователя и пароль');
    }

    const user = await this.ctx.repositories.users.findByUsername(username);
    if (!user || !user.isActive) {
      throw new AuthError('USER_NOT_FOUND', 'Пользователь не найден или заблокирован');
    }

    const credential = await this.ctx.repositories.credentials.getByUserId(user.id);
    if (!credential || credential.algo !== this.hasher.algo || !this.hasher.verify(password, credential.hash)) {
      throw new AuthError('INVALID_PASSWORD', 'Неверный пароль');
    }

    const subject: TokenSubject = {
      id: user.id,
      username: user.username,
      role: user.role,
      fullName: user.fullName,
    };
    const token = this.tokenService.create(subject);
    const authUser: AuthUser = { id: user.id, username: user.username, fullName: user.fullName, role: user.role };
    return { token, user: authUser };
  }

  /**
   * Текущий пользователь из токена (== /api/auth/me).
   * Как в legacy — данные берутся из payload токена, без обращения к БД (stale-роль не исправляется).
   */
  getCurrentUser(token: string): AuthUser {
    const result = this.tokenService.verify(token);
    if (!result.valid) {
      if (result.reason === 'expired') {
        throw new AuthError('TOKEN_EXPIRED', 'Неверный или просроченный сессионный токен');
      }
      throw new AuthError('TOKEN_INVALID', 'Неверный или просроченный сессионный токен');
    }
    const c = result.claims;
    return { id: c.id, username: c.username, fullName: c.fullName, role: c.role };
  }
}
