import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { installFetch, renderApp, setToken, AUTH_USER, SAMPLE_STATS, type RouteResp } from '../test/utils';

const me = (url: string): RouteResp | null => (url.includes('/auth/me') ? { status: 200, body: { user: AUTH_USER } } : null);

describe('Dashboard', () => {
  it('успешная загрузка → показывает метрики из DashboardStats', async () => {
    setToken();
    installFetch((url): RouteResp => me(url) ?? (url.includes('/dashboard/stats') ? { status: 200, body: SAMPLE_STATS } : { status: 200, body: {} }));
    renderApp('/dashboard');
    expect(await screen.findByText('Всего накладных')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('401 на stats → централизованный разлогин и редирект на login', async () => {
    setToken();
    installFetch((url): RouteResp => me(url) ?? (url.includes('/dashboard/stats') ? { status: 401, body: { error: 'Сессия истекла' } } : { status: 200, body: {} }));
    renderApp('/dashboard');
    expect(await screen.findByText(/Вход в систему аудита закупок/)).toBeInTheDocument();
  });

  it('ошибка API (500) → показывает состояние ошибки', async () => {
    setToken();
    installFetch((url): RouteResp => me(url) ?? (url.includes('/dashboard/stats') ? { status: 500, body: { error: 'Внутренняя ошибка сервера' } } : { status: 200, body: {} }));
    renderApp('/dashboard');
    expect(await screen.findByText('Внутренняя ошибка сервера')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
});
