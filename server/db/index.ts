import { loadFirebaseEnv } from './env.js';
import { AdminFirestoreGateway } from './adminFirestoreGateway.js';
import type { FirestoreGateway } from './firestoreGateway.js';

export * from './firestoreGateway.js';
export * from './env.js';
export { AdminFirestoreGateway } from './adminFirestoreGateway.js';

let gatewaySingleton: FirestoreGateway | null = null;

/**
 * Возвращает единый (ленивый) шлюз к Firestore на @google-cloud/firestore (keyless).
 * Firestore — единственный источник истины: локального fallback нет.
 * Если конфигурация/подключение недоступны — бросается понятная ошибка
 * (API-слой преобразует её в 503, а не работает с пустой/устаревшей БД).
 */
export function getFirestoreGateway(): FirestoreGateway {
  if (!gatewaySingleton) {
    const env = loadFirebaseEnv();
    gatewaySingleton = new AdminFirestoreGateway(env);
  }
  return gatewaySingleton;
}

/** Для тестов/переинициализации: подменить или сбросить синглтон шлюза. */
export function setFirestoreGateway(gateway: FirestoreGateway | null): void {
  gatewaySingleton = gateway;
}
