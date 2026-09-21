import { z } from 'zod';
import { userRoleSchema } from '../enums/index.js';

/**
 * Публичный профиль текущего пользователя (без учётных данных), возвращаемый API.
 *
 * PHASE 5.1: identity — Firebase. `id` == Firebase UID; `username` — совместимость (= email).
 * `role` — переходное поле authorization (в 5.2 заменяется membership-ролью).
 */
export const authUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  fullName: z.string(),
  role: userRoleSchema,
  email: z.string().nullable().optional(),
  emailVerified: z.boolean().optional(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

/** Ответ GET /api/auth/me. */
export const meResponseSchema = z.object({
  user: authUserSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;
