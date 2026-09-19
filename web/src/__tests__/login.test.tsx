import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { installFetch, renderApp, AUTH_USER, SAMPLE_STATS, type RouteResp } from '../test/utils';

function fill(): void {
  fireEvent.change(screen.getByLabelText('Имя пользователя'), { target: { value: 'boss' } });
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'secret' } });
}

describe('Login screen', () => {
  it('успешный вход → сохраняет токен и открывает дашборд', async () => {
    installFetch((url): RouteResp => {
      if (url.includes('/auth/login')) return { status: 200, body: { token: 'jwt-123', user: AUTH_USER } };
      if (url.includes('/dashboard/stats')) return { status: 200, body: SAMPLE_STATS };
      return { status: 200, body: {} };
    });
    renderApp('/login');
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByText('Всего накладных')).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem('auditor_token')).toBe('jwt-123'));
  });

  it('ошибка входа → показывает сообщение backend, токен не сохранён', async () => {
    installFetch((url): RouteResp =>
      url.includes('/auth/login') ? { status: 401, body: { error: 'Неверный пароль' } } : { status: 200, body: {} },
    );
    renderApp('/login');
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByText('Неверный пароль')).toBeInTheDocument();
    expect(localStorage.getItem('auditor_token')).toBeNull();
  });
});
