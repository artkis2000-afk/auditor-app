import type { ServiceContext, OcrServiceDeps } from '../services/index.js';
import type { AuthService, AuthorizationService, TokenService } from '../auth/index.js';
import type { ImageStore } from '../storage/index.js';

/**
 * Зависимости транспортного слоя (DI). Routes зависят от сервисов/auth, а НЕ от Firebase/repositories.
 * Композиционный корень собирает ServiceContext (Admin gateway из env) и передаёт это в createApp;
 * тесты передают in-memory gateway.
 *
 * ocr/imageStore опциональны: их использует только invoice upload/ocr. Собираются в composition
 * root (реальные Gemini/Firebase Storage) и передаются готовыми — routes их НЕ создают.
 */
export interface AppDeps {
  ctx: ServiceContext;
  authService: AuthService;
  authorizationService: AuthorizationService;
  tokenService: TokenService;
  ocr?: OcrServiceDeps;
  imageStore?: ImageStore;
  /** Разрешённые CORS-origin (из WEB_ORIGIN). Пусто → CORS не включается (same-origin/dev). */
  corsOrigins?: string[];
}
