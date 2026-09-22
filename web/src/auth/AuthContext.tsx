import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from '../api/client';
import { subscribeAuth, signInWithGoogle, signOutUser, completeRedirectSignIn } from '../firebase';
import type { AuthUser } from '../types';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * PHASE 5.1: source of truth аутентификации — Firebase Auth.
 * Подписываемся на Firebase auth state; при наличии пользователя тянем профиль приложения
 * через GET /api/auth/me (роль/имя — из бэкенда, не из клиентских claim'ов).
 */
export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let cancelled = false;

    // 401 из любого запроса → принудительный выход из Firebase.
    setUnauthorizedHandler(() => {
      void signOutUser();
      if (cancelled) return;
      setUser(null);
      setStatus('unauthenticated');
    });

    // Обработать возврат с Google redirect (если это он): SDK выставит пользователя,
    // после чего сработает onIdTokenChanged ниже. Ошибку redirect не роняем — останемся на login.
    void completeRedirectSignIn().catch(() => {
      /* redirect не удался/не было redirect → состояние определит onIdTokenChanged */
    });

    const unsubscribe = subscribeAuth((fbUser) => {
      if (cancelled) return;
      if (!fbUser) {
        setUser(null);
        setStatus('unauthenticated');
        return;
      }
      setStatus('loading');
      api
        .me()
        .then(({ user: profile }) => {
          if (cancelled) return;
          setUser(profile);
          setStatus('authenticated');
        })
        .catch(() => {
          if (cancelled) return;
          // Бэкенд отверг токен/профиль → выходим из Firebase, на login.
          void signOutUser();
          setUser(null);
          setStatus('unauthenticated');
        });
    });

    return () => {
      cancelled = true;
      setUnauthorizedHandler(null);
      unsubscribe();
    };
  }, []);

  const loginWithGoogle = useCallback(async () => {
    // Состояние обновится через subscribeAuth → api.me().
    await signInWithGoogle();
  }, []);

  const logout = useCallback(async () => {
    await signOutUser();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, loginWithGoogle, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth должен использоваться внутри AuthProvider');
  return ctx;
}
