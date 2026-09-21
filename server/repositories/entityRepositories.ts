import type { FirestoreGateway } from '../db/firestoreGateway.js';
import {
  userSchema,
  supplierSchema,
  nomenclatureSchema,
  nomenclatureAliasSchema,
  invoiceSchema,
  invoiceItemSchema,
  anomalyFlagSchema,
  auditLogSchema,
  vehicleSchema,
  vehicleExclusionSchema,
  type User,
  type Supplier,
  type Nomenclature,
  type NomenclatureAlias,
  type Invoice,
  type InvoiceItem,
  type AnomalyFlag,
  type AuditLog,
  type Vehicle,
  type VehicleExclusion,
} from '../../shared/index.js';
import { FirestoreRepository } from './baseRepository.js';

export class UserRepository extends FirestoreRepository<User> {
  constructor(gateway: FirestoreGateway) {
    super(gateway, 'users', userSchema);
  }
  // docId == Firebase UID → getById(uid) достаточно (PHASE 5.1).
}

export class SupplierRepository extends FirestoreRepository<Supplier> {
  constructor(gateway: FirestoreGateway) {
    super(gateway, 'suppliers', supplierSchema);
  }
  async listActive(): Promise<Supplier[]> {
    return (await this.getAll()).filter((s) => !s.deletedAt);
  }
  async findByInn(inn: string): Promise<Supplier | null> {
    return (await this.listActive()).find((s) => s.inn === inn) ?? null;
  }
}

export class NomenclatureRepository extends FirestoreRepository<Nomenclature> {
  constructor(gateway: FirestoreGateway) {
    super(gateway, 'nomenclature', nomenclatureSchema);
  }
  async listActive(): Promise<Nomenclature[]> {
    return (await this.getAll()).filter((n) => !n.deletedAt);
  }
}

export class NomenclatureAliasRepository extends FirestoreRepository<NomenclatureAlias> {
  constructor(gateway: FirestoreGateway) {
    super(gateway, 'nomenclatureAliases', nomenclatureAliasSchema);
  }
  async listByNomenclature(nomenclatureId: string): Promise<NomenclatureAlias[]> {
    return (await this.getAll()).filter((a) => a.nomenclatureId === nomenclatureId);
  }
}

export class InvoiceRepository extends FirestoreRepository<Invoice> {
  constructor(gateway: FirestoreGateway) {
    super(gateway, 'invoices', invoiceSchema);
  }
  async listActive(): Promise<Invoice[]> {
    return (await this.getAll()).filter((i) => !i.deletedAt);
  }
}

export class InvoiceItemRepository extends FirestoreRepository<InvoiceItem> {
  constructor(gateway: FirestoreGateway) {
    super(gateway, 'invoiceItems', invoiceItemSchema);
  }
  async listByInvoice(invoiceId: string): Promise<InvoiceItem[]> {
    return (await this.getAll()).filter((it) => it.invoiceId === invoiceId);
  }
}

export class AnomalyFlagRepository extends FirestoreRepository<AnomalyFlag> {
  constructor(gateway: FirestoreGateway) {
    super(gateway, 'anomalyFlags', anomalyFlagSchema);
  }
  async listByInvoice(invoiceId: string): Promise<AnomalyFlag[]> {
    return (await this.getAll()).filter((f) => f.invoiceId === invoiceId);
  }
}

export class AuditLogRepository extends FirestoreRepository<AuditLog> {
  constructor(gateway: FirestoreGateway) {
    super(gateway, 'auditLogs', auditLogSchema);
  }
}

export class VehicleRepository extends FirestoreRepository<Vehicle> {
  constructor(gateway: FirestoreGateway) {
    super(gateway, 'vehicles', vehicleSchema);
  }
}

export class VehicleExclusionRepository extends FirestoreRepository<VehicleExclusion> {
  constructor(gateway: FirestoreGateway) {
    super(gateway, 'vehicleExclusions', vehicleExclusionSchema);
  }
}
