import type { ServiceContext } from './context.js';

/**
 * Экспорт аудита закупок (перенос GET /api/export, /api/export-csv).
 * Здесь — подготовка данных и CSV-сериализация (без внешних зависимостей).
 * XLSX-сериализация требует отдельной зависимости `xlsx` (в проекте её нет) — НЕ добавляется молча:
 * метод xlsxTable() отдаёт готовые строки (aoa), сериализацию XLSX подключим отдельным решением (PHASE 4.7b).
 */
export interface ExportTable {
  sheetName: string;
  header: string[];
  rows: (string | number)[][];
}

interface ExportEntry {
  invoiceId: string;
  date: string;
  supplierName: string;
  rawName: string;
  nomName: string;
  quantity: number;
  unitPrice: number;
  lineSum: number;
  flagsStr: string;
}

function flagLabel(flagType: string): string {
  if (flagType === 'price_anomaly') return 'Цена';
  if (flagType === 'duplicate_exceed') return 'Дубликат';
  return 'Поставщик';
}

export class ExportService {
  constructor(private readonly ctx: ServiceContext) {}

  private async collect(): Promise<ExportEntry[]> {
    const [invoices, suppliers, nomenclature, items, flags] = await Promise.all([
      this.ctx.repositories.invoices.getAll(),
      this.ctx.repositories.suppliers.getAll(),
      this.ctx.repositories.nomenclature.getAll(),
      this.ctx.repositories.invoiceItems.getAll(),
      this.ctx.repositories.anomalyFlags.getAll(),
    ]);

    const exportable = invoices.filter((i) => !i.deletedAt && i.status !== 'draft');
    const entries: ExportEntry[] = [];

    for (const inv of exportable) {
      const supplier = suppliers.find((s) => s.id === inv.supplierId);
      const supplierName = supplier ? supplier.name : inv.supplierName || inv.rawSupplierName || 'Не распознан';
      const invItems = items.filter((it) => it.invoiceId === inv.id);
      for (const item of invItems) {
        const nom = nomenclature.find((n) => n.id === item.matchedNomenclatureId);
        const nomName = nom ? nom.normalizedName : '(Не привязано)';
        const itemFlags = flags.filter((af) => af.invoiceItemId === item.id);
        const flagsStr =
          itemFlags.map((af) => `[${flagLabel(af.flagType)}: ${af.details}]`).join(' | ') || 'Нет';
        entries.push({
          invoiceId: inv.id,
          date: inv.recognizedDate,
          supplierName,
          rawName: item.rawName,
          nomName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineSum: item.lineSum,
          flagsStr,
        });
      }
    }
    return entries;
  }

  /** Таблица для XLSX (aoa). Сериализацию выполняет отдельный слой (нужна зависимость `xlsx`). */
  async xlsxTable(): Promise<ExportTable> {
    const entries = await this.collect();
    const header = ['Номер накладной', 'Дата', 'Поставщик', 'Деталь (Справочник)', 'Количество', 'Цена', 'Сумма', 'Аномалии'];
    const rows = entries.map((e) => [e.invoiceId, e.date, e.supplierName, e.nomName, e.quantity, e.unitPrice, e.lineSum, e.flagsStr]);
    return { sheetName: 'Аудит закупок', header, rows };
  }

  /** CSV с UTF-8 BOM (перенос /api/export-csv). Готовая строка — без внешних зависимостей. */
  async exportCsv(): Promise<string> {
    const entries = await this.collect();
    const header = [
      'Номер накладной',
      'Дата',
      'Поставщик',
      'Деталь (из накладной)',
      'Деталь (Справочник)',
      'Количество',
      'Цена',
      'Сумма',
      'Аномалии',
    ];
    const quote = (field: string) => `"${field.replace(/"/g, '""')}"`;
    const lines = [header.map(quote).join(',')];
    for (const e of entries) {
      lines.push(
        [e.invoiceId, e.date, e.supplierName, e.rawName, e.nomName, String(e.quantity), String(e.unitPrice), String(e.lineSum), e.flagsStr]
          .map((f) => quote(f || ''))
          .join(','),
      );
    }
    return '﻿' + lines.join('\r\n');
  }
}
