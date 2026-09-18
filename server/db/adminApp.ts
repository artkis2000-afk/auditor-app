import { initializeApp, cert, applicationDefault, getApps, type App, type ServiceAccount } from 'firebase-admin/app';
import type { FirebaseEnv } from './env.js';

/**
 * Единая инициализация Firebase Admin App. И Firestore-gateway, и Storage-gateway
 * должны переиспользовать ОДНО именованное приложение — второй initializeApp не создаётся.
 * Имя приложения детерминировано по projectId; повторный вызов возвращает существующее.
 */
export function getAdminApp(env: FirebaseEnv): App {
  const appName = `fury-${env.projectId}`;
  const existing = getApps().find((a) => a.name === appName);
  if (existing) return existing;
  return initializeApp(
    {
      credential: env.serviceAccount
        ? cert(env.serviceAccount as ServiceAccount)
        : applicationDefault(),
      projectId: env.projectId,
    },
    appName,
  );
}
