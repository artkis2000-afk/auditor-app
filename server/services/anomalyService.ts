import type { AnomalyFlag } from '../../shared/index.js';
import type { BatchOp } from '../db/firestoreGateway.js';
import {
  recalculate,
  recalculateGlobal,
  type AnomalyChange,
  type AnomalyDataset,
  type RecalcOptions,
  type RecalcResult,
  type ScopedRecalcResult,
} from '../../domain/anomaly/index.js';
import type { ServiceContext } from './context.js';

/**
 * Оркестрация пересчёта аномалий: снимок из репозиториев → чистое доменное ядро →
 * атомарная запись флагов и статусов накладных в Firestore (один батч).
 * Domain о Firebase не знает; сервис лишь готовит снимок и сохраняет результат.
 */
export class AnomalyService {
  constructor(private readonly ctx: ServiceContext) {}

  /** Снимок данных для доменного движка. */
  private async buildDataset(): Promise<AnomalyDataset> {
    const [invoices, invoiceItems, nomenclatures, vehicles, settings] = await Promise.all([
      this.ctx.repositories.invoices.getAll(),
      this.ctx.repositories.invoiceItems.getAll(),
      this.ctx.repositories.nomenclature.getAll(),
      this.ctx.repositories.vehicles.getAll(),
      this.ctx.repositories.settings.get(),
    ]);
    return {
      invoices,
      invoiceItems,
      nomenclatures,
      vehicles,
      settings: { anomalyThreshold: settings.anomalyThreshold, duplicateDays: settings.duplicateDays },
    };
  }

  private options(): RecalcOptions {
    return {
      generateId: (invoiceId, index) => this.ctx.ids.generate(`af-${invoiceId}-${index}`),
      now: () => this.ctx.clock.now(),
    };
  }

  /** Полный пересчёт (эквивалент recalculateAllInvoiceAnomalies). */
  async recalculateAll(): Promise<RecalcResult> {
    const dataset = await this.buildDataset();
    const existing = await this.ctx.repositories.anomalyFlags.getAll();
    const result = recalculateGlobal(dataset, existing, this.options());
    await this.persist(dataset, existing, result);
    return result;
  }

  /** Инкрементальный пересчёт по описанию изменения (local/chain/global). */
  async recalculateForChange(change: AnomalyChange): Promise<ScopedRecalcResult> {
    const dataset = await this.buildDataset();
    const existing = await this.ctx.repositories.anomalyFlags.getAll();
    const result = recalculate(dataset, existing, change, this.options());
    await this.persist(dataset, existing, result);
    return result;
  }

  /**
   * Атомарно приводит anomalyFlags к result.flags и обновляет изменившиеся статусы накладных.
   * Примечание: при очень большом числе операций может понадобиться разбиение по лимиту батча
   * Firestore (500) — учтём на этапе интеграции с реальной БД.
   */
  private async persist(dataset: AnomalyDataset, existing: AnomalyFlag[], result: RecalcResult): Promise<void> {
    const ops: BatchOp[] = [];

    const newIds = new Set(result.flags.map((f) => f.id));
    for (const ef of existing) {
      if (!newIds.has(ef.id)) {
        ops.push({ type: 'delete', collection: 'anomalyFlags', id: ef.id });
      }
    }
    for (const f of result.flags) {
      ops.push({ type: 'set', collection: 'anomalyFlags', id: f.id, data: f as unknown as Record<string, unknown> });
    }

    for (const inv of dataset.invoices) {
      const status = result.statuses.get(inv.id);
      if (status && status !== inv.status) {
        ops.push({
          type: 'set',
          collection: 'invoices',
          id: inv.id,
          data: { ...inv, status, updatedAt: this.ctx.clock.now() } as unknown as Record<string, unknown>,
        });
      }
    }

    await this.ctx.gateway.commitBatch(ops);
  }
}
