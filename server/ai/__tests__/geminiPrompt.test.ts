import { describe, it, expect } from 'vitest';
import { INVOICE_OCR_PROMPT, INVOICE_OCR_RESPONSE_SCHEMA } from '../geminiPrompt.js';

/**
 * Regression-гвард на семантику unitPrice/lineSum (KI-30). Проверяет только instruction-слой
 * (prompt + responseSchema), без реальных вызовов Gemini. Схема ParsedInvoice/провайдер не трогаются.
 */
describe('INVOICE_OCR_PROMPT — семантика unitPrice/lineSum (KI-30)', () => {
  it('unitPrice = «Цена» (брутто, до скидки), без вычисления из lineSum/quantity', () => {
    expect(INVOICE_OCR_PROMPT).toContain('ЦЕНА ЗА ЕДИНИЦУ ДО СКИДКИ');
    expect(INVOICE_OCR_PROMPT).toContain('колонки «Цена»');
    expect(INVOICE_OCR_PROMPT).toContain('НЕ вычисляй unitPrice как lineSum / quantity');
  });

  it('lineSum = «Сумма» (нетто, после скидки), не «Сумма без скидки»', () => {
    expect(INVOICE_OCR_PROMPT).toContain('ИТОГОВАЯ СУММА СТРОКИ ПОСЛЕ СКИДКИ');
    expect(INVOICE_OCR_PROMPT).toContain('колонки «Сумма»');
    expect(INVOICE_OCR_PROMPT).toContain('НЕ из колонки «Сумма без скидки»');
  });

  it('явно допускает unitPrice × quantity > lineSum при скидке (не «исправлять»)', () => {
    expect(INVOICE_OCR_PROMPT).toContain('может быть БОЛЬШЕ lineSum');
  });
});

describe('INVOICE_OCR_RESPONSE_SCHEMA — описания полей закрепляют брутто/нетто', () => {
  const itemProps = INVOICE_OCR_RESPONSE_SCHEMA.properties.items.items.properties;

  it('unitPrice описан как брутто из колонки «Цена»', () => {
    expect(itemProps.unitPrice.description).toContain('брутто');
    expect(itemProps.unitPrice.description).toContain('«Цена»');
  });

  it('lineSum описан как нетто из колонки «Сумма»', () => {
    expect(itemProps.lineSum.description).toContain('нетто');
    expect(itemProps.lineSum.description).toContain('«Сумма»');
  });
});
