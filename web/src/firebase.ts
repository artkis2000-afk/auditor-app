import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onIdTokenChanged,
  type Auth,
  type User as FirebaseUser,
} from 'firebase/auth';

/**
 * Инициализация Firebase (PHASE 5.1). Только Authentication — Analytics и прочие сервисы не подключаем.
 * Конфиг — из публичных VITE_FIREBASE_* (apiKey и т.п. НЕ секреты: идентифицируют проект, не авторизуют).
 * Сессия/persistence/refresh ID-токена делает сам SDK (persistence по умолчанию — local/IndexedDB);
 * ID-токен вручную в localStorage/sessionStorage НЕ храним.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
};

const app: FirebaseApp = initializeApp(firebaseConfig);
const auth: Auth = getAuth(app);

/** Лёгкое представление Firebase-личности для UI (без раскрытия всего объекта SDK). */
export interface AuthUserLite {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

function toLite(u: FirebaseUser | null): AuthUserLite | null {
  return u ? { uid: u.uid, email: u.email, displayName: u.displayName, photoURL: u.photoURL } : null;
}

/** Подписка на изменения auth-состояния/ID-токена. Возвращает функцию отписки. */
export function subscribeAuth(cb: (user: AuthUserLite | null) => void): () => void {
  return onIdTokenChanged(auth, (u) => cb(toLite(u)));
}

/** Свежий Firebase ID-токен текущего пользователя (SDK обновит при необходимости). */
export async function getCurrentIdToken(): Promise<string | null> {
  const u = auth.currentUser;
  return u ? u.getIdToken() : null;
}

/** Вход через Google (popup). */
export async function signInWithGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
}

/** Выход. */
export async function signOutUser(): Promise<void> {
  await signOut(auth);
}
