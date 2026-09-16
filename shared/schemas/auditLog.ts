import { z } from 'zod';

export const auditLogSchema = z.object({
  id: z.string(),
  userId: z.string(),
  username: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  // произвольные снимки состояния «до/после» для отката
  oldValues: z.unknown().nullable(),
  newValues: z.unknown().nullable(),
  timestamp: z.string(),
});
export type AuditLog = z.infer<typeof auditLogSchema>;
