/**
 * Оффлайн-подмена web/src/firebase.ts для тестов (vi.mock('../firebase', () => import('../test/fakeFirebase'))).
 * Тот же публичный контракт, что и реальный модуль; состояние управляется __setUser/__reset.
 * Функции — обычные (не vi.fn), чтобы afterEach → vi.restoreAllMocks не сбрасывал их реализацию.
 */
export interface AuthUserLite {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

let currentUser: AuthUserLite | null = null;
const listeners = new Set<(u: AuthUserLite | null) => void>();

/** Тестовый помощник: выставить/сбросить текущего пользователя (уведомляет подписчиков). */
export function __setUser(u: AuthUserLite | null): void {
  currentUser = u;
  for (const l of listeners) l(u);
}

/** Тестовый помощник: полный сброс состояния между тестами. */
export function __reset(): void {
  currentUser = null;
  listeners.clear();
}

export function subscribeAuth(cb: (user: AuthUserLite | null) => void): () => void {
  listeners.add(cb);
  cb(currentUser);
  return () => {
    listeners.delete(cb);
  };
}

export async function getCurrentIdToken(): Promise<string | null> {
  return currentUser ? 'fake-id-token' : null;
}

export async function signInWithGoogle(): Promise<void> {
  __setUser({ uid: 'u1', email: 'boss@example.com', displayName: 'Главный Аудитор', photoURL: null });
}

export async function signOutUser(): Promise<void> {
  __setUser(null);
}
