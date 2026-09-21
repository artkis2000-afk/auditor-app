import { useState } from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

/**
 * PHASE 5.1: вход через Google (Firebase). Форма username/password удалена.
 * После успешного входа auth-состояние обновит Firebase listener в AuthContext → редирект.
 */
export function LoginPage(): JSX.Element {
  const { status, loginWithGoogle } = useAuth();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';
  if (status === 'authenticated') return <Navigate to={from} replace />;

  async function onGoogle(): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      await loginWithGoogle();
      // Навигация произойдёт автоматически: status → authenticated → <Navigate/>.
      // Профиль подтягивается асинхронно (AuthContext → /me); если бэкенд отклонит —
      // status вернётся в unauthenticated и останемся на этом экране.
    } catch {
      setError('Не удалось войти через Google. Попробуйте снова.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-center">
      <div className="card login">
        <h1 className="login__title">ФУРЫ ЗАПЧАСТИ</h1>
        <p className="login__subtitle">Вход в систему аудита закупок</p>

        {error ? (
          <p className="login__error" role="alert">
            {error}
          </p>
        ) : null}

        <button
          className="btn btn--primary"
          type="button"
          onClick={onGoogle}
          disabled={submitting}
        >
          {submitting ? 'Вход…' : 'Войти через Google'}
        </button>
      </div>
    </div>
  );
}
