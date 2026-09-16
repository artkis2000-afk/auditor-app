import { z } from 'zod';

/**
 * Перечисления системы. Zod-схема — единственный источник истины:
 * TypeScript-тип выводится через z.infer, значения доступны через `.enum`.
 */

// Роли пользователей (факт исходной системы: boss/admin → 'admin', закупщик → 'viewer')
export const userRoleSchema = z.enum(['admin', 'manager', 'viewer']);
export type UserRole = z.infer<typeof userRoleSchema>;
export const UserRoles = userRoleSchema.enum;

// Статусы накладной
export const invoiceStatusSchema = z.enum([
  'draft',
  'confirmed',
  'flagged',
  'archived',
  'processing',
]);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;
export const InvoiceStatuses = invoiceStatusSchema.enum;

// Типы аномалий (suspicious_supplier объявлен, но в исходной системе НЕ реализован — см. KNOWN_ISSUES.md)
export const anomalyFlagTypeSchema = z.enum([
  'duplicate_exceed',
  'price_anomaly',
  'suspicious_supplier',
]);
export type AnomalyFlagType = z.infer<typeof anomalyFlagTypeSchema>;
export const AnomalyFlagTypes = anomalyFlagTypeSchema.enum;

// Уровни серьёзности
export const anomalySeveritySchema = z.enum(['low', 'medium', 'high']);
export type AnomalySeverity = z.infer<typeof anomalySeveritySchema>;
export const AnomalySeverities = anomalySeveritySchema.enum;

// Размещение детали на тягаче/прицепе (узлы, оси, колёса)
export const truckPlacementSchema = z.enum([
  'cabin',
  'steering_left',
  'steering_right',
  'driving_left_outer',
  'driving_left_inner',
  'driving_right_outer',
  'driving_right_inner',
  'trailer_1_left',
  'trailer_1_right',
  'trailer_2_left',
  'trailer_2_right',
  'trailer_3_left',
  'trailer_3_right',
  'tractor_frame',
  'trailer_body',
  'axle_3_trailer',
  'axle_2_trailer',
  'axle_1_trailer',
  'axle_driving',
  'axle_steering',
  'none',
]);
export type TruckPlacement = z.infer<typeof truckPlacementSchema>;
export const TruckPlacements = truckPlacementSchema.enum;
