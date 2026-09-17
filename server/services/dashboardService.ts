import type { Invoice } from '../../shared/index.js';
import type {
  DashboardPeriodQuery,
  DashboardStats,
  DashboardChartPoint,
  DashboardRecentAnomaly,
} from '../../shared/index.js';
import { computePotentialSavings } from '../../domain/finance/index.js';
import type { ServiceContext } from './context.js';

const MONTHS_RU = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

/**
 * Агрегации дашборда (перенос GET /api/dashboard/stats).
 * Переиспользует finance-домен (computePotentialSavings); остальные агрегации специфичны для дашборда.
 */
export class DashboardService {
  constructor(private readonly ctx: ServiceContext) {}

  async getStats(query: DashboardPeriodQuery = {}): Promise<DashboardStats> {
    const [invoices, items, flags, suppliers, nomenclature] = await Promise.all([
      this.ctx.repositories.invoices.getAll(),
      this.ctx.repositories.invoiceItems.getAll(),
      this.ctx.repositories.anomalyFlags.getAll(),
      this.ctx.repositories.suppliers.getAll(),
      this.ctx.repositories.nomenclature.getAll(),
    ]);

    const activeInvoices = invoices.filter((i) => !i.deletedAt);
    const activeSuppliers = suppliers.filter((s) => !s.deletedAt);
    const activeNomenclature = nomenclature.filter((n) => !n.deletedAt);

    const filteredInvoices = this.filterByPeriod(activeInvoices, query);

    const totalInvoicesCount = filteredInvoices.length;
    const flaggedInvoicesCount = filteredInvoices.filter((i) => i.status === 'flagged').length;
    const flaggedPercentage =
      totalInvoicesCount > 0 ? Math.round((flaggedInvoicesCount / totalInvoicesCount) * 100) : 0;

    const filteredIds = new Set(filteredInvoices.map((i) => i.id));
    const filteredFlags = flags.filter((f) => filteredIds.has(f.invoiceId));

    // Потенциальная экономия — через finance-домен
    const priceAnomalies = filteredFlags.filter((f) => f.flagType === 'price_anomaly' && !f.isResolved);
    const potentialSavings = computePotentialSavings(
      priceAnomalies.map((f) => ({ details: f.details, invoiceItemId: f.invoiceItemId })),
      items.map((it) => ({ id: it.id, lineSum: it.lineSum })),
    );

    // Помесячный график (последние 6 месяцев + данные периода)
    const monthlyStats: Record<string, { total: number; flagged: number; monthName: string }> = {};
    const now = new Date(this.ctx.clock.now());
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthlyStats[key] = { total: 0, flagged: 0, monthName: MONTHS_RU[d.getMonth()]! };
    }
    for (const inv of filteredInvoices) {
      if (!inv.recognizedDate) continue;
      const date = new Date(inv.recognizedDate);
      if (isNaN(date.getTime())) continue;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyStats[key]) {
        const yrShort = String(date.getFullYear()).slice(-2);
        monthlyStats[key] = { total: 0, flagged: 0, monthName: `${MONTHS_RU[date.getMonth()]} '${yrShort}` };
      }
      monthlyStats[key]!.total++;
      if (inv.status === 'flagged') monthlyStats[key]!.flagged++;
    }
    const chartData: DashboardChartPoint[] = Object.keys(monthlyStats)
      .sort()
      .map((key) => ({
        month: monthlyStats[key]!.monthName,
        'Всего накладных': monthlyStats[key]!.total,
        'Выявлено аномалий': monthlyStats[key]!.flagged,
      }));

    // Pie: типы аномалий
    let duplicateCount = 0;
    let priceCount = 0;
    for (const f of filteredFlags) {
      if (f.flagType === 'duplicate_exceed') duplicateCount++;
      else if (f.flagType === 'price_anomaly') priceCount++;
    }
    const pieData = [
      { name: 'Превышение лимитов износа', value: duplicateCount, color: '#EF4444' },
      { name: 'Завышение цены (>10%)', value: priceCount, color: '#F59E0B' },
    ];

    // Топ-5 деталей по количеству аномалий
    const itemAnomaliesCount: Record<string, number> = {};
    for (const f of filteredFlags) {
      const item = items.find((it) => it.id === f.invoiceItemId);
      if (item && item.matchedNomenclatureId) {
        const part = activeNomenclature.find((n) => n.id === item.matchedNomenclatureId);
        if (part) itemAnomaliesCount[part.normalizedName] = (itemAnomaliesCount[part.normalizedName] || 0) + 1;
      }
    }
    const topPartsData = Object.entries(itemAnomaliesCount)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Последние аномалии (нерешённые)
    const recentAnomalies: DashboardRecentAnomaly[] = filteredFlags
      .filter((f) => !f.isResolved)
      .map((f) => {
        const invoice = filteredInvoices.find((i) => i.id === f.invoiceId);
        const item = items.find((it) => it.id === f.invoiceItemId);
        const supplierObj = invoice ? activeSuppliers.find((s) => s.id === invoice.supplierId) : null;
        return {
          id: f.id,
          invoiceId: f.invoiceId,
          relatedInvoiceId: f.relatedInvoiceId,
          date: invoice ? invoice.recognizedDate : '',
          supplierName: supplierObj
            ? supplierObj.name
            : invoice
              ? invoice.supplierName || invoice.rawSupplierName || 'Неизвестный'
              : 'Неизвестный',
          flagType: f.flagType,
          details: f.details,
          severity: f.severity,
          isResolved: f.isResolved,
          rawName: item ? item.rawName : '',
        };
      })
      .sort((a, b) => b.id.localeCompare(a.id))
      .slice(0, 10);

    // Закупки по поставщикам
    const supplierPurchaseMap: Record<string, number> = {};
    for (const inv of filteredInvoices) {
      if (inv.status === 'processing') continue;
      const supplierObj = inv.supplierId ? activeSuppliers.find((s) => s.id === inv.supplierId) : null;
      const sName = supplierObj ? supplierObj.name : inv.supplierName || inv.rawSupplierName || 'Неизвестный поставщик';
      supplierPurchaseMap[sName] = (supplierPurchaseMap[sName] || 0) + (inv.totalSum || 0);
    }
    const supplierPurchases = Object.entries(supplierPurchaseMap)
      .map(([name, total]) => ({ name, total: Math.round(total) }))
      .sort((a, b) => b.total - a.total);

    return {
      totalInvoicesCount,
      flaggedInvoicesCount,
      flaggedPercentage,
      potentialSavings,
      chartData,
      pieData,
      topPartsData,
      recentAnomalies,
      supplierPurchases,
    };
  }

  /** Фильтр накладных по периоду — дословный перенос логики dashboard-обработчика. */
  private filterByPeriod(activeInvoices: Invoice[], query: DashboardPeriodQuery): Invoice[] {
    const periodType = query.periodType;
    if (!periodType || periodType === 'all') return activeInvoices;

    const selectedYear = query.selectedYear || 2026;
    const selectedQuarter = query.selectedQuarter || 3;
    const selectedMonth = query.selectedMonth || 7;
    const startDate = query.startDate;
    const endDate = query.endDate;

    return activeInvoices.filter((inv) => {
      const dateStr = inv.recognizedDate || '2026-07-20';

      if (periodType === 'custom') {
        const itemTime = new Date(dateStr).getTime();
        if (startDate && itemTime < new Date(startDate).getTime()) return false;
        if (endDate && itemTime > new Date(endDate + 'T23:59:59').getTime()) return false;
        return true;
      }

      const parts = dateStr.trim().split(/[-.]/);
      let year = 2026;
      let month = 7;
      if (dateStr.includes('-')) {
        year = parseInt(parts[0]!, 10) || 2026;
        month = parseInt(parts[1] ?? '', 10) || 7;
      } else if (dateStr.includes('.')) {
        if ((parts[0] ?? '').length === 4) {
          year = parseInt(parts[0]!, 10) || 2026;
          month = parseInt(parts[1] ?? '', 10) || 7;
        } else {
          year = parseInt(parts[2] ?? '', 10) || 2026;
          month = parseInt(parts[1] ?? '', 10) || 7;
        }
      } else {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
          year = d.getFullYear();
          month = d.getMonth() + 1;
        }
      }

      if (year !== selectedYear) return false;
      if (periodType === 'year') return true;
      if (periodType === 'quarter') return Math.ceil(month / 3) === selectedQuarter;
      if (periodType === 'month') return month === selectedMonth;
      return true;
    });
  }
}
