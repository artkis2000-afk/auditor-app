import type { AnomalyRule } from '../types.js';
import { duplicatePurchaseRule } from './duplicatePurchaseRule.js';
import { supplierPriceRule } from './supplierPriceRule.js';
import { marketPriceRule } from './marketPriceRule.js';
import { suspiciousSupplierRule } from './suspiciousSupplierRule.js';

export { duplicatePurchaseRule, supplierPriceRule, marketPriceRule, suspiciousSupplierRule };

/**
 * Порядок правил соответствует исходному detector: сначала дубликат (A),
 * затем цена у поставщика (B1), затем рыночная цена (B2). Слот suspicious — в конце (no-op).
 * Порядок важен: он определяет порядок флагов в результате.
 */
export const defaultRules: AnomalyRule[] = [
  duplicatePurchaseRule,
  supplierPriceRule,
  marketPriceRule,
  suspiciousSupplierRule,
];
