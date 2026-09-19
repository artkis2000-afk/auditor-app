import {
  initializeApp,
  cert,
  applicationDefault,
  getApps,
  type App,
  type Credential,
  type ServiceAccount,
} from 'firebase-admin/app';
import { ExternalAccountClient } from 'google-auth-library';
import { getVercelOidcToken } from '@vercel/oidc';
import type { FirebaseEnv, WifConfig } from './env.js';

/**
 * Firebase Admin Credential поверх Vercel OIDC → GCP Workload Identity Federation.
 * Keyless: Vercel выдаёт короткоживущий OIDC-токен (VERCEL_OIDC_TOKEN), STS обменивает его
 * с impersonation dedicated service account. Приватный ключ не используется.
 */
function wifCredential(wif: WifConfig): Credential {
  const audience =
    wif.audience ??
    `//iam.googleapis.com/projects/${wif.projectNumber}/locations/global/workloadIdentityPools/${wif.poolId}/providers/${wif.providerId}`;
  const getSubjectToken = wif.audience
    ? () => getVercelOidcToken({ audience: wif.audience! })
    : () => getVercelOidcToken();

  const client = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${wif.serviceAccountEmail}:generateAccessToken`,
    subject_token_supplier: { getSubjectToken },
  });
  if (!client) throw new Error('Не удалось создать WIF-клиент (ExternalAccountClient).');

  return {
    getAccessToken: async () => {
      const { token } = await client.getAccessToken();
      if (!token) throw new Error('WIF: не удалось получить access token.');
      const expiryMs = client.credentials?.expiry_date ?? undefined;
      const expires_in = expiryMs ? Math.max(1, Math.floor((expiryMs - Date.now()) / 1000)) : 3600;
      return { access_token: token, expires_in };
    },
  };
}

/**
 * Единый выбор credential (keyless-first). Один провайдер и для Firestore, и для Storage:
 *  1. FIREBASE_SERVICE_ACCOUNT → cert (опциональный escape hatch);
 *  2. WIF (Vercel/production) → impersonation dedicated SA через OIDC;
 *  3. Application Default Credentials (local `gcloud ... application-default login`, metadata).
 */
function resolveCredential(env: FirebaseEnv): Credential {
  if (env.serviceAccount) return cert(env.serviceAccount as ServiceAccount);
  if (env.wif) return wifCredential(env.wif);
  return applicationDefault();
}

/**
 * Единая инициализация Firebase Admin App. И Firestore-gateway, и Storage-gateway
 * переиспользуют ОДНО именованное приложение с ОДНИМ credential — второй init/credential не создаётся.
 */
export function getAdminApp(env: FirebaseEnv): App {
  const appName = `fury-${env.projectId}`;
  const existing = getApps().find((a) => a.name === appName);
  if (existing) return existing;
  return initializeApp({ credential: resolveCredential(env), projectId: env.projectId }, appName);
}
