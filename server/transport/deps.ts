import type { ServiceContext } from '../services/index.js';
import type { AuthService, AuthorizationService, TokenService } from '../auth/index.js';

/**
 * Зависимости транспортного слоя (DI). Routes зависят от сервисов/auth, а НЕ от Firebase/repositories.
 * Композиционный корень собирает ServiceContext (Admin gateway из env) и передаёт это в createApp;
 * тесты передают in-memory gateway.
 */
export interface AppDeps {
  ctx: ServiceContext;
  authService: AuthService;
  authorizationService: AuthorizationService;
  tokenService: TokenService;
}
