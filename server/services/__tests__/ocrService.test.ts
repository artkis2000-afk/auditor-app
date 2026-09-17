import { describe, it, expect } from 'vitest';
import type { Invoice, InvoiceItem, Nomenclature, Vehicle } from '../../../shared/index.js';
import { InMemoryGateway } from '../../repositories/__tests__/inMemoryGateway.js';
import { createServiceContext } from '../context.js';
import { OcrService } from '../ocrService.js';
import type { Actor } from '../invoiceService.js';
import {
  StubOcrProvider,
  ThrowingOcrProvider,
  DeterministicMockOcrProvider,
  PassthroughImagePreprocessor,
  OcrError,
  type ParsedInvoice,
} from '../../ai/index.js';
import { fixedClock, countingIds, TS } from './_helpers.js';

const actor: Actor = { id: 'u-admin', username: 'admin' };
const nomN1: Nomenclature = {
  id: 'N1',
  normalizedName: 'Фильтр масляный',
  category: '',
  normativeServiceDays: 180,
  notes: '',
  createdAt: TS,
  updatedAt: TS,
  deletedAt: null,
};
const vehVolvo: Vehicle = { id: 'v-volvo', name: 'Вольво 569', plate: 'А 569 ЕК 67' };

function invoiceDoc(p: Partial<Invoice> & { id: string; recognizedDate: string }): Invoice {
  return {
    imagePath: '',
    status: 'confirmed',
    uploadedBy: 'u-admin',
    supplierId: null,
    supplierName: null,
    rawSupplierName: null,
    totalSum: 0,
    isReconciled: false,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
    ...p,
  };
}
function itemDoc(p: Partial<InvoiceItem> & { id: string; invoiceId: string; unitPrice: number }): InvoiceItem {
  return { nomenclatureId: null, rawName: '', quantity: 1, lineSum: p.unitPrice, matchedNomenclatureId: null, ...p };
}

const IMG = 'data:image/jpeg;base64,AAAA';

function setup(seed: Record<string, Array<{ id: string } & Record<string, unknown>>> = {}) {
  const gw = new InMemoryGateway({ nomenclature: [nomN1], vehicles: [vehVolvo], ...seed });
  const ctx = createServiceContext(gw, { clock: fixedClock(), ids: countingIds() });
  return { gw, ctx };
}

function ocr(ctx: ReturnType<typeof setup>['ctx'], primary: StubOcrProvider | ThrowingOcrProvider | undefined, fallback = new DeterministicMockOcrProvider()) {
  return new OcrService(ctx, { primary, fallback, preprocessor: new PassthroughImagePreprocessor() });
}

describe('OcrService.processInvoice — успешное распознавание', () => {
  it('нормализует шапку, матчит/авто-создаёт номенклатуру, ставит машину, чистит imagePath, пишет audit', async () => {
    const { ctx } = setup({
      invoices: [invoiceDoc({ id: 'inv-x', recognizedDate: '2026-01-01', status: 'processing', imagePath: IMG })],
    });
    const parsed: ParsedInvoice = {
      recognizedDate: '2026-02-01',
      supplierName: 'ООО OCR',
      totalSum: 3650,
      detectedVehicle: 'V569',
      items: [
        { rawName: 'Фильтр масляный', quantity: 1, unitPrice: 1200, lineSum: 1200 },
        { rawName: 'Новая деталь XYZ', quantity: 1, unitPrice: 2450, lineSum: 2450 },
      ],
    };
    const svc = ocr(ctx, new StubOcrProvider(parsed));
    const res = await svc.processInvoice('inv-x', actor);

    expect(res.fallback).toBe(false);
    expect(res.itemsCount).toBe(2);

    const inv = await ctx.repositories.invoices.getById('inv-x');
    expect(inv!.recognizedDate).toBe('2026-02-01');
    expect(inv!.supplierName).toBe('ООО OCR');
    expect(inv!.totalSum).toBe(3650);
    expect(inv!.imagePath).toBe(''); // очищено
    expect(inv!.ocrFallback).toBe(false);

    const items = await ctx.repositories.invoiceItems.listByInvoice('inv-x');
    expect(items).toHaveLength(2);
    const filter = items.find((i) => i.rawName === 'Фильтр масляный')!;
    expect(filter.matchedNomenclatureId).toBe('N1'); // сопоставлено
    expect(filter.vehicleId).toBe('v-volvo'); // V569 → v-volvo
    const newItem = items.find((i) => i.rawName === 'Новая деталь XYZ')!;
    expect(newItem.matchedNomenclatureId).toMatch(/^nom-auto/); // авто-создано

    const noms = await ctx.repositories.nomenclature.getAll();
    expect(noms.some((n) => n.normalizedName === 'Новая деталь XYZ')).toBe(true);
    expect((await ctx.repositories.suppliers.getAll()).some((s) => s.name === 'ООО OCR')).toBe(true);

    const logs = await ctx.repositories.auditLogs.getAll();
    expect(logs.some((l) => l.action === 'invoice_ocr')).toBe(true);
  });

  it('сплит qty>1 → отдельные позиции с делённой суммой', async () => {
    const { ctx } = setup({
      invoices: [invoiceDoc({ id: 'inv-x', recognizedDate: '2026-01-01', status: 'processing', imagePath: IMG })],
    });
    const parsed: ParsedInvoice = {
      recognizedDate: '2026-02-01',
      supplierName: 'ООО OCR',
      totalSum: 300,
      detectedVehicle: 'V569',
      items: [{ rawName: 'Гайка', quantity: 3, unitPrice: 100, lineSum: 300 }],
    };
    await ocr(ctx, new StubOcrProvider(parsed)).processInvoice('inv-x', actor);
    const items = await ctx.repositories.invoiceItems.listByInvoice('inv-x');
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.lineSum === 100 && i.quantity === 1)).toBe(true);
  });

  it('«на все» → общий расход: vehicleId=null, placement=null', async () => {
    const { ctx } = setup({
      invoices: [invoiceDoc({ id: 'inv-x', recognizedDate: '2026-01-01', status: 'processing', imagePath: IMG })],
    });
    const parsed: ParsedInvoice = {
      recognizedDate: '2026-02-01',
      supplierName: 'ООО OCR',
      totalSum: 5000,
      detectedVehicle: 'V569',
      items: [{ rawName: 'Антифриз на все', quantity: 1, unitPrice: 5000, lineSum: 5000 }],
    };
    await ocr(ctx, new StubOcrProvider(parsed)).processInvoice('inv-x', actor);
    const items = await ctx.repositories.invoiceItems.listByInvoice('inv-x');
    expect(items[0]!.vehicleId ?? null).toBeNull();
    expect(items[0]!.truckPlacement ?? null).toBeNull();
  });
});

