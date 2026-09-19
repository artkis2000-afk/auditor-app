import { z } from 'zod';

/**
 * Конфигурация подключения к Firebase (server-side, Admin SDK).
 * Значения берутся ТОЛЬКО из окружения — секреты в код не помещаются.
 *
 * Credentials НЕ обязательны (keyless-архитектура). Выбор провайдера (см. adminApp.ts):
 *  1. FIREBASE_SERVICE_ACCOUNT — JSON сервисного аккаунта строкой (опциональный escape hatch);
 *  2. Workload Identity Federation (Vercel OIDC) — если заданы GCP_* переменные;
 *  3. Application Default Credentials — local `gcloud auth application-default login`
 *     (в т.ч. с --impersonate-service-account) или metadata-сервер. Ключи не нужны.
 */

/** Конфигурация Vercel OIDC → GCP Workload Identity Federation. */
export interface WifConfig {
  projectNumber: string;
  poolId: string;
  providerId: string;
  serviceAccountEmail: string;
  /** STS audience (https://iam.googleapis.com/…). Опционально: default-audience режим. */
  audience?: string;
}

export interface FirebaseEnv {
  projectId: string;
  databaseId: string;
  /** Разобранный сервисный аккаунт, если задан через FIREBASE_SERVICE_ACCOUNT (не рекомендуется). */
  serviceAccount?: Record<string, unknown>;
  /** Путь к файлу ADC (GOOGLE_APPLICATION_CREDENTIALS), если задан. Читается самим applicationDefault(). */
  credentialsPath?: string;
  /** Имя бакета Firebase Storage (FIREBASE_STORAGE_BUCKET). Опционально: нужно только для ImageStore. */
  storageBucket?: string;
  /** Конфигурация WIF (Vercel/production), если заданы GCP_* переменные. */
  wif?: WifConfig;
}

const serviceAccountSchema = z
  .object({
    project_id: z.string().optional(),
    client_email: z.string().optional(),
    private_key: z.string().optional(),
  })
  .passthrough();

/** Собирает WifConfig из GCP_* переменных. Частичная конфигурация → явная ошибка. */
function parseWif(env: NodeJS.ProcessEnv): WifConfig | undefined {
  const projectNumber = env.GCP_PROJECT_NUMBER?.trim();
  const poolId = env.GCP_WORKLOAD_IDENTITY_POOL_ID?.trim();
  const providerId = env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID?.trim();
  const serviceAccountEmail = env.GCP_SERVICE_ACCOUNT_EMAIL?.trim();
  const audience = env.GCP_AUDIENCE?.trim() || undefined;

  const required = [projectNumber, poolId, providerId, serviceAccountEmail];
  const present = required.filter(Boolean).length;
  if (present === 0) return undefined;
  if (present < required.length) {
    throw new Error(
      'Неполная конфигурация Workload Identity Federation: задайте GCP_PROJECT_NUMBER, ' +
        'GCP_WORKLOAD_IDENTITY_POOL_ID, GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID и GCP_SERVICE_ACCOUNT_EMAIL.',
    );
  }
  return { projectNumber: projectNumber!, poolId: poolId!, providerId: providerId!, serviceAccountEmail: serviceAccountEmail!, audience };
}

/**
 * Загружает и валидирует конфигурацию Firebase из окружения.
 * Обязателен только идентификатор проекта; credentials опциональны (ADC/WIF).
 */
export function loadFirebaseEnv(env: NodeJS.ProcessEnv = process.env): FirebaseEnv {
  const projectId = (env.FIREBASE_PROJECT_ID ?? env.GCP_PROJECT_ID)?.trim();
  if (!projectId) {
    throw new Error('Не задан FIREBASE_PROJECT_ID (или GCP_PROJECT_ID) в окружении (.env).');
  }

  // Именованная БД. Дефолт '(default)'.
  const databaseId = env.FIRESTORE_DATABASE_ID?.trim() || '(default)';

  const rawServiceAccount = env.FIREBASE_SERVICE_ACCOUNT?.trim();
  const credentialsPath = env.GOOGLE_APPLICATION_CREDENTIALS?.trim() || undefined;

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

  const storageBucket = env.FIREBASE_STORAGE_BUCKET?.trim() || undefined;
  const wif = parseWif(env);

  return {
    projectId,
    databaseId,
    serviceAccount,
    credentialsPath: serviceAccount ? undefined : credentialsPath,
    storageBucket,
    wif,
  };
}
