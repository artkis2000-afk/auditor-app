import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Loading } from './states';

/** Пускает в children только authenticated; loading → индикатор; иначе → /login. */
export function ProtectedRoute({ children }: { children: ReactNode }): JSX.Element {
  const { status } = useAuth();
  if (status === 'loading') {
    return (
      <div className="app-center">
        <Loading label="Проверка сессии…" />
      </div>
    );
  }
  if (status === 'unauthenticated') return <Navigate to="/login" replace />;
  return <>{children}</>;
}
