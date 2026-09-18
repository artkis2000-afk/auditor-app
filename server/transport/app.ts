import express, { type Express } from 'express';
import './types.js'; // расширение Express.Request (principal)
import type { AppDeps } from './deps.js';
import { errorHandler } from './errors.js';
import { createHealthRouter } from './routes/healthRoutes.js';
import { createAuthRouter } from './routes/authRoutes.js';
import { createInvoiceRouter } from './routes/invoiceRoutes.js';
import { createSupplierRouter } from './routes/supplierRoutes.js';
import { createNomenclatureRouter } from './routes/nomenclatureRoutes.js';
import { createVehicleRouter, createVehicleExclusionsRouter } from './routes/vehicleRoutes.js';
import { createWarehouseRouter } from './routes/warehouseRoutes.js';
import { createInvoiceItemRouter } from './routes/invoiceItemRoutes.js';
import { createDashboardRouter } from './routes/dashboardRoutes.js';
import { createSettingsRouter } from './routes/settingsRoutes.js';
import { createAuditRouter } from './routes/auditRoutes.js';

/**
 * Фабрика Express-приложения (DI). Цепочка: request → validation → auth → authorization → service → response.
 * Routes не импортируют firebase-admin и не работают с repositories напрямую.
 */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: '10mb' })); // как в legacy (base64-изображения)

  app.use('/api', createHealthRouter());
  app.use('/api/auth', createAuthRouter(deps));
  app.use('/api/invoices', createInvoiceRouter(deps));
  app.use('/api/suppliers', createSupplierRouter(deps));
  app.use('/api/nomenclature', createNomenclatureRouter(deps));
  app.use('/api/vehicles', createVehicleRouter(deps));
  app.use('/api/vehicle-exclusions', createVehicleExclusionsRouter(deps));
  app.use('/api/warehouse', createWarehouseRouter(deps));
  app.use('/api/invoice-items', createInvoiceItemRouter(deps));
  app.use('/api/dashboard', createDashboardRouter(deps));
  app.use('/api/settings', createSettingsRouter(deps));
  app.use('/api/audit-logs', createAuditRouter(deps));

  // Центральный обработчик ошибок — последним
  app.use(errorHandler());
  return app;
}
