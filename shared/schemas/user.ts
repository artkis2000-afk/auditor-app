import { z } from 'zod';
import { userRoleSchema } from '../enums/index.js';

/**
 * Профиль пользователя приложения. docId = Firebase UID.
 *
 * PHASE 5.1: идентичность обеспечивает Firebase Authentication (Google / email-password).
 * Firestore-профиль `users/{uid}` — зеркало личности + переходное поле `role`
 * (совместимость с существующей authorization; в 5.2 роль переедет в membership).
 *
 * Поля email/displayName/photoURL — денормализованное зеркало Firebase-клеймов.
 * Поля username/fullName/isActive сохранены для совместимости с текущим кодом
 * (req.principal, аудит, UI): username := email, fullName := displayName.
 */
export const userSchema = z.object({
  id: z.string(), // == Firebase UID
  username: z.string(), // совместимость: = email (или uid, если email отсутствует)
  fullName: z.string(), // совместимость: = displayName (или email/uid)
  role: userRoleSchema, // переходное поле (5.2 → membership)
  isActive: z.boolean().default(true),
  createdAt: z.string(),
  // Firebase identity profile (5.1)
  email: z.string().nullable().default(null),
  displayName: z.string().nullable().default(null),
  photoURL: z.string().nullable().default(null),
  updatedAt: z.string().nullable().default(null),
});
export type User = z.infer<typeof userSchema>;
