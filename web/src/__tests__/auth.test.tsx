import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { installFetch, renderApp, setToken, AUTH_USER, SAMPLE_STATS, type RouteResp } from '../test/utils';

function route(url: string): RouteResp {
  if (url.includes('/auth/me')) return { status: 200, body: { user: AUTH_USER } };
  if (url.includes('/dashboard/stats')) return { status: 200, body: SAMPLE_STATS };
  return { status: 404, body: { error: 'not found' } };
}

describe('Auth flow', () => {
  it('нет токена → защищённый маршрут редиректит на /login', async () => {
    installFetch(() => ({ status: 200, body: {} }));
    renderApp('/dashboard');
    expect(await screen.findByText(/Вход в систему аудита закупок/)).toBeInTheDocument();
  });

  it('валидный токен → /me проходит, открывается приложение', async () => {
    setToken();
    installFetch(route);
    renderApp('/dashboard');
    expect(await screen.findByText('Всего накладных')).toBeInTheDocument();
    expect(screen.getByText('Главный Аудитор')).toBeInTheDocument();
  });

  it('истёкший/битый токен → 401 на /me → login и токен очищен', async () => {
    setToken('stale');
    installFetch((url) => (url.includes('/auth/me') ? { status: 401, body: { error: 'Сессия истекла' } } : { status: 200, body: {} }));
    renderApp('/dashboard');
    expect(await screen.findByText(/Вход в систему аудита закупок/)).toBeInTheDocument();
    expect(localStorage.getItem('auditor_token')).toBeNull();
  });

  it('logout → токен удалён, редирект на login', async () => {
    setToken();
    installFetch(route);
    renderApp('/dashboard');
    await screen.findByText('Всего накладных');
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    expect(await screen.findByText(/Вход в систему аудита закупок/)).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem('auditor_token')).toBeNull());
  });
});
