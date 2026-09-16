import { z } from 'zod';
import { userRoleSchema } from '../enums/index.js';

export const loginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

// Публичный профиль пользователя (без пароля), возвращаемый API
export const authUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  fullName: z.string(),
  role: userRoleSchema,
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const loginResponseSchema = z.object({
  token: z.string(),
  user: authUserSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;
