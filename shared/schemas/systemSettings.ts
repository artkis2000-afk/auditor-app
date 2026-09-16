import { z } from 'zod';

export const systemSettingsSchema = z.object({
  // порог отклонения цены в % (по умолчанию 10)
  anomalyThreshold: z.number().default(10),
  // нормативное окно дубликатов по умолчанию, дней (180)
  duplicateDays: z.number().default(180),
  aiOcrEngine: z.string().default('gemini'),
  // Google-интеграции (опционально)
  googleServiceAccountJson: z.string().optional(),
  centralGoogleToken: z.string().optional(),
  centralGoogleEmail: z.string().optional(),
  googleSheetsDbId: z.string().optional(),
});
export type SystemSettings = z.infer<typeof systemSettingsSchema>;
