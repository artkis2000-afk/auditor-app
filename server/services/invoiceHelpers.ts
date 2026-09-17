import type { InvoiceItem, Supplier } from '../../shared/index.js';
import type { InvoiceItemInput } from '../../shared/index.js';
import {
  splitRawNameByQuantity,
  detectVehicleFromText,
  detectPlacementFromText,
} from '../../domain/placement/index.js';
import type { IdGenerator } from './context.js';

/** PIN для операций над сверёнными накладными (legacy-константа, KI-5). */
export const RECONCILED_PIN = '1308';

/** Имена, при которых поставщик не создаётся (legacy ensureSupplierExists). */
const AUTO_SUPPLIER_SKIP = new Set(['Не распознан', 'Неизвестный', 'Неизвестный поставщик']);

function round2(n: number): number {
  return Number(n.toFixed(2));
}

/**
 * Построение позиций накладной из входных данных (перенос логики manual/edit из server.ts).
 * qty>1 → сплит на qty штук (quantity=1, lineSum=round(orig/qty,2)); детект машины/узла.
 */
export function buildInvoiceItems(
  inputItems: InvoiceItemInput[],
  invoiceId: string,
  ids: IdGenerator,
): { items: InvoiceItem[]; totalSum: number } {
  const items: InvoiceItem[] = [];
  let totalSum = 0;
  let counter = 0;

  inputItems.forEach((it, index) => {
    const qty = Number(it.quantity) || 1;
    const unitPrice = Number(it.unitPrice) || 0;
    const originalLineSum =
      it.lineSum !== undefined && it.lineSum !== null && !isNaN(Number(it.lineSum))
        ? Number(it.lineSum)
        : qty * unitPrice;
    const matchedNomenclatureId = it.matchedNomenclatureId ?? null;

    if (qty > 1) {
      const splitNames = splitRawNameByQuantity(it.rawName || '', qty);
      for (let i = 0; i < qty; i++) {
        const splitName = splitNames[i] ?? (it.rawName || '');
        const lineSum = round2(originalLineSum / qty);
        totalSum += lineSum;

        const vehicleId = it.vehicleId || detectVehicleFromText(splitName);
        let placement = it.truckPlacement ?? null;
        const detected = detectPlacementFromText(splitName, index);
        if (detected) placement = detected;

        items.push({
          id: ids.generate(`ii-${invoiceId}-${counter++}`),
          invoiceId,
          nomenclatureId: matchedNomenclatureId,
          rawName: splitName,
          quantity: 1,
          unitPrice,
          lineSum,
          matchedNomenclatureId,
          vehicleId,
          truckPlacement: placement,
        });
      }
    } else {
      totalSum += originalLineSum;
      const rawName = it.rawName || '';
      const vehicleId = it.vehicleId || detectVehicleFromText(rawName);
      let placement = it.truckPlacement ?? null;
      const detected = detectPlacementFromText(rawName, index);
      if (detected) placement = detected;

      items.push({
        id: it.id || ids.generate(`ii-${invoiceId}-${counter++}`),
        invoiceId,
        nomenclatureId: matchedNomenclatureId,
        rawName,
        quantity: 1,
        unitPrice,
        lineSum: originalLineSum,
        matchedNomenclatureId,
        vehicleId,
        truckPlacement: placement,
      });
    }
  });

  return { items, totalSum };
}

/**
 * Обеспечивает наличие поставщика по имени (перенос ensureSupplerExists).
 * Возвращает id и, если создан новый — объект поставщика для записи.
 * ВНИМАНИЕ: случайный 10-значный ИНН — legacy-поведение (KI-6).
 */
export function ensureSupplier(
  suppliers: Supplier[],
  supplierName: string | undefined | null,
  actorId: string,
  ids: IdGenerator,
  now: string,
): { supplierId: string | null; created?: Supplier } {
  if (!supplierName || AUTO_SUPPLIER_SKIP.has(supplierName)) return { supplierId: null };
  const trimmed = supplierName.trim();
  if (!trimmed) return { supplierId: null };

  const existing = suppliers.find((s) => s.name.toLowerCase() === trimmed.toLowerCase() && !s.deletedAt);
  if (existing) return { supplierId: existing.id };

  let inn = '';
  let exists = true;
  while (exists) {
    inn = Math.floor(1000000000 + Math.random() * 9000000000).toString();
    exists = suppliers.some((s) => s.inn === inn && !s.deletedAt);
  }

  const created: Supplier = {
    id: ids.generate('s'),
    name: trimmed,
    legalAddress: '',
    inn,
    isApproved: true,
    notes: 'Создан автоматически при импорте накладной',
    createdBy: actorId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  return { supplierId: created.id, created };
}
