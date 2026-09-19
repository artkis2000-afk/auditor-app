/**
 * Фронтенд переиспользует shared DTO backend'а (type-only импорты стираются при сборке —
 * рантайм-зависимость от zod/shared не тянется). Вторые копии моделей не создаём.
 */
export type {
  AuthUser,
  LoginRequest,
  LoginResponse,
} from '@shared/dto/auth.js';

export type {
  DashboardStats,
  DashboardPeriodQuery,
  DashboardChartPoint,
  DashboardPiePoint,
  DashboardTopPart,
  DashboardRecentAnomaly,
  DashboardSupplierPurchase,
} from '@shared/dto/dashboard.js';

export type { UserRole, InvoiceStatus } from '@shared/enums/index.js';
