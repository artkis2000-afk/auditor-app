/**
 * Потенциальная экономия по ценовым аномалиям.
 * Дословный перенос расчёта potentialSavings из server.ts (dashboard).
 * Вызывающая сторона передаёт уже отфильтрованные флаги (price_anomaly, не resolved,
 * в нужном периоде) и позиции для поиска lineSum.
 */

export interface SavingsFlag {
  details: string;
  invoiceItemId: string;
}

export interface SavingsItem {
  id: string;
  lineSum: number;
}

export function computePotentialSavings(priceAnomalyFlags: SavingsFlag[], items: SavingsItem[]): number {
  let potentialSavings = 0;

  for (const flag of priceAnomalyFlags) {
    const item = items.find((ii) => ii.id === flag.invoiceItemId);
    if (item) {
      const percentMatch =
        flag.details.match(/завышение[^0-9]*([0-9.]+)/i) || flag.details.match(/превышает[^0-9]*([0-9.]+)/i);
      if (percentMatch) {
        const percent = parseFloat(percentMatch[1]!);
        potentialSavings += Math.round(item.lineSum - item.lineSum / (1 + percent / 100));
      } else {
        potentialSavings += Math.round(item.lineSum * 0.15); // резерв: 15% оценочной переплаты
      }
    }
  }

  return potentialSavings;
}
