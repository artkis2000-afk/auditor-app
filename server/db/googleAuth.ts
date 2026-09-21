import { GoogleAuth, ExternalAccountClient, type ExternalAccountClientOptions } from 'google-auth-library';
import { getVercelOidcToken } from '@vercel/oidc';
import type { FirebaseEnv, WifConfig } from './env.js';

/**
 * ЕДИНЫЙ server-side Google Cloud auth-адаптер (keyless). Одна абстракция и один общий
 * конфиг для Firestore и Storage. Приватный ключ сервис-аккаунта НЕ используется.
 *
 * Три режима (приоритет как в legacy): FIREBASE_SERVICE_ACCOUNT → WIF → ADC.
 *  - service_account: escape hatch (JSON строкой в env), credentials {client_email, private_key};
 *  - wif (Vercel/production): Vercel OIDC → STS → impersonation dedicated SA (external_account);
 *  - adc (local): gcloud auth application-default login [--impersonate-service-account=...].
 *
 * ВАЖНО про версии клиентских библиотек (почему credential для Firestore и Storage строится
 * из ОДНОГО конфига, но КАЖДЫЙ своей библиотекой, а не переиспускается один и тот же объект):
 *   - @google-cloud/firestore → google-gax → google-auth-library v11 → gaxios v7 (WHATWG Headers);
 *   - @google-cloud/storage@8   → встроенная google-auth-library v9   → gaxios v6 (plain-object Headers).
 * Storage внутри делает Object.assign(reqOpts.headers, authHeaders), рассчитывая на plain-object.
 * Если передать в Storage v11-клиент (Headers как WHATWG-объект) — заголовок Authorization
 * потеряется и запросы уйдут неаутентифицированными (401). Поэтому Storage получает external_account
 * КОНФИГ (credentials) и строит клиент своей встроенной библиотекой — версионно-корректно.
 * Общими остаются: конфиг (buildWifExternalAccountConfig) и supplier OIDC-токена (getVercelOidcToken).
 */

/** Scope для impersonated access token: покрывает и Firestore, и Storage. */
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

export type AuthMode = 'service_account' | 'wif' | 'adc';

/** Фетчер subject-токена (Vercel OIDC). Инъекция — для тестов без реального Vercel. */
export type SubjectTokenFetcher = () => Promise<string>;

/** Разобранные креды сервис-аккаунта (escape hatch FIREBASE_SERVICE_ACCOUNT). */
interface ServiceAccountCreds {
  client_email: string;
  private_key: string;
}

/** Опции для конструктора @google-cloud/storage (строится его встроенной google-auth-library). */
export interface StorageAuthOptions {
  projectId: string;
  /** external_account-конфиг (WIF) или {client_email, private_key} (SA). Пусто → ADC. */
  credentials?: ExternalAccountClientOptions | ServiceAccountCreds;
}

/** Готовый auth для обоих потребителей (единая точка инициализации + диагностика). */
export interface GoogleCloudAuth {
  readonly mode: AuthMode;
  readonly projectId: string;
  /** Для @google-cloud/firestore: передаётся в Settings.auth (google-gax ждёт GoogleAuth). */
  readonly firestoreAuth: GoogleAuth;
}

function serviceAccountCreds(env: FirebaseEnv): ServiceAccountCreds | null {
  const sa = env.serviceAccount;
  if (sa && typeof sa.client_email === 'string' && typeof sa.private_key === 'string') {
    return { client_email: sa.client_email, private_key: sa.private_key };
  }
  return null;
}

/** Определяет режим аутентификации по окружению (порядок как в legacy resolveCredential). */
export function resolveAuthMode(env: FirebaseEnv): AuthMode {
  if (serviceAccountCreds(env)) return 'service_account';
  if (env.wif) return 'wif';
  return 'adc';
}

/**
 * Строит external_account-конфиг (Vercel OIDC → STS → impersonation SA). Чистая функция —
 * тестируется без секретов и без сети. Subject-токен берётся supplier'ом ПРИ КАЖДОМ обмене
 * с STS (getVercelOidcToken с refresh) — сырой OIDC-токен не кешируется как вечный секрет.
 */
