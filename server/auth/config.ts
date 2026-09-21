import { AuthError } from './domain/errors.js';

/**
 * Конфигурация аутентификации (PHASE 5.1: Firebase).
 * Секретов не требует: проверка ID-токена — публичными ключами Google (см. firebaseTokenVerifier).
 * JWT_SECRET/legacy custom-token больше не используются.
 */
export interface FirebaseAuthConfig {
  /** Firebase/GCP project id — ожидаемые iss/aud проверяемого ID-токена. */
  projectId: string;
  /**
   * Переходный bootstrap роли (до 5.2 membership): email'ы из этого списка получают
   * role=admin при первом входе, все остальные — role=viewer (default-deny).
   * Источник — env AUTH_ADMIN_EMAILS (через запятую).
   */
  adminEmails: string[];
}

export function loadFirebaseAuthConfig(env: NodeJS.ProcessEnv = process.env): FirebaseAuthConfig {
  const projectId = (env.FIREBASE_PROJECT_ID ?? env.GCP_PROJECT_ID)?.trim();
  if (!projectId) {
    throw new AuthError('CONFIG', 'FIREBASE_PROJECT_ID (или GCP_PROJECT_ID) не задан в окружении (.env).');
  }
  const adminEmails = (env.AUTH_ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return { projectId, adminEmails };
}
