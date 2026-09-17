import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { serializeXlsx } from '../xlsx.js';
import type { ExportTable } from '../../services/exportService.js';

describe('serializeXlsx', () => {
  it('сериализует таблицу в XLSX-буфер, читаемый обратно', () => {
    const table: ExportTable = {
      sheetName: 'Аудит закупок',
      header: ['Номер накладной', 'Дата', 'Сумма'],
      rows: [
        ['inv-1', '2026-02-01', 1000],
        ['inv-2', '2026-03-01', 2000],
      ],
    };
    const buffer = serializeXlsx(table);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);

    // round-trip: читаем обратно и проверяем содержимое
    const wb = XLSX.read(buffer, { type: 'buffer' });
    expect(wb.SheetNames).toContain('Аудит закупок');
    const ws = wb.Sheets['Аудит закупок']!;
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
    expect(aoa[0]).toEqual(['Номер накладной', 'Дата', 'Сумма']);
    expect(aoa[1]).toEqual(['inv-1', '2026-02-01', 1000]);
    expect(aoa[2]).toEqual(['inv-2', '2026-03-01', 2000]);
  });
});
