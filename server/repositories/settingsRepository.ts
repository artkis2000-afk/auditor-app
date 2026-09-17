import type { FirestoreGateway } from '../db/firestoreGateway.js';
import { systemSettingsSchema, type SystemSettings } from '../../shared/index.js';

/**
 * Репозиторий системных настроек. Коллекция `settings`, единственный документ `global`.
 * Отсутствующие поля заполняются дефолтами схемы (anomalyThreshold=10, duplicateDays=180, gemini).
 */
export class SettingsRepository {
  private static readonly DOC_ID = 'global';

  constructor(private readonly gateway: FirestoreGateway) {}

  async get(): Promise<SystemSettings> {
    const doc = await this.gateway.getById('settings', SettingsRepository.DOC_ID);
    return systemSettingsSchema.parse(doc?.data ?? {});
  }

  /** Изменяющая операция. */
  async set(settings: SystemSettings): Promise<void> {
    await this.gateway.set('settings', SettingsRepository.DOC_ID, settings as unknown as Record<string, unknown>);
  }
}
