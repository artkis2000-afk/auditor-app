import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
vi.mock('../firebase', () => import('../test/fakeFirebase'));
import { __setUser, __reset } from '../test/fakeFirebase';
import { installFetch, renderApp, AUTH_USER, FIREBASE_USER, SAMPLE_STATS, type RouteResp } from '../test/utils';

beforeEach(() => __reset());

const me = (url: string): RouteResp | null => (url.includes('/auth/me') ? { status: 200, body: { user: AUTH_USER } } : null);

describe('Dashboard', () => {
  it('успешная загрузка → показывает метрики из DashboardStats', async () => {
    __setUser(FIREBASE_USER);
    installFetch((url): RouteResp => me(url) ?? (url.includes('/dashboard/stats') ? { status: 200, body: SAMPLE_STATS } : { status: 200, body: {} }));
    renderApp('/dashboard');
    expect(await screen.findByText('Всего накладных')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('401 на stats → централизованный разлогин и редирект на login', async () => {
    __setUser(FIREBASE_USER);
    installFetch((url): RouteResp => me(url) ?? (url.includes('/dashboard/stats') ? { status: 401, body: { error: 'Сессия истекла' } } : { status: 200, body: {} }));
    renderApp('/dashboard');
    expect(await screen.findByText(/Вход в систему аудита закупок/)).toBeInTheDocument();
  });

  it('ошибка API (500) → показывает состояние ошибки', async () => {
    __setUser(FIREBASE_USER);
    installFetch((url): RouteResp => me(url) ?? (url.includes('/dashboard/stats') ? { status: 500, body: { error: 'Внутренняя ошибка сервера' } } : { status: 200, body: {} }));
    renderApp('/dashboard');
    expect(await screen.findByText('Внутренняя ошибка сервера')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
});
