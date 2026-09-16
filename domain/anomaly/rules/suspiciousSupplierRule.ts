import type { InvoiceItem } from '../../../shared/index.js';
import type { AnomalyContext, AnomalyFlagDraft, AnomalyRule } from '../types.js';

/**
 * Слот правила «подозрительный поставщик».
 * В исходном приложении тип suspicious_supplier объявлен, но НЕ реализован (см. KNOWN_ISSUES KI-1).
 * Чтобы не менять бизнес-результат, правило зарегистрировано, но всегда возвращает [].
 * Будущая логика (напр. supplier.isApproved=false) — только после отдельного согласования.
 */
export const suspiciousSupplierRule: AnomalyRule = {
  type: 'suspicious_supplier',
  evaluate(_item: InvoiceItem, _ctx: AnomalyContext): AnomalyFlagDraft[] {
    return [];
  },
};
