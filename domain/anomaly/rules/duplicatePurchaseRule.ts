import type { InvoiceItem, TruckPlacement } from '../../../shared/index.js';
import type { AnomalyContext, AnomalyFlagDraft, AnomalyRule } from '../types.js';

/**
 * Правило повторной закупки раньше нормативного срока износа.
 * Дословный перенос блока A (DUPLICATE PURCHASE CHECK) из исходного anomalyDetector.ts.
 * severity=high, flagType=duplicate_exceed. Текст details и метки узлов сохранены 1:1.
 */

// Метки узлов для текста details (перенос из исходника)
const placementLabels: Partial<Record<TruckPlacement, string>> = {
  cabin: 'Кабина (Код 1)',
  steering_left: 'Левое рулевое колесо (Код 2)',
  steering_right: 'Правое рулевое колесо (Код 3)',
  driving_left_outer: 'Левое крайнее колесо ходовой оси (Код 4)',
  driving_left_inner: 'Левое ближнее колесо ходовой оси (Код 4*)',
  driving_right_outer: 'Правое крайнее колесо ходовой оси (Код 5)',
  driving_right_inner: 'Правое ближнее колесо ходовой оси (Код 5*)',
  trailer_1_left: '1-я ось прицепа левая (Код 6)',
  trailer_1_right: '1-я ось прицепа правая (Код 7)',
  trailer_2_left: '2-я ось прицепа левая (Код 8)',
  trailer_2_right: '2-я ось прицепа правая (Код 9)',
  trailer_3_left: '3-я ось прицепа левая (Код 10)',
  trailer_3_right: '3-я ось прицепа правая (Код 11)',
  tractor_frame: 'Рама тягача (Код 12)',
  trailer_body: 'Прицеп (Код 13)',
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export const duplicatePurchaseRule: AnomalyRule = {
  type: 'duplicate_exceed',
  evaluate(item: InvoiceItem, ctx: AnomalyContext): AnomalyFlagDraft[] {
    const { nomenclature, invoiceDate, priorItems } = ctx;

    // Только если нормативный срок службы задан
    if (!(nomenclature.normativeServiceDays > 0)) return [];
    const normDays = nomenclature.normativeServiceDays;

    // Покупки в пределах нормативного окна для той же машины и узла (если заданы)
    const duplicatesWithinNorm = priorItems.filter((prev) => {
      // Машина: совпадает, если задана у обеих
      if (item.vehicleId && prev.item.vehicleId && item.vehicleId !== prev.item.vehicleId) {
        return false;
      }
      // Узел: совпадает, если задан у обеих и не 'none'
      if (
        item.truckPlacement &&
        prev.item.truckPlacement &&
        item.truckPlacement !== 'none' &&
        prev.item.truckPlacement !== 'none' &&
        item.truckPlacement !== prev.item.truckPlacement
      ) {
        return false;
      }

      const prevDate = new Date(prev.invoice.recognizedDate);
      const diffTime = Math.abs(invoiceDate.getTime() - prevDate.getTime());
      const diffDays = Math.ceil(diffTime / MS_PER_DAY);
      return diffDays <= normDays;
    });

    if (duplicatesWithinNorm.length === 0) return [];

    const mostRecentDup = duplicatesWithinNorm[0]!;
    const prevDateStr = mostRecentDup.invoice.recognizedDate;
    const diffTime = Math.abs(invoiceDate.getTime() - new Date(prevDateStr).getTime());
    const diffDays = Math.ceil(diffTime / MS_PER_DAY);

    const vehicleObj = ctx.vehicles.find((v) => v.id === item.vehicleId);
    const vehicleLabel = vehicleObj ? ` для автомобиля ${vehicleObj.name} (${vehicleObj.plate})` : '';

    const placementLabel =
      item.truckPlacement && placementLabels[item.truckPlacement]
        ? ` на позицию "${placementLabels[item.truckPlacement]}"`
        : '';

    return [
      {
        invoiceItemId: item.id,
        invoiceId: ctx.invoice.id,
        relatedInvoiceId: mostRecentDup.invoice.id,
        flagType: 'duplicate_exceed',
        details: `Подозрение на избыточную закупку/хищение: деталь "${nomenclature.normalizedName}" закуплена повторно${vehicleLabel}${placementLabel} всего через ${diffDays} дней после предыдущей закупки от ${prevDateStr}. Нормативный срок износа: ${normDays} дней.`,
        severity: 'high',
        isResolved: false,
        resolvedBy: null,
        resolvedAt: null,
      },
    ];
  },
};
