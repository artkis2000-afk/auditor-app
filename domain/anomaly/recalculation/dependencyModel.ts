import type { AnomalyDataset } from '../types.js';

/**
 * Модель зависимостей пересчёта аномалий.
 *
 * Инвариант (выведен из детектора): флаги позиции зависят ТОЛЬКО от предыдущих покупок
 * той же номенклатуры с датой ≤ её датой (из confirmed/flagged накладных). Значит:
 *  - разные номенклатуры независимы;
 *  - изменение влияет только на позиции той же номенклатуры с датой ≥ даты изменения
 *    (они «смотрят назад» и могут увидеть/потерять изменённый prior);
 *  - смена номенклатуры затрагивает ДВЕ цепочки (старую и новую);
 *  - изменение settings.anomalyThreshold влияет на все price-флаги → global;
 *  - граница «того же дня» включается (сравнение даты ≥, т.к. детектор использует ≤).
 */

export type AnomalyChange =
  // Изменение порога/настроек — влияет на все price-флаги
  | { kind: 'settings_changed' }
  // Явный полный пересчёт (repair/миграция)
  | { kind: 'full_refresh' }
  // Добавлена накладная (upload/manual). Локально, если позже нет позиций тех же номенклатур
  | { kind: 'invoice_appended'; invoiceId: string; date: string; nomenclatureIds: string[] }
  // Изменены атрибуты позиции(й) в рамках тех же номенклатур (цена/поставщик/машина/узел/дата/статус/удаление)
  | { kind: 'item_attributes_changed'; nomenclatureIds: string[]; fromDate: string }
  // Сменилась привязка номенклатуры позиции (N1 → N2)
  | { kind: 'item_nomenclature_changed'; oldNomenclatureId: string; newNomenclatureId: string; fromDate: string };

export type RecalcScope =
  | { mode: 'global' }
  | { mode: 'chain'; nomenclatureIds: string[]; fromDate: string }
  | { mode: 'local'; invoiceId: string };

/** Активные (не удалённые) confirmed/flagged накладные, имеющие позицию одной из номенклатур с датой ≥ fromDate. */
function invoicesTouchingNoms(dataset: AnomalyDataset, noms: Set<string>, fromDate: string): string[] {
  const from = new Date(fromDate).getTime();
  const ids = new Set<string>();
  for (const inv of dataset.invoices) {
    if (inv.deletedAt) continue;
    if (inv.status !== 'confirmed' && inv.status !== 'flagged') continue;
    if (new Date(inv.recognizedDate).getTime() < from) continue;
    const hasNom = dataset.invoiceItems.some(
      (ii) => ii.invoiceId === inv.id && ii.matchedNomenclatureId != null && noms.has(ii.matchedNomenclatureId),
    );
    if (hasNom) ids.add(inv.id);
  }
  return [...ids];
}

export function computeScope(change: AnomalyChange, dataset: AnomalyDataset): RecalcScope {
  switch (change.kind) {
    case 'settings_changed':
    case 'full_refresh':
      return { mode: 'global' };

    case 'item_nomenclature_changed': {
      const noms = [...new Set([change.oldNomenclatureId, change.newNomenclatureId].filter(Boolean))];
      return { mode: 'chain', nomenclatureIds: noms, fromDate: change.fromDate };
    }

    case 'item_attributes_changed':
      return { mode: 'chain', nomenclatureIds: [...new Set(change.nomenclatureIds)], fromDate: change.fromDate };

    case 'invoice_appended': {
      const noms = new Set(change.nomenclatureIds);
      const touched = invoicesTouchingNoms(dataset, noms, change.date);
      // Затрагивается только сама накладная (позже нет позиций тех же номенклатур) → локально
      if (touched.length <= 1) return { mode: 'local', invoiceId: change.invoiceId };
      return { mode: 'chain', nomenclatureIds: [...noms], fromDate: change.date };
    }
  }
}

/** Разворачивает scope в множество id накладных для пересчёта. */
export function expandScope(scope: RecalcScope, dataset: AnomalyDataset): Set<string> {
  if (scope.mode === 'global') {
    return new Set(
      dataset.invoices
        .filter((i) => !i.deletedAt && (i.status === 'confirmed' || i.status === 'flagged'))
        .map((i) => i.id),
    );
  }
  if (scope.mode === 'local') {
    const inv = dataset.invoices.find((i) => i.id === scope.invoiceId);
    return inv && !inv.deletedAt && (inv.status === 'confirmed' || inv.status === 'flagged')
      ? new Set([scope.invoiceId])
      : new Set();
  }
  return new Set(invoicesTouchingNoms(dataset, new Set(scope.nomenclatureIds), scope.fromDate));
}
