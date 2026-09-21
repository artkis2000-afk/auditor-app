import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../firebase', () => import('../test/fakeFirebase'));
import { __reset } from '../test/fakeFirebase';
import { installFetch, renderApp, AUTH_USER, SAMPLE_STATS, type RouteResp } from '../test/utils';

beforeEach(() => __reset());

describe('Login screen (Google/Firebase)', () => {
  it('кнопка «Войти через Google» → вход и открытие дашборда', async () => {
    installFetch((url): RouteResp => {
      if (url.includes('/auth/me')) return { status: 200, body: { user: AUTH_USER } };
      if (url.includes('/dashboard/stats')) return { status: 200, body: SAMPLE_STATS };
      return { status: 200, body: {} };
    });
    renderApp('/login');
    fireEvent.click(screen.getByRole('button', { name: 'Войти через Google' }));
    // signInWithGoogle (fake) выставляет пользователя → AuthContext → /me → dashboard
    expect(await screen.findByText('Всего накладных')).toBeInTheDocument();
  });

  it('форма username/password отсутствует (legacy убран)', async () => {
    installFetch(() => ({ status: 200, body: {} }));
    renderApp('/login');
    await screen.findByRole('button', { name: 'Войти через Google' });
    expect(screen.queryByLabelText('Имя пользователя')).toBeNull();
    expect(screen.queryByLabelText('Пароль')).toBeNull();
  });

  it('вход отклонён бэкендом (/me 403) → остаёмся на login', async () => {
    installFetch((url): RouteResp =>
      url.includes('/auth/me') ? { status: 403, body: { error: 'Доступ запрещён' } } : { status: 200, body: {} },
    );
    renderApp('/login');
    fireEvent.click(screen.getByRole('button', { name: 'Войти через Google' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Войти через Google' })).toBeInTheDocument());
  });
});
