import type { InvoiceItem } from '../../../shared/index.js';
import type { AnomalyContext, AnomalyFlagDraft, AnomalyRule } from '../types.js';

/**
 * Правило завышения цены у того же поставщика.
 * Дословный перенос блока B1 из исходного anomalyDetector.ts.
 * severity=medium, flagType=price_anomaly. Формула и текст details сохранены 1:1.
 */
export const supplierPriceRule: AnomalyRule = {
  type: 'price_anomaly',
  evaluate(item: InvoiceItem, ctx: AnomalyContext): AnomalyFlagDraft[] {
    const currentPrice = item.unitPrice;
    const supplierName = ctx.supplierName;

    // Первая предыдущая покупка того же поставщика (сравнение по нормализованному имени)
    const sameSupplierPrev = ctx.priorItems.find((prev) => {
      const prevSupName = prev.invoice.supplierName || prev.invoice.rawSupplierName || '';
      return prevSupName.toLowerCase().trim() === supplierName.toLowerCase().trim();
    });

    if (!sameSupplierPrev) return [];

    const prevPrice = sameSupplierPrev.item.unitPrice;
    const deviation = ((currentPrice - prevPrice) / prevPrice) * 100;

    if (deviation > ctx.settings.anomalyThreshold) {
      return [
        {
          invoiceItemId: item.id,
          invoiceId: ctx.invoice.id,
          relatedInvoiceId: sameSupplierPrev.invoice.id,
          flagType: 'price_anomaly',
          details: `Завышение цены у поставщика "${supplierName}" на ${deviation.toFixed(1)}%: текущая цена составляет ${currentPrice.toLocaleString('ru-RU')} руб. против ${prevPrice.toLocaleString('ru-RU')} руб. в закупке от ${sameSupplierPrev.invoice.recognizedDate}.`,
          severity: 'medium',
          isResolved: false,
          resolvedBy: null,
          resolvedAt: null,
        },
      ];
    }

    return [];
  },
};
