import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
vi.mock('../firebase', () => import('../test/fakeFirebase'));
import { __setUser, __reset } from '../test/fakeFirebase';
import { installFetch, renderApp, FIREBASE_USER, type RouteResp } from '../test/utils';

beforeEach(() => __reset());

const VIEWER = { id: 'v', username: 'auditor', role: 'viewer', fullName: 'Аудитор' };
const MANAGER = { id: 'm', username: 'manager', role: 'manager', fullName: 'Менеджер' };
const ADMIN = { id: 'a', username: 'boss', role: 'admin', fullName: 'Владелец' };

function detail(status: string, opts: { ocrError?: string } = {}) {
  return {
    invoice: {
      id: 'inv-1', imagePath: 'invoices/inv-1/original.jpg', recognizedDate: '2026-06-30', status,
      uploadedBy: 'u', supplierId: null, totalSum: 330, filename: 'IMG.jpg', isReconciled: false,
      createdAt: 'x', updatedAt: 'x', deletedAt: null, ...(opts.ocrError ? { ocrError: opts.ocrError } : {}),
    },
    items: [], flags: [], supplierName: 'ИП Монахов', uploaderName: 'Загрузивший',
  };
}
const common = (user: unknown) => (url: string): RouteResp | null => {
  if (url.includes('/auth/me')) return { status: 200, body: { user } };
  if (url.endsWith('/vehicles')) return { status: 200, body: [] };
  if (url.includes('/invoices/inv-1/image')) return { status: 200, body: 'IMG' };
  return null;
};

describe('Role contract на invoice detail', () => {
  it('viewer: processing → без OCR-запроса, «ожидает обработки», без действий', async () => {
    __setUser(FIREBASE_USER);
    const f = installFetch((url): RouteResp => common(VIEWER)(url) ?? (url.endsWith('/invoices/inv-1') ? { status: 200, body: detail('processing') } : { status: 200, body: {} }));
    renderApp('/invoices/inv-1');
    expect(await screen.findByText(/ожидает обработки/i)).toBeInTheDocument();
    expect(f.mock.calls.some((c) => String(c[0]).includes('/ocr'))).toBe(false);
    expect(screen.queryByRole('button', { name: 'Повторить OCR' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Подтвердить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull();
  });

  it('manager: после ошибки OCR (draft) НЕ показывает «Повторить OCR»; confirm/delete скрыты', async () => {
    __setUser(FIREBASE_USER);
    const f = installFetch((url): RouteResp => common(MANAGER)(url) ?? (url.endsWith('/invoices/inv-1') ? { status: 200, body: detail('draft', { ocrError: 'Gemini недоступен' }) } : { status: 200, body: {} }));
    renderApp('/invoices/inv-1');
    expect(await screen.findByText(/Ошибка распознавания: Gemini недоступен/)).toBeInTheDocument();
    expect(f.mock.calls.some((c) => String(c[0]).includes('/ocr'))).toBe(false); // manual re-OCR недоступен
    expect(screen.queryByRole('button', { name: 'Повторить OCR' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Подтвердить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull();
  });

  it('admin: после ошибки OCR (draft) показывает активную кнопку «Повторить OCR»', async () => {
    __setUser(FIREBASE_USER);
    installFetch((url): RouteResp => common(ADMIN)(url) ?? (url.endsWith('/invoices/inv-1') ? { status: 200, body: detail('draft', { ocrError: 'Gemini недоступен' }) } : { status: 200, body: {} }));
    renderApp('/invoices/inv-1');
    const retry = await screen.findByRole('button', { name: 'Повторить OCR' });
    await waitFor(() => expect(retry).not.toBeDisabled());
  });
});
