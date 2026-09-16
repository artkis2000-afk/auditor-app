import type { InvoiceItem } from '../../../shared/index.js';
import type { AnomalyContext, AnomalyFlagDraft, AnomalyRule } from '../types.js';

/**
 * Правило отклонения от средней рыночной цены (по всем поставщикам за 90 дней).
 * Дословный перенос блока B2 из исходного anomalyDetector.ts.
 * severity=low, flagType=price_anomaly. Окно 90 дней, формула и текст details сохранены 1:1.
 */
const MS_PER_DAY = 1000 * 60 * 60 * 24;

export const marketPriceRule: AnomalyRule = {
  type: 'price_anomaly',
  evaluate(item: InvoiceItem, ctx: AnomalyContext): AnomalyFlagDraft[] {
    const currentPrice = item.unitPrice;
    const ninetyDaysAgo = new Date(ctx.invoiceDate.getTime() - 90 * MS_PER_DAY);

    const recentPurchasesAllSuppliers = ctx.priorItems.filter(
      (prev) => new Date(prev.invoice.recognizedDate) >= ninetyDaysAgo,
    );

    if (recentPurchasesAllSuppliers.length === 0) return [];

    const sumPrices = recentPurchasesAllSuppliers.reduce((sum, prev) => sum + prev.item.unitPrice, 0);
    const avgPrice = sumPrices / recentPurchasesAllSuppliers.length;
    const deviationFromAvg = ((currentPrice - avgPrice) / avgPrice) * 100;

    if (deviationFromAvg > ctx.settings.anomalyThreshold) {
      return [
        {
          invoiceItemId: item.id,
          invoiceId: ctx.invoice.id,
          relatedInvoiceId: recentPurchasesAllSuppliers[0]?.invoice.id,
          flagType: 'price_anomaly',
          details: `Цена превышает среднюю рыночную по компании на ${deviationFromAvg.toFixed(1)}%: текущая цена составляет ${currentPrice.toLocaleString('ru-RU')} руб., средняя цена за последние 90 дней по всем поставщикам: ${avgPrice.toFixed(0)} руб.`,
          severity: 'low',
          isResolved: false,
          resolvedBy: null,
          resolvedAt: null,
        },
      ];
    }

    return [];
  },
};
