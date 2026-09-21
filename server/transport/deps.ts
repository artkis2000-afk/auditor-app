import type { ServiceContext, OcrServiceDeps, UserService } from '../services/index.js';
import type { AuthorizationService, FirebaseTokenVerifier } from '../auth/index.js';
import type { ImageStore } from '../storage/index.js';

/**
 * Зависимости транспортного слоя (DI). Routes зависят от сервисов/auth, а НЕ от Firebase/repositories.
 *
 * PHASE 5.1: аутентификация — Firebase ID-токен (firebaseVerifier), профиль/bootstrap — userService.
 * Composition root (buildApp/composeApp) собирает реальные зависимости; тесты — стабы.
 *
 * ocr/imageStore опциональны: их использует только invoice upload/ocr.
 */
export interface AppDeps {
  ctx: ServiceContext;
  firebaseVerifier: FirebaseTokenVerifier;
  userService: UserService;
  authorizationService: AuthorizationService;
  ocr?: OcrServiceDeps;
  imageStore?: ImageStore;
  /** Разрешённые CORS-origin (из WEB_ORIGIN). Пусто → CORS не включается (same-origin/dev). */
  corsOrigins?: string[];
}
