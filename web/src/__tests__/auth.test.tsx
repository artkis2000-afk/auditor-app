import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../firebase', () => import('../test/fakeFirebase'));
import { __setUser, __reset } from '../test/fakeFirebase';
import { installFetch, renderApp, AUTH_USER, FIREBASE_USER, SAMPLE_STATS, type RouteResp } from '../test/utils';

function route(url: string): RouteResp {
  if (url.includes('/auth/me')) return { status: 200, body: { user: AUTH_USER } };
  if (url.includes('/dashboard/stats')) return { status: 200, body: SAMPLE_STATS };
  return { status: 404, body: { error: 'not found' } };
}

beforeEach(() => __reset());

describe('Auth flow (Firebase)', () => {
  it('не вошёл → защищённый маршрут редиректит на /login', async () => {
    installFetch(() => ({ status: 200, body: {} }));
    renderApp('/dashboard');
    expect(await screen.findByText(/Вход в систему аудита закупок/)).toBeInTheDocument();
  });

  it('вошёл в Firebase + /me 200 → открывается приложение', async () => {
    __setUser(FIREBASE_USER);
    installFetch(route);
    renderApp('/dashboard');
    expect(await screen.findByText('Всего накладных')).toBeInTheDocument();
    expect(screen.getByText('Главный Аудитор')).toBeInTheDocument();
  });

  it('/me → 401 → выход и редирект на login', async () => {
    __setUser(FIREBASE_USER);
    installFetch((url) =>
      url.includes('/auth/me') ? { status: 401, body: { error: 'Сессия истекла' } } : { status: 200, body: {} },
    );
    renderApp('/dashboard');
    expect(await screen.findByText(/Вход в систему аудита закупок/)).toBeInTheDocument();
  });

  it('logout → редирект на login', async () => {
    __setUser(FIREBASE_USER);
    installFetch(route);
    renderApp('/dashboard');
    await screen.findByText('Всего накладных');
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    await waitFor(() => expect(screen.getByText(/Вход в систему аудита закупок/)).toBeInTheDocument());
  });
});
