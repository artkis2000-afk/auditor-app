import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { App } from '../App';

export interface RouteResp {
  status: number;
  body?: unknown;
}
export type FetchHandler = (url: string, init?: RequestInit) => RouteResp;

/** Ставит глобальный fetch-мок, маршрутизирующий ответы по URL (тестируется реальный API-клиент). */
export function installFetch(handler: FetchHandler): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const { status, body } = handler(url, init);
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => body ?? {},
      blob: async () => new Blob([typeof body === 'string' ? body : JSON.stringify(body ?? {})]),
    } as Response;
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** Рендер всего приложения (App) на MemoryRouter + AuthProvider. */
export function renderApp(initialPath = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

/** Профиль (ответ GET /api/auth/me) для аутентифицированного пользователя в тестах. */
export const AUTH_USER = {
  id: 'u1',
  username: 'boss@example.com',
  fullName: 'Главный Аудитор',
  role: 'admin' as const,
  email: 'boss@example.com',
};

/** Firebase-личность (для fakeFirebase.__setUser) — «вошедший» пользователь. */
export const FIREBASE_USER = {
  uid: 'u1',
  email: 'boss@example.com',
  displayName: 'Главный Аудитор',
  photoURL: null,
};

export const EMPTY_STATS = {
  totalInvoicesCount: 0,
  flaggedInvoicesCount: 0,
  flaggedPercentage: 0,
  potentialSavings: 0,
  chartData: [],
  pieData: [],
  topPartsData: [],
  recentAnomalies: [],
  supplierPurchases: [],
};

export const SAMPLE_STATS = {
  ...EMPTY_STATS,
  totalInvoicesCount: 42,
  flaggedInvoicesCount: 7,
  flaggedPercentage: 16.7,
  potentialSavings: 125000,
  pieData: [{ name: 'Подтверждённые', value: 35, color: '#047857' }],
  supplierPurchases: [{ name: 'ИП Монахов', total: 500000 }],
};
