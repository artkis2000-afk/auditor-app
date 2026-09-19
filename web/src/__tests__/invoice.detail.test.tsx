import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { installFetch, renderApp, setToken, AUTH_USER, type RouteResp } from '../test/utils';

const ITEM = {
  id: 'ii1',
  invoiceId: 'inv-1',
  nomenclatureId: 'n1',
  rawName: 'Гайка колесная (260602117)',
  quantity: 1,
  unitPrice: 111.68,
  lineSum: 110,
  matchedNomenclatureId: 'n1',
  suggestions: [{ nomenclatureId: 'n1', name: 'Гайка колесная норм.', score: 0.92 }],
  vehicleId: 'v1',
  truckPlacement: null,
};

function detail(status: string, opts: { items?: unknown[]; flags?: unknown[]; ocrError?: string } = {}) {
  return {
    invoice: {
      id: 'inv-1', imagePath: 'invoices/inv-1/original.jpg', recognizedDate: '2026-06-30', status,
      uploadedBy: 'u', supplierId: 's1', rawSupplierName: 'ИП Монахов', totalSum: 330, filename: 'IMG.jpg',
      isReconciled: false, createdAt: '2026-06-30T00:00:00Z', updatedAt: '2026-06-30T00:00:00Z', deletedAt: null,
      ...(opts.ocrError ? { ocrError: opts.ocrError } : {}),
    },
    items: opts.items ?? [],
    flags: opts.flags ?? [],
    supplierName: 'ИП Монахов',
    uploaderName: 'Админ',
  };
}

const meVeh = (url: string): RouteResp | null => {
  if (url.includes('/auth/me')) return { status: 200, body: { user: AUTH_USER } };
  if (url.endsWith('/vehicles')) return { status: 200, body: [{ id: 'v1', name: 'Вольво 177', plate: '' }] };
  if (url.includes('/invoices/inv-1/image')) return { status: 200, body: 'IMG' };
  return null;
};

describe('Invoice detail', () => {
  it('рендерит данные, позиции и сопоставление', async () => {
    setToken();
    installFetch((url): RouteResp => meVeh(url) ?? (url.endsWith('/invoices/inv-1') ? { status: 200, body: detail('confirmed', { items: [ITEM] }) } : { status: 200, body: {} }));
    renderApp('/invoices/inv-1');
    expect(await screen.findByText('Гайка колесная (260602117)')).toBeInTheDocument();
    expect(screen.getByText('Гайка колесная норм.')).toBeInTheDocument(); // matched name
    expect(screen.getByText('Вольво 177')).toBeInTheDocument();
    expect(screen.getAllByText('Подтверждена').length).toBeGreaterThan(0);
  });

  it('показывает аномалии', async () => {
    setToken();
    const flags = [{ id: 'f1', invoiceItemId: 'ii1', invoiceId: 'inv-1', flagType: 'price_anomaly', details: 'Цена выше средней на 40%', severity: 'high', isResolved: false, createdAt: 'x' }];
    installFetch((url): RouteResp => meVeh(url) ?? (url.endsWith('/invoices/inv-1') ? { status: 200, body: detail('flagged', { items: [ITEM], flags }) } : { status: 200, body: {} }));
    renderApp('/invoices/inv-1');
    expect(await screen.findByText('Ценовая аномалия')).toBeInTheDocument();
    expect(screen.getByText('Цена выше средней на 40%')).toBeInTheDocument();
    expect(screen.getByText('Высокая')).toBeInTheDocument();
  });

  it('auto-OCR: processing → распознаётся → появляются позиции', async () => {
    setToken();
    let calls = 0;
    installFetch((url): RouteResp => {
      const m = meVeh(url);
      if (m) return m;
      if (url.includes('/invoices/inv-1/ocr')) return { status: 200, body: { status: 'confirmed', itemsCount: 1, fallback: false } };
      if (url.endsWith('/invoices/inv-1')) {
        calls += 1;
        return { status: 200, body: calls === 1 ? detail('processing') : detail('confirmed', { items: [ITEM] }) };
      }
      return { status: 200, body: {} };
    });
    renderApp('/invoices/inv-1');
    expect(await screen.findByText('Гайка колесная (260602117)')).toBeInTheDocument();
  });

  it('OCR ошибка → баннер + повтор распознавания', async () => {
    setToken();
    let detailCalls = 0;
    let ocrCalls = 0;
    installFetch((url): RouteResp => {
      const m = meVeh(url);
      if (m) return m;
      if (url.includes('/invoices/inv-1/ocr')) {
        ocrCalls += 1;
        return ocrCalls === 1 ? { status: 502, body: { error: 'Не удалось распознать накладную' } } : { status: 200, body: { status: 'confirmed', itemsCount: 1, fallback: false } };
      }
      if (url.endsWith('/invoices/inv-1')) {
        detailCalls += 1;
        if (detailCalls === 1) return { status: 200, body: detail('processing') };
        if (ocrCalls >= 2) return { status: 200, body: detail('confirmed', { items: [ITEM] }) };
        return { status: 200, body: detail('draft', { ocrError: 'Gemini недоступен' }) };
      }
      return { status: 200, body: {} };
    });
    renderApp('/invoices/inv-1');
    // авто-OCR упал → контролируемая ошибка
    expect(await screen.findByText('Не удалось распознать накладную')).toBeInTheDocument();
    const retry = await screen.findByRole('button', { name: 'Повторить OCR' });
    await waitFor(() => expect(retry).not.toBeDisabled());
    fireEvent.click(retry);
    expect(await screen.findByText('Гайка колесная (260602117)')).toBeInTheDocument();
  });

  it('подтверждение накладной → статус обновляется', async () => {
    setToken();
    let calls = 0;
    installFetch((url, init): RouteResp => {
      const m = meVeh(url);
      if (m) return m;
      if (url.includes('/invoices/inv-1/confirm')) return { status: 200, body: { success: true, status: 'confirmed', flagsCount: 0, flags: [] } };
      if (url.endsWith('/invoices/inv-1') && (!init || init.method === undefined || init.method === 'GET')) {
        calls += 1;
        return { status: 200, body: calls === 1 ? detail('flagged', { items: [ITEM] }) : detail('confirmed', { items: [ITEM] }) };
      }
      return { status: 200, body: {} };
    });
    renderApp('/invoices/inv-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Подтвердить' }));
    const buttons = await screen.findAllByRole('button', { name: 'Подтвердить' });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(screen.getAllByText('Подтверждена').length).toBeGreaterThan(0));
  });
});
