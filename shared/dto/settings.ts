import { z } from 'zod';

export const settingsUpdateRequestSchema = z.object({
  anomalyThreshold: z.coerce.number().optional(),
  duplicateDays: z.coerce.number().optional(),
  aiOcrEngine: z.string().optional(),
  googleSheetsDbId: z.string().optional(),
  googleServiceAccountJson: z.string().optional(),
  centralGoogleToken: z.string().optional(),
});
export type SettingsUpdateRequest = z.infer<typeof settingsUpdateRequestSchema>;
