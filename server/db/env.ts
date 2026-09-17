import { z } from 'zod';

/**
 * Конфигурация подключения к Firebase (server-side, Admin SDK).
 * Значения берутся ТОЛЬКО из окружения — секреты в код не помещаются.
 *
 * Способы аутентификации Admin SDK (в порядке приоритета):
 *  1. FIREBASE_SERVICE_ACCOUNT — JSON сервисного аккаунта строкой;
 *  2. GOOGLE_APPLICATION_CREDENTIALS — путь к JSON-файлу (Application Default Credentials).
 */

export interface FirebaseEnv {
  projectId: string;
  databaseId: string;
  /** Разобранный сервисный аккаунт, если задан через FIREBASE_SERVICE_ACCOUNT. */
  serviceAccount?: Record<string, unknown>;
  /** Путь к файлу креденшелов (ADC), если сервисный аккаунт строкой не задан. */
  credentialsPath?: string;
}

const serviceAccountSchema = z
  .object({
    project_id: z.string().optional(),
    client_email: z.string().optional(),
    private_key: z.string().optional(),
  })
  .passthrough();

/**
 * Загружает и валидирует конфигурацию Firebase из окружения.
 * Бросает понятную ошибку, если обязательные значения отсутствуют или некорректны.
 */
export function loadFirebaseEnv(env: NodeJS.ProcessEnv = process.env): FirebaseEnv {
  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  if (!projectId) {
    throw new Error('Не задан FIREBASE_PROJECT_ID в окружении (.env).');
  }

  // Именованная БД (в исходном проекте — ai-studio-527e...). Дефолт '(default)'.
  const databaseId = env.FIRESTORE_DATABASE_ID?.trim() || '(default)';

  const rawServiceAccount = env.FIREBASE_SERVICE_ACCOUNT?.trim();
  const credentialsPath = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();

  if (!rawServiceAccount && !credentialsPath) {
    throw new Error(
      'Не заданы креденшелы Firebase Admin SDK: укажите FIREBASE_SERVICE_ACCOUNT (JSON) ' +
        'или GOOGLE_APPLICATION_CREDENTIALS (путь к файлу).',
    );
  }

  let serviceAccount: Record<string, unknown> | undefined;
  if (rawServiceAccount) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawServiceAccount);
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT содержит некорректный JSON.');
    }
    const result = serviceAccountSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT не похож на сервисный аккаунт Firebase.');
    }
    serviceAccount = result.data;
  }

  return {
    projectId,
    databaseId,
    serviceAccount,
    credentialsPath: serviceAccount ? undefined : credentialsPath,
  };
}
