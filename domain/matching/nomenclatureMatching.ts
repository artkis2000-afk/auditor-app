import type { Nomenclature, NomenclatureAlias } from '../../shared/index.js';
import { getStringSimilarity } from './textSimilarity.js';
import { areOpposingParts } from './opposingParts.js';

/**
 * Сопоставление позиции накладной со справочником номенклатуры.
 * Дословный перенос findBestNomenclatureMatches из исходного serverDb.ts.
 *
 * Отличие только в архитектурном шве: определение автомобиля (для vehicle-boost)
 * передаётся инъекцией `options.detectVehicle`, а не импортируется напрямую из placement.
 * Бизнес-формула (+0.20 / −0.40, clamp 0..1, top-3) сохранена без изменений.
 */

// Минимальный набор полей номенклатуры, нужный для сопоставления
export type NomenclatureMatchInput = Pick<
  Nomenclature,
  'id' | 'normalizedName' | 'vehicleId' | 'deletedAt'
>;
export type AliasMatchInput = Pick<NomenclatureAlias, 'nomenclatureId' | 'aliasName'>;

export interface NomenclatureMatch {
  nomenclatureId: string;
  name: string;
  score: number;
}

export interface NomenclatureMatchOptions {
  /**
   * Инъекция определения автомобиля по тексту (реальная реализация — из domain/placement).
   * Если не передана — vehicle-boost не применяется (эквивалентно случаю, когда
   * detectVehicleFromText вернул null). На реальных call-site будет передана настоящая функция.
   */
  detectVehicle?: (text: string) => string | null;
}

export function findBestNomenclatureMatches(
  rawName: string,
  nomenclature: NomenclatureMatchInput[],
  aliases: AliasMatchInput[],
  options: NomenclatureMatchOptions = {},
): NomenclatureMatch[] {
  const matches: NomenclatureMatch[] = [];
  const detectedVehicleId = options.detectVehicle ? options.detectVehicle(rawName) : null;

  for (const item of nomenclature) {
    if (item.deletedAt) continue;

    // Пропускаем, если это противоположные детали (лев/прав, перед/зад и т.д.)
    if (areOpposingParts(rawName, item.normalizedName)) {
      continue;
    }

    // Основное имя
    const mainScore = getStringSimilarity(rawName, item.normalizedName);
    let maxScore = mainScore;

    // Алиасы
    const itemAliases = aliases.filter((a) => a.nomenclatureId === item.id);
    for (const alias of itemAliases) {
      if (areOpposingParts(rawName, alias.aliasName)) {
        continue;
      }
      const aliasScore = getStringSimilarity(rawName, alias.aliasName);
      if (aliasScore > maxScore) {
        maxScore = aliasScore;
      }
    }

    // Подстрочное вхождение в любую сторону → минимум 0.75
    if (
      rawName.toLowerCase().includes(item.normalizedName.toLowerCase()) ||
      item.normalizedName.toLowerCase().includes(rawName.toLowerCase())
    ) {
      maxScore = Math.max(maxScore, 0.75);
    }

    // Vehicle-boost по определённому автомобилю (рукописные пометки «V...»)
    let vehicleBoost = 0;
    if (detectedVehicleId) {
      if (item.vehicleId === detectedVehicleId) {
        vehicleBoost = 0.2; // усиливаем совпадения нужной машины
      } else if (item.vehicleId && item.vehicleId !== detectedVehicleId) {
        vehicleBoost = -0.4; // сильно штрафуем другие машины
      }
    }

    const finalScore = Math.min(1.0, Math.max(0.0, maxScore + vehicleBoost));

    matches.push({
      nomenclatureId: item.id,
      name: item.normalizedName,
      score: finalScore,
    });
  }

  // Сортировка по убыванию и топ-3
  return matches.sort((a, b) => b.score - a.score).slice(0, 3);
}
