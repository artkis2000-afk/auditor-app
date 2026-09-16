/**
 * Разбиение позиции с количеством > 1 на отдельные строки (по одной единице).
 * Дословный перенос splitRawNameByQuantity из исходного serverDb.ts. Поведение 1:1.
 *
 * Если в rawName есть распределение по узлам/машинам через «=» (напр. «V829=4 и 5»)
 * или мульти-машинные пометки вида «V652 = 1 (2 шт) и V967 = 1 (2 шт)» —
 * извлекает индивидуальные коды и присваивает по одному коду на единицу.
 */
export function splitRawNameByQuantity(rawName: string, quantity: number): string[] {
  if (quantity <= 1) {
    return [rawName];
  }

  // Все вхождения «машина/узел/количество».
  // Поддержка и цифр (V652, 12177), и транслитерированных названий.
  const allocationRegex =
    /(?:[1234567890]\s+)?(?:[vвvьвb][-_ ]*)?(\d{3,5}|volvo|scania|kamaz|man|mercedes|вольво|скания|камаз|ман|мерседес)\s*(?:=\s*(\d+\*?))?\s*(?:\(\s*(\d+)\s*(?:шт|шт\.|шт\.?)\s*\)|\(\s*(\d+)\s*\)|(\d+)\s*(?:шт|шт\.|шт\.?))/gi;

  let baseName = rawName;
  const allocations: Array<{ vehicle: string; placement?: string; qty: number }> = [];

  allocationRegex.lastIndex = 0;

  const matches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = allocationRegex.exec(rawName)) !== null) {
    matches.push(match);
  }

  if (matches.length > 0) {
    // Убираем совпадения из baseName, чтобы не повторять их в результате
    for (const m of matches) {
      baseName = baseName.replace(m[0], '');
    }
    // Чистим хвостовые разделители (запятые, «и», пробелы)
    baseName = baseName.replace(/[\s,и]+$/, '').trim();

    for (const m of matches) {
      const vehText = m[1]!;
      const placementText = m[2];
      const qtyText = m[3] || m[4] || m[5];
      const allocatedQty = qtyText ? parseInt(qtyText, 10) : 1;

      // Формируем код машины
      let fullVeh = vehText;
      if (
        !/^(volvo|scania|kamaz|man|mercedes|вольво|скания|камаз|ман|мерседес)/i.test(vehText) &&
        !/^v/i.test(vehText)
      ) {
        fullVeh = `V${vehText}`;
      }

      allocations.push({
        vehicle: fullVeh,
        placement: placementText,
        qty: allocatedQty,
      });
    }
  }

  // Если успешно разобрали аллокации — распределяем их
  if (allocations.length > 0) {
    const results: string[] = [];

    for (const alloc of allocations) {
      const allocationName = alloc.placement
        ? `${baseName} ${alloc.vehicle} = ${alloc.placement}`
        : `${baseName} ${alloc.vehicle}`;

      for (let i = 0; i < alloc.qty; i++) {
        if (results.length < quantity) {
          results.push(allocationName);
        }
      }
    }

    // Добиваем оставшиеся единицы, если сумма аллокаций меньше общего количества
    const lastAlloc = allocations[allocations.length - 1];
    const fallbackName = lastAlloc
      ? lastAlloc.placement
        ? `${baseName} ${lastAlloc.vehicle} = ${lastAlloc.placement}`
        : `${baseName} ${lastAlloc.vehicle}`
      : rawName;

    while (results.length < quantity) {
      results.push(fallbackName);
    }

    return results;
  }

  // Резерв: простое разбиение по «=», если regex не нашёл аллокаций, но есть знак равенства
  const eqIdx = rawName.indexOf('=');
  if (eqIdx !== -1) {
    const leftPart = rawName.substring(0, eqIdx).trim();
    const rightPart = rawName.substring(eqIdx + 1).trim();

    const tokens = rightPart.split(/[\s,и]+/).map((t) => t.trim()).filter(Boolean);
    const codes = tokens.filter((t) => /^\d+\*?$/.test(t));

    if (codes.length > 0) {
      const results: string[] = [];
      for (let i = 0; i < quantity; i++) {
        const code = codes[i] || codes[codes.length - 1] || '';
        if (code) {
          results.push(`${leftPart} = ${code}`);
        } else {
          results.push(rawName);
        }
      }
      return results;
    }
  }

  // Реплика имени, если ничего не подошло
  const results: string[] = [];
  for (let i = 0; i < quantity; i++) {
    results.push(rawName);
  }
  return results;
}
