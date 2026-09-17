import type { InvoiceItem, Nomenclature, NomenclatureAlias, TruckPlacement } from '../../shared/index.js';
import {
  splitRawNameByQuantity,
  detectVehicleFromText,
  detectPlacementFromText,
} from '../../domain/placement/index.js';
import { findBestNomenclatureMatches } from '../../domain/matching/index.js';
import type { ParsedInvoice } from '../ai/types.js';
import type { IdGenerator } from './context.js';

/** «Общий расход» (на все машины) — перенос regex из runOcrAndConfirm. */
const GENERAL_EXPENSE_RE = /на\s+все|общий|для\s+всех|весь\s+автопарк|все\s+машины/i;

function round2(n: number): number {
  return Number(n.toFixed(2));
}

/** Извлекает base64 и mime из data-URL imagePath. */
export function extractImageData(imagePath: string): { base64: string; mimeType: string } {
  const base64 = imagePath.includes(',') ? imagePath.split(',')[1] ?? '' : imagePath;
  let mimeType = 'image/jpeg';
  if (imagePath.startsWith('data:')) {
    const m = imagePath.split(';')[0]?.split(':')[1];
    if (m) mimeType = m;
  }
  return { base64, mimeType };
}

/**
 * Сборка позиций из распознанной накладной (перенос item-логики runOcrAndConfirm).
 * Возвращает позиции и авто-созданные номенклатуры (для записи).
 * Matching: findBestNomenclatureMatches с инъекцией detectVehicleFromText, порог 0.6,
 * иначе поиск по имени/авто-создание. vehicle/placement — по правилам оригинала.
 */
export function buildOcrItems(
  parsed: ParsedInvoice,
  invoiceId: string,
  filename: string | null,
  existingNomenclature: Nomenclature[],
  aliases: NomenclatureAlias[],
  ids: IdGenerator,
  now: string,
): { items: InvoiceItem[]; createdNomenclatures: Nomenclature[] } {
  const nomenclature = [...existingNomenclature]; // рабочая копия (пополняется по ходу)
  const createdNomenclatures: Nomenclature[] = [];
  const items: InvoiceItem[] = [];
  let counter = 0;

  const filenameVehicleId = filename ? detectVehicleFromText(filename) : null;
  const globalVehicleId = (parsed.detectedVehicle ? detectVehicleFromText(parsed.detectedVehicle) : null) || filenameVehicleId;
  const detectedVehicles = parsed.items.map((it) => detectVehicleFromText(it.rawName));
  const uniqueDetected = Array.from(new Set(detectedVehicles.filter((v): v is string => v !== null)));
  const singleVehicleId = globalVehicleId || (uniqueDetected.length === 1 ? uniqueDetected[0]! : null);

  const matchOptions = { detectVehicle: detectVehicleFromText };

  const resolveNomenclatureId = (name: string): string | null => {
    const matches = findBestNomenclatureMatches(name, nomenclature, aliases, matchOptions);
    if (matches.length > 0 && matches[0]!.score > 0.6) return matches[0]!.nomenclatureId;

    const clean = name.trim();
    if (!clean) return null;
    const existing = nomenclature.find((n) => n.normalizedName.toLowerCase() === clean.toLowerCase() && !n.deletedAt);
    if (existing) return existing.id;

    const newNom: Nomenclature = {
      id: ids.generate('nom-auto'),
      normalizedName: clean,
      category: 'Запчасти из накладных',
      normativeServiceDays: 365,
      normativeLifespanText: '12 месяцев',
      notes: 'Автоматически сгружено из накладной',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    nomenclature.push(newNom);
    createdNomenclatures.push(newNom);
    return newNom.id;
  };

  const placementFor = (name: string, index: number, isGeneral: boolean, matchedNId: string | null): TruckPlacement | null => {
    if (isGeneral) return null;
    const matchedNomen = matchedNId ? nomenclature.find((n) => n.id === matchedNId) : null;
    let placement: TruckPlacement | null = matchedNomen?.truckPlacement ?? null;
    if (!placement || placement === 'none') {
      const detected =
        detectPlacementFromText(name, index) ||
        (parsed.detectedVehicle ? detectPlacementFromText(parsed.detectedVehicle, index) : null);
      if (detected) placement = detected;
    }
    return placement;
  };

  parsed.items.forEach((it, index) => {
    const qty = Number(it.quantity) || 1;
    const unitPrice = Number(it.unitPrice) || 0;
    const totalLineSum = Number(it.lineSum) || qty * unitPrice;

    if (qty > 1) {
      const splitNames = splitRawNameByQuantity(it.rawName || '', qty);
      for (let i = 0; i < qty; i++) {
        const splitName = splitNames[i] ?? (it.rawName || '');
        const matchedNId = resolveNomenclatureId(splitName);
        const isGeneral = GENERAL_EXPENSE_RE.test(splitName);
        const vehicleId = isGeneral ? null : detectVehicleFromText(splitName) || singleVehicleId;
        const placement = placementFor(splitName, index, isGeneral, matchedNId);
        items.push({
          id: ids.generate(`ii-${invoiceId}-${counter++}`),
          invoiceId,
          nomenclatureId: matchedNId,
          rawName: splitName,
          quantity: 1,
          unitPrice,
          lineSum: round2(totalLineSum / qty),
          matchedNomenclatureId: matchedNId,
          vehicleId,
          truckPlacement: placement,
        });
      }
    } else {
      const rawName = it.rawName || '';
      const matchedNId = resolveNomenclatureId(rawName);
      const isGeneral = GENERAL_EXPENSE_RE.test(rawName);
      const vehicleId = isGeneral ? null : detectedVehicles[index] || singleVehicleId;
      const placement = placementFor(rawName, index, isGeneral, matchedNId);
      items.push({
        id: ids.generate(`ii-${invoiceId}-${counter++}`),
        invoiceId,
        nomenclatureId: matchedNId,
        rawName,
        quantity: 1,
        unitPrice,
        lineSum: totalLineSum,
        matchedNomenclatureId: matchedNId,
        vehicleId,
        truckPlacement: placement,
      });
    }
  });

  return { items, createdNomenclatures };
}