describe('OcrService.processInvoice — fallback', () => {
  it('primary бросает → используется fallback, ocrFallback=true, ocrError записан', async () => {
    const { ctx } = setup({
      invoices: [invoiceDoc({ id: 'inv-x', recognizedDate: '2026-01-01', status: 'processing', imagePath: IMG })],
    });
    const fb = new StubOcrProvider(
      { recognizedDate: '2026-03-01', supplierName: 'ООО Резерв', totalSum: 100, detectedVehicle: '', items: [{ rawName: 'Болт', quantity: 1, unitPrice: 100, lineSum: 100 }] },
      { fallback: true },
    );
    const svc = new OcrService(ctx, { primary: new ThrowingOcrProvider('gemini down'), fallback: fb, preprocessor: new PassthroughImagePreprocessor() });
    const res = await svc.processInvoice('inv-x', actor);
    expect(res.fallback).toBe(true);
    const inv = await ctx.repositories.invoices.getById('inv-x');
    expect(inv!.ocrFallback).toBe(true);
    expect(inv!.ocrError).toBe('gemini down');
    expect(inv!.supplierName).toBe('ООО Резерв');
  });

  it('нет primary → детерминированный демо-провайдер, ocrFallback=true', async () => {
    const { ctx } = setup({
      invoices: [invoiceDoc({ id: 'inv-x', recognizedDate: '2026-01-01', status: 'processing', imagePath: IMG })],
    });
    const svc = ocr(ctx, undefined, new DeterministicMockOcrProvider());
    const res = await svc.processInvoice('inv-x', actor);
    expect(res.fallback).toBe(true);
    const inv = await ctx.repositories.invoices.getById('inv-x');
    expect(inv!.ocrFallback).toBe(true);
    expect(inv!.supplierName).toBe('ООО АвтоСнаб');
  });
});

describe('OcrService.processInvoice — аномалии и ошибки', () => {
  it('распознанная накладная-дубликат → flagged', async () => {
    const { ctx } = setup({
      invoices: [
        invoiceDoc({ id: 'P', recognizedDate: '2026-01-01' }),
        invoiceDoc({ id: 'inv-x', recognizedDate: '2026-01-01', status: 'processing', imagePath: IMG }),
      ],
      invoiceItems: [itemDoc({ id: 'pi', invoiceId: 'P', matchedNomenclatureId: 'N1', vehicleId: 'v-volvo', unitPrice: 1000 })],
    });
    const parsed: ParsedInvoice = {
      recognizedDate: '2026-02-01',
      supplierName: 'ООО OCR',
      totalSum: 1000,
      detectedVehicle: 'V569',
      items: [{ rawName: 'Фильтр масляный', quantity: 1, unitPrice: 1000, lineSum: 1000 }],
    };
    const res = await ocr(ctx, new StubOcrProvider(parsed)).processInvoice('inv-x', actor);
    expect(res.status).toBe('flagged');
  });

  it('нет imagePath → OcrError', async () => {
    const { ctx } = setup({
      invoices: [invoiceDoc({ id: 'inv-x', recognizedDate: '2026-01-01', status: 'processing', imagePath: '' })],
    });
    await expect(ocr(ctx, new StubOcrProvider({ recognizedDate: '', supplierName: '', totalSum: 0, detectedVehicle: '', items: [] })).processInvoice('inv-x', actor)).rejects.toBeInstanceOf(OcrError);
  });
});
