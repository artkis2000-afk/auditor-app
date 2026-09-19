import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { api, tokenStorage, setUnauthorizedHandler, ApiError } from '../api/client';
import type { AuthUser } from '../types';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  const logout = useCallback(() => {
    tokenStorage.clear();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  // Централизованная обработка 401 из любого запроса → разлогин.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      tokenStorage.clear();
      setUser(null);
      setStatus('unauthenticated');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Старт приложения: нет токена → login; есть → проверяем через /me.
  useEffect(() => {
    let cancelled = false;
    const token = tokenStorage.get();
    if (!token) {
      setStatus('unauthenticated');
      return;
    }
    api
      .me()
      .then(({ user: u }) => {
        if (cancelled) return;
        setUser(u);
        setStatus('authenticated');
      })
      .catch(() => {
        if (cancelled) return;
        // Любой сбой /me на старте (истёкший/битый токен, ошибка) → чистим токен и на login.
        tokenStorage.clear();
        setUser(null);
        setStatus('unauthenticated');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.login(username, password);
    tokenStorage.set(res.token);
    setUser(res.user);
    setStatus('authenticated');
  }, []);

  return <AuthContext.Provider value={{ status, user, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth должен использоваться внутри AuthProvider');
  return ctx;
}
