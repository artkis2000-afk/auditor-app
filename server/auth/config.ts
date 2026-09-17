import { AuthError } from './domain/errors.js';

export interface AuthConfig {
  jwtSecret: string;
}

/**
 * Конфигурация auth из окружения. В отличие от legacy (захардкоженный fallback — KI-13),
 * секрет обязателен: при отсутствии JWT_SECRET бросается явная ошибка конфигурации.
 * Реальный секрет — только в .env, не в коде/git/тестах.
 */
export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const jwtSecret = env.JWT_SECRET?.trim();
  if (!jwtSecret) {
    throw new AuthError('CONFIG', 'JWT_SECRET не задан в окружении (.env). Дефолтный секрет не используется.');
  }
  return { jwtSecret };
}
