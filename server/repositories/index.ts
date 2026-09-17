import type { FirestoreGateway } from '../db/firestoreGateway.js';
import {
  UserRepository,
  SupplierRepository,
  NomenclatureRepository,
  NomenclatureAliasRepository,
  InvoiceRepository,
  InvoiceItemRepository,
  AnomalyFlagRepository,
  AuditLogRepository,
  VehicleRepository,
  VehicleExclusionRepository,
} from './entityRepositories.js';
import { CredentialRepository } from './credentialRepository.js';
import { SettingsRepository } from './settingsRepository.js';

export * from './baseRepository.js';
export * from './entityRepositories.js';
export * from './credentialRepository.js';
export * from './settingsRepository.js';

/** Полный набор репозиториев поверх одного шлюза Firestore. */
export interface Repositories {
  users: UserRepository;
  credentials: CredentialRepository;
  suppliers: SupplierRepository;
  nomenclature: NomenclatureRepository;
  nomenclatureAliases: NomenclatureAliasRepository;
  invoices: InvoiceRepository;
  invoiceItems: InvoiceItemRepository;
  anomalyFlags: AnomalyFlagRepository;
  auditLogs: AuditLogRepository;
  vehicles: VehicleRepository;
  vehicleExclusions: VehicleExclusionRepository;
  settings: SettingsRepository;
}

export function createRepositories(gateway: FirestoreGateway): Repositories {
  return {
    users: new UserRepository(gateway),
    credentials: new CredentialRepository(gateway),
    suppliers: new SupplierRepository(gateway),
    nomenclature: new NomenclatureRepository(gateway),
    nomenclatureAliases: new NomenclatureAliasRepository(gateway),
    invoices: new InvoiceRepository(gateway),
    invoiceItems: new InvoiceItemRepository(gateway),
    anomalyFlags: new AnomalyFlagRepository(gateway),
    auditLogs: new AuditLogRepository(gateway),
    vehicles: new VehicleRepository(gateway),
    vehicleExclusions: new VehicleExclusionRepository(gateway),
    settings: new SettingsRepository(gateway),
  };
}
