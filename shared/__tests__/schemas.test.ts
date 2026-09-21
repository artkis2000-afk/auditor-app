import { describe, it, expect } from 'vitest';
import {
  userSchema,
  supplierSchema,
  nomenclatureSchema,
  nomenclatureAliasSchema,
  invoiceSchema,
  invoiceItemSchema,
  anomalyFlagSchema,
  vehicleSchema,
  vehicleExclusionSchema,
  auditLogSchema,
  systemSettingsSchema,
  invoiceStatusSchema,
  anomalyFlagTypeSchema,
  manualInvoiceRequestSchema,
  warehouseAllocateRequestSchema,
  vehicleExclusionToggleRequestSchema,
} from '../index.js';

describe('enums', () => {
  it('invoiceStatus принимает реальные статусы и отвергает чужие (напр. blueprint "verified")', () => {
    expect(invoiceStatusSchema.parse('processing')).toBe('processing');
    expect(invoiceStatusSchema.parse('flagged')).toBe('flagged');
    expect(() => invoiceStatusSchema.parse('verified')).toThrow();
  });

  it('anomalyFlagType соответствует фактическим типам исходной системы', () => {
    expect(anomalyFlagTypeSchema.parse('duplicate_exceed')).toBe('duplicate_exceed');
    expect(anomalyFlagTypeSchema.parse('price_anomaly')).toBe('price_anomaly');
    expect(anomalyFlagTypeSchema.parse('suspicious_supplier')).toBe('suspicious_supplier');
    expect(() => anomalyFlagTypeSchema.parse('price_deviation')).toThrow();
  });
});

