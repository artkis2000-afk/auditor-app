import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';

export function LoginPage(): JSX.Element {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';
  if (status === 'authenticated') return <Navigate to={from} replace />;

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      // Показываем только безопасное сообщение (из {error}); без стеков/внутренних деталей.
      setError(err instanceof ApiError ? err.message : 'Не удалось войти. Попробуйте снова.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-center">
      <form className="card login" onSubmit={onSubmit}>
        <h1 className="login__title">ФУРЫ ЗАПЧАСТИ</h1>
        <p className="login__subtitle">Вход в систему аудита закупок</p>

        <label className="field">
          <span className="field__label">Имя пользователя</span>
          <input
            className="field__input"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={submitting}
            autoFocus
          />
        </label>

        <label className="field">
          <span className="field__label">Пароль</span>
          <input
            className="field__input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
          />
        </label>

        {error ? (
          <p className="login__error" role="alert">
            {error}
          </p>
        ) : null}

        <button className="btn btn--primary" type="submit" disabled={submitting || !username || !password}>
          {submitting ? 'Вход…' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