export function buildWifExternalAccountConfig(
  wif: WifConfig,
  fetchSubjectToken?: SubjectTokenFetcher,
): ExternalAccountClientOptions {
  const audience =
    wif.audience ??
    `//iam.googleapis.com/projects/${wif.projectNumber}/locations/global/workloadIdentityPools/${wif.poolId}/providers/${wif.providerId}`;
  const getSubjectToken: SubjectTokenFetcher =
    fetchSubjectToken ??
    (wif.audience ? () => getVercelOidcToken({ audience: wif.audience! }) : () => getVercelOidcToken());

  return {
    type: 'external_account',
    audience,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${wif.serviceAccountEmail}:generateAccessToken`,
    subject_token_supplier: { getSubjectToken },
  };
}

/** GoogleAuth для Firestore (v11): SA → WIF → ADC. */
function buildFirestoreAuth(env: FirebaseEnv, mode: AuthMode): GoogleAuth {
  if (mode === 'service_account') {
    const creds = serviceAccountCreds(env)!;
    return new GoogleAuth({ projectId: env.projectId, scopes: [CLOUD_PLATFORM_SCOPE], credentials: creds });
  }
  if (mode === 'wif') {
    const client = ExternalAccountClient.fromJSON(buildWifExternalAccountConfig(env.wif!));
    if (!client) throw new Error('Не удалось создать WIF-клиент (ExternalAccountClient).');
    client.scopes = [CLOUD_PLATFORM_SCOPE];
    return new GoogleAuth({ authClient: client, projectId: env.projectId, scopes: [CLOUD_PLATFORM_SCOPE] });
  }
  // ADC: gcloud application-default (в т.ч. с impersonation) / metadata. Ключи не нужны.
  return new GoogleAuth({ projectId: env.projectId, scopes: [CLOUD_PLATFORM_SCOPE] });
}

/**
 * Опции credentials для @google-cloud/storage из того же окружения/конфига.
 * Storage строит клиент СВОЕЙ встроенной google-auth-library (см. заметку о версиях выше).
 */
export function buildStorageAuthOptions(env: FirebaseEnv): StorageAuthOptions {
  const mode = resolveAuthMode(env);
  if (mode === 'service_account') return { projectId: env.projectId, credentials: serviceAccountCreds(env)! };
  if (mode === 'wif') return { projectId: env.projectId, credentials: buildWifExternalAccountConfig(env.wif!) };
  return { projectId: env.projectId }; // ADC
}

/**
 * Диагностика для server-логов (Vercel): режим + идентификаторы конфигурации.
 * БЕЗ токенов/секретов/приватных ключей.
 */
function logAuthMode(mode: AuthMode, env: FirebaseEnv): void {
  const parts = [`mode=${mode}`, `projectId=${env.projectId}`, `databaseId=${env.databaseId}`];
  if (env.wif) {
    parts.push(`poolId=${env.wif.poolId}`, `providerId=${env.wif.providerId}`, `serviceAccount=${env.wif.serviceAccountEmail}`);
  } else if (mode === 'service_account') {
    const creds = serviceAccountCreds(env);
    if (creds) parts.push(`serviceAccount=${creds.client_email}`);
  }
  console.info(`[gcp-auth] ${parts.join(' ')}`);
}

/** Собирает GoogleCloudAuth (Firestore) и логирует выбранный режим. */
export function createGoogleCloudAuth(env: FirebaseEnv): GoogleCloudAuth {
  const mode = resolveAuthMode(env);
  const firestoreAuth = buildFirestoreAuth(env, mode);
  logAuthMode(mode, env);
  return { mode, projectId: env.projectId, firestoreAuth };
}

let singleton: GoogleCloudAuth | null = null;

/** Единый auth на весь lifetime процесса/инстанса Vercel-функции (общий для Firestore и Storage). */
export function getGoogleCloudAuth(env: FirebaseEnv): GoogleCloudAuth {
  if (!singleton) singleton = createGoogleCloudAuth(env);
  return singleton;
}

/** Для тестов/переинициализации: подменить или сбросить singleton. */
export function setGoogleCloudAuth(auth: GoogleCloudAuth | null): void {
  singleton = auth;
}
