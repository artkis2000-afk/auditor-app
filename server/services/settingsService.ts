import type { SystemSettings } from '../../shared/index.js';
import type { SettingsUpdateRequest } from '../../shared/index.js';
import type { ServiceContext } from './context.js';
import { AuditService } from './auditService.js';
import type { Actor } from './invoiceService.js';

/**
 * Системные настройки (перенос /api/settings).
 * ВНИМАНИЕ (KI-12): как в legacy, audit пишет oldValues=null → откат settings_update нерабочий.
 */
export class SettingsService {
  private readonly audit: AuditService;
  constructor(private readonly ctx: ServiceContext) {
    this.audit = new AuditService(ctx);
  }

  async get(): Promise<SystemSettings> {
    return this.ctx.repositories.settings.get();
  }

  async update(input: SettingsUpdateRequest, actor: Actor): Promise<SystemSettings> {
    const existing = await this.ctx.repositories.settings.get();

    let centralGoogleEmail = existing.centralGoogleEmail;
    if (input.googleServiceAccountJson) {
      try {
        const parsed = JSON.parse(input.googleServiceAccountJson) as { client_email?: string };
        if (parsed.client_email) centralGoogleEmail = parsed.client_email;
      } catch {
        // некорректный JSON — email не обновляем (как в legacy)
      }
    } else if (input.googleServiceAccountJson === '') {
      centralGoogleEmail = undefined;
    }

    const updated: SystemSettings = {
      ...existing,
      anomalyThreshold: input.anomalyThreshold !== undefined ? Number(input.anomalyThreshold) : existing.anomalyThreshold || 10,
      duplicateDays: input.duplicateDays !== undefined ? Number(input.duplicateDays) : existing.duplicateDays || 180,
      aiOcrEngine: input.aiOcrEngine || existing.aiOcrEngine || 'gemini',
      googleSheetsDbId: input.googleSheetsDbId !== undefined ? input.googleSheetsDbId : existing.googleSheetsDbId,
      googleServiceAccountJson:
        input.googleServiceAccountJson !== undefined ? input.googleServiceAccountJson : existing.googleServiceAccountJson,
      centralGoogleToken: input.centralGoogleToken !== undefined ? input.centralGoogleToken : existing.centralGoogleToken,
      centralGoogleEmail,
    };

    await this.ctx.repositories.settings.set(updated);
    // legacy: oldValues=null (KI-12) — сохраняем поведение
    await this.audit.log({
      userId: actor.id,
      username: actor.username,
      action: 'settings_update',
      entityType: 'system',
      entityId: 'settings',
      oldValues: null,
      newValues: updated,
    });
    return updated;
  }
}