describe('entity schemas — совместимость с реальными документами', () => {
  it('user (профиль Firebase: uid + переходная роль; новые поля → дефолты)', () => {
    const u = userSchema.parse({
      id: 'uid-owner',
      username: 'owner@example.com',
      fullName: 'Киселев Денис Васильевич',
      role: 'admin',
      isActive: true,
      createdAt: '2026-06-01T12:00:00.000Z',
    });
    expect(u.role).toBe('admin');
    expect(u.email).toBeNull();
    expect(u.displayName).toBeNull();
    expect(u.photoURL).toBeNull();
  });

  it('supplier подставляет дефолты для отсутствующих необязательных полей', () => {
    const s = supplierSchema.parse({
      id: 's-1',
      name: 'ООО "АвтоДетали"',
      inn: '7712345678',
      createdAt: '2026-06-01T12:00:00.000Z',
      updatedAt: '2026-06-01T12:00:00.000Z',
    });
    expect(s.legalAddress).toBe('');
    expect(s.isApproved).toBe(true);
    expect(s.deletedAt).toBeNull();
  });

  it('nomenclature (сид n-1) + normativeServiceDays', () => {
    const n = nomenclatureSchema.parse({
      id: 'n-1',
      normalizedName: 'Фильтр масляный Volvo',
      category: 'Фильтры',
      normativeServiceDays: 180,
      normativeLifespanText: '6 месяцев / 45 000 км',
      notes: 'x',
      createdAt: '2026-06-01T12:00:00.000Z',
      updatedAt: '2026-06-01T12:00:00.000Z',
      deletedAt: null,
    });
    expect(n.normativeServiceDays).toBe(180);
  });

  it('nomenclatureAlias', () => {
    expect(
      nomenclatureAliasSchema.parse({ id: 'na-1', nomenclatureId: 'n-1', aliasName: 'Фильтр масляный' }),
    ).toBeTruthy();
  });

  it('invoice минимальный', () => {
    const inv = invoiceSchema.parse({
      id: 'inv-1',
      recognizedDate: '2026-07-20',
      status: 'confirmed',
      uploadedBy: 'u-admin',
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
    });
    expect(inv.supplierId).toBeNull();
    expect(inv.totalSum).toBe(0);
    expect(inv.isReconciled).toBe(false);
    expect(inv.imagePath).toBe('');
  });

  it('invoiceItem: старый документ БЕЗ денорм-полей парсится (обратная совместимость)', () => {
    const legacy = invoiceItemSchema.parse({
      id: 'ii-1',
      invoiceId: 'inv-1',
      rawName: 'Фильтр масляный V569 = 1',
      quantity: 1,
      unitPrice: 1200,
      lineSum: 1200,
    });
    expect(legacy.matchedNomenclatureId).toBeNull();
    expect(legacy.invoiceDate).toBeUndefined();
  });

  it('invoiceItem: новый документ С денорм-полями', () => {
    const modern = invoiceItemSchema.parse({
      id: 'ii-2',
      invoiceId: 'inv-1',
      matchedNomenclatureId: 'n-1',
      rawName: 'Фильтр масляный',
      quantity: 1,
      unitPrice: 1200,
      lineSum: 1200,
      vehicleId: 'v-volvo',
      truckPlacement: 'none',
      invoiceDate: '2026-07-20',
      invoiceStatus: 'confirmed',
      supplierId: 's-1',
      supplierName: 'ООО "АвтоДетали"',
    });
    expect(modern.invoiceStatus).toBe('confirmed');
  });

  it('anomalyFlag', () => {
    const f = anomalyFlagSchema.parse({
      id: 'af-1',
      invoiceItemId: 'ii-1',
      invoiceId: 'inv-1',
      flagType: 'duplicate_exceed',
      details: 'повтор',
      severity: 'high',
      createdAt: '2026-07-20T00:00:00.000Z',
    });
    expect(f.isResolved).toBe(false);
    expect(f.resolvedBy).toBeNull();
  });

  it('vehicle (реальная запись автопарка)', () => {
    const v = vehicleSchema.parse({
      id: 'v-volvo',
      name: 'Вольво 569',
      plate: 'А 569 ЕК 67',
      trailerPlate: 'АК 0049 67',
      stsTractor: '4454 887587',
      stsTrailer: '9904 056690',
      designation: 'V569',
    });
    expect(v.designation).toBe('V569');
  });

  it('vehicleExclusion: месяц вне 1..12 отвергается', () => {
    expect(
      vehicleExclusionSchema.parse({ id: 'ex-1', vehicleId: 'v-volvo', year: 2026, month: 7, createdAt: 'x' }),
    ).toBeTruthy();
    expect(() =>
      vehicleExclusionSchema.parse({ id: 'ex-2', vehicleId: 'v-volvo', year: 2026, month: 13, createdAt: 'x' }),
    ).toThrow();
  });

  it('auditLog допускает произвольные old/new снимки', () => {
    const l = auditLogSchema.parse({
      id: 'al-1',
      userId: 'u-admin',
      username: 'admin',
      action: 'invoice_edit',
      entityType: 'invoice',
      entityId: 'inv-1',
      oldValues: { status: 'draft', items: [] },
      newValues: null,
      timestamp: '2026-07-20T00:00:00.000Z',
    });
    expect(l.action).toBe('invoice_edit');
  });

  it('systemSettings подставляет дефолты (10 / 180 / gemini)', () => {
    const s = systemSettingsSchema.parse({});
    expect(s.anomalyThreshold).toBe(10);
    expect(s.duplicateDays).toBe(180);
    expect(s.aiOcrEngine).toBe('gemini');
  });
});

describe('DTO валидация', () => {
  it('manualInvoice: coerce строковых чисел из формы', () => {
    const r = manualInvoiceRequestSchema.parse({
      supplierName: 'ООО Тест',
      items: [{ rawName: 'Фильтр', quantity: '2', unitPrice: '1200' }],
    });
    expect(r.items[0]!.quantity).toBe(2);
    expect(r.items[0]!.unitPrice).toBe(1200);
  });

  it('warehouseAllocate: неположительное количество отвергается', () => {
    expect(() =>
      warehouseAllocateRequestSchema.parse({ itemId: 'ii-1', targetVehicleId: 'v-volvo', allocateQuantity: 0 }),
    ).toThrow();
  });

  it('vehicleExclusionToggle: месяц валидируется', () => {
    expect(
      vehicleExclusionToggleRequestSchema.parse({ vehicleId: 'v-volvo', year: 2026, month: 7, excluded: true }),
    ).toBeTruthy();
    expect(() =>
      vehicleExclusionToggleRequestSchema.parse({ vehicleId: 'v-volvo', year: 2026, month: 0, excluded: true }),
    ).toThrow();
  });
});
