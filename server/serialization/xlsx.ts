import * as XLSX from 'xlsx';
import type { ExportTable } from '../services/exportService.js';

/**
 * Сериализация подготовленной ExportService.xlsxTable() в XLSX-буфер.
 * Тонкая граница сериализации поверх библиотеки `xlsx` (перенос XLSX.write из legacy /api/export).
 * Бизнес-логику ExportService не дублирует и не изменяет.
 */
export function serializeXlsx(table: ExportTable): Buffer {
  const aoa: (string | number)[][] = [table.header, ...table.rows];
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, table.sheetName);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
