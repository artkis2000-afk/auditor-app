/**
 * Фронтенд переиспользует shared DTO backend'а (type-only импорты стираются при сборке —
 * рантайм-зависимость от zod/shared не тянется). Вторые копии моделей не создаём.
 */
export type { AuthUser } from '@shared/dto/auth.js';

export type {
  DashboardStats,
  DashboardPeriodQuery,
  DashboardChartPoint,
  DashboardPiePoint,
  DashboardTopPart,
  DashboardRecentAnomaly,
  DashboardSupplierPurchase,
} from '@shared/dto/dashboard.js';

export type {
  InvoiceListEntry,
  InvoiceListItemRef,
  InvoiceDetail,
  InvoiceDetailItem,
  NomenclatureSuggestion,
  InvoicesListQuery,
} from '@shared/dto/invoice.js';

export type { Invoice, InvoiceItem, AnomalyFlag, Vehicle } from '@shared/schemas/index.js';

export type {
  UserRole,
  InvoiceStatus,
  AnomalyFlagType,
  AnomalySeverity,
  TruckPlacement,
} from '@shared/enums/index.js';
