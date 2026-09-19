import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { installFetch, renderApp, setToken, AUTH_USER, type RouteResp } from '../test/utils';

const ROW = {
  id: 'inv-1',
  recognizedDate: '2026-06-30',
  status: 'flagged',
  uploadedBy: 'u',
  supplierId: null,
  supplierName: 'ИП Монахов',
  uploaderName: 'Админ',
  totalSum: 330,
  filename: 'IMG_9840.JPG',
  flagsCount: 2,
  isReconciled: false,
  createdAt: '2026-06-30T00:00:00Z',
  updatedAt: '2026-06-30T00:00:00Z',
  deletedAt: null,
  items: [{ id: 'ii1', rawName: 'Гайка', matchedNomenclatureId: 'n1', vehicleId: 'v1' }],
};

function base(url: string): RouteResp | null {
  if (url.includes('/auth/me')) return { status: 200, body: { user: AUTH_USER } };
  if (url.includes('/vehicles')) return { status: 200, body: [{ id: 'v1', name: 'Вольво 177', plate: '' }] };
  return null;
}

describe('Invoices list', () => {
  it('успех → показывает строки накладных', async () => {
    setToken();
    installFetch((url): RouteResp => base(url) ?? (url.includes('/invoices') ? { status: 200, body: [ROW] } : { status: 200, body: {} }));
    renderApp('/invoices');
    // строка рендерится и в таблице (desktop), и в карточке (mobile) — оба в DOM.
    expect((await screen.findAllByText('ИП Монахов')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('IMG_9840.JPG').length).toBeGreaterThan(0);
  });

  it('пусто → empty state', async () => {
    setToken();
    installFetch((url): RouteResp => base(url) ?? (url.includes('/invoices') ? { status: 200, body: [] } : { status: 200, body: {} }));
    renderApp('/invoices');
    expect(await screen.findByText('Накладных пока нет')).toBeInTheDocument();
  });

  it('ошибка API → error state с повтором', async () => {
    setToken();
    installFetch((url): RouteResp => base(url) ?? (url.includes('/invoices') ? { status: 500, body: { error: 'Внутренняя ошибка сервера' } } : { status: 200, body: {} }));
    renderApp('/invoices');
    expect(await screen.findByText('Внутренняя ошибка сервера')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });

  it('401 → централизованный разлогин и редирект на login', async () => {
    setToken();
    installFetch((url): RouteResp => base(url) ?? (url.includes('/invoices') ? { status: 401, body: { error: 'Сессия истекла' } } : { status: 200, body: {} }));
    renderApp('/invoices');
    expect(await screen.findByText(/Вход в систему аудита закупок/)).toBeInTheDocument();
  });
});
