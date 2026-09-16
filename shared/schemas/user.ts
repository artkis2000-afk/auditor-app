import { z } from 'zod';
import { userRoleSchema } from '../enums/index.js';

export const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  fullName: z.string(),
  role: userRoleSchema,
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type User = z.infer<typeof userSchema>;

/**
 * Учётные данные пользователя.
 * PHASE 3: явное поле `algo` — шов для будущей смены хешера (sha256 → argon2/bcrypt)
 * без изменения остального кода. Исходная система хранит только строку-хеш в map `passwords`;
 * репозиторий адаптирует старый формат к этому виду.
 */
export const credentialSchema = z.object({
  userId: z.string(),
  algo: z.enum(['sha256', 'bcrypt', 'argon2']).default('sha256'),
  hash: z.string(),
});
export type Credential = z.infer<typeof credentialSchema>;
