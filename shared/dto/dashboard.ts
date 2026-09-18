import { z } from 'zod';
import type { AnomalyFlagType, AnomalySeverity } from '../enums/index.js';

/** Параметры периода для дашборда (query из GET /api/dashboard/stats). Числа — coerce из строк query. */
export const dashboardPeriodQuerySchema = z.object({
  periodType: z.enum(['all', 'year', 'quarter', 'month', 'custom']).optional(),
  selectedYear: z.coerce.number().int().optional(),
  selectedQuarter: z.coerce.number().int().optional(),
  selectedMonth: z.coerce.number().int().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
export type DashboardPeriodQuery = z.infer<typeof dashboardPeriodQuerySchema>;

export interface DashboardChartPoint {
  month: string;
  'Всего накладных': number;
  'Выявлено аномалий': number;
}

export interface DashboardPiePoint {
  name: string;
  value: number;
  color: string;
}

export interface DashboardTopPart {
  name: string;
  count: number;
}

export interface DashboardRecentAnomaly {
  id: string;
  invoiceId: string;
  relatedInvoiceId?: string;
  date: string;
  supplierName: string;
  flagType: AnomalyFlagType;
  details: string;
  severity: AnomalySeverity;
  isResolved: boolean;
  rawName: string;
}

export interface DashboardSupplierPurchase {
  name: string;
  total: number;
}

/** Полный ответ GET /api/dashboard/stats. */
export interface DashboardStats {
  totalInvoicesCount: number;
  flaggedInvoicesCount: number;
  flaggedPercentage: number;
  potentialSavings: number;
  chartData: DashboardChartPoint[];
  pieData: DashboardPiePoint[];
  topPartsData: DashboardTopPart[];
  recentAnomalies: DashboardRecentAnomaly[];
  supplierPurchases: DashboardSupplierPurchase[];
}
