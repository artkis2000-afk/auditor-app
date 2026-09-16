import type { Supplier } from '../../shared/index.js';
import { getStringSimilarity } from './textSimilarity.js';

/**
 * Сопоставление распознанного названия поставщика со справочником.
 * Дословный перенос findBestSupplierMatches из исходного serverDb.ts.
 * Учитывает очистку организационно-правовых форм (ООО/ИП/ЗАО/…) и подстрочное вхождение.
 */

export type SupplierMatchInput = Pick<Supplier, 'id' | 'name' | 'deletedAt'>;

export interface SupplierMatch {
  supplierId: string;
  name: string;
  score: number;
}

const LEGAL_FORM_REGEX = /(ooo|ип|ооо|зао|пао|ао|гк|компания|company|limited|ltd|")/gi;

export function findBestSupplierMatches(
  rawName: string,
  suppliers: SupplierMatchInput[],
): SupplierMatch[] {
  const matches: SupplierMatch[] = [];

  const cleanRaw = rawName.toLowerCase().trim().replace(LEGAL_FORM_REGEX, '').trim();

  for (const sup of suppliers) {
    if (sup.deletedAt) continue;

    const cleanSup = sup.name.toLowerCase().trim().replace(LEGAL_FORM_REGEX, '').trim();

    // 1. Прямая схожесть исходных названий
    const directScore = getStringSimilarity(rawName, sup.name);

    // 2. Схожесть очищенных названий (без ООО, ИП и т.п.)
    const cleanScore = getStringSimilarity(cleanRaw, cleanSup);

    // 3. Подстрочное вхождение
    let substringScore = 0;
    if (cleanRaw.length > 2 && cleanSup.length > 2) {
      if (cleanSup.includes(cleanRaw) || cleanRaw.includes(cleanSup)) {
        substringScore = 0.75;
      }
    }

    const finalScore = Math.max(directScore, cleanScore, substringScore);

    matches.push({
      supplierId: sup.id,
      name: sup.name,
      score: finalScore,
    });
  }

  // Сортировка по убыванию и топ-5
  return matches.sort((a, b) => b.score - a.score).slice(0, 5);
}
