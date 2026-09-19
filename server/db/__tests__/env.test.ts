import { describe, it, expect } from 'vitest';
import { loadFirebaseEnv } from '../env.js';

const SA = JSON.stringify({ project_id: 'zakupki-auditor', client_email: 'a@b.iam', private_key: 'KEY' });

describe('loadFirebaseEnv', () => {
  it('бросает ошибку без FIREBASE_PROJECT_ID', () => {
    expect(() => loadFirebaseEnv({ FIREBASE_SERVICE_ACCOUNT: SA } as NodeJS.ProcessEnv)).toThrow(/FIREBASE_PROJECT_ID/);
  });

  it('без креденшелов НЕ бросает (keyless: ADC/WIF); serviceAccount не задан', () => {
    const env = loadFirebaseEnv({ FIREBASE_PROJECT_ID: 'p' } as NodeJS.ProcessEnv);
    expect(env.projectId).toBe('p');
    expect(env.serviceAccount).toBeUndefined();
    expect(env.wif).toBeUndefined();
  });

  it('принимает GCP_PROJECT_ID как алиас FIREBASE_PROJECT_ID', () => {
    const env = loadFirebaseEnv({ GCP_PROJECT_ID: 'gcp-proj' } as NodeJS.ProcessEnv);
    expect(env.projectId).toBe('gcp-proj');
  });

  it('полные GCP_* → env.wif заполнен', () => {
    const env = loadFirebaseEnv({
      FIREBASE_PROJECT_ID: 'p',
      GCP_PROJECT_NUMBER: '1234567890',
      GCP_WORKLOAD_IDENTITY_POOL_ID: 'vercel',
      GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: 'vercel',
      GCP_SERVICE_ACCOUNT_EMAIL: 'auditor-backend@p.iam.gserviceaccount.com',
    } as NodeJS.ProcessEnv);
    expect(env.wif).toEqual({
      projectNumber: '1234567890',
      poolId: 'vercel',
      providerId: 'vercel',
      serviceAccountEmail: 'auditor-backend@p.iam.gserviceaccount.com',
      audience: undefined,
    });
  });

  it('неполные GCP_* → ошибка конфигурации WIF', () => {
    expect(() =>
      loadFirebaseEnv({
        FIREBASE_PROJECT_ID: 'p',
        GCP_PROJECT_NUMBER: '123',
        GCP_WORKLOAD_IDENTITY_POOL_ID: 'vercel',
      } as NodeJS.ProcessEnv),
    ).toThrow(/Workload Identity Federation/i);
  });

  it('парсит FIREBASE_SERVICE_ACCOUNT и дефолтит databaseId', () => {
    const env = loadFirebaseEnv({ FIREBASE_PROJECT_ID: 'zakupki-auditor', FIREBASE_SERVICE_ACCOUNT: SA } as NodeJS.ProcessEnv);
    expect(env.projectId).toBe('zakupki-auditor');
    expect(env.databaseId).toBe('(default)');
    expect(env.serviceAccount?.client_email).toBe('a@b.iam');
    expect(env.credentialsPath).toBeUndefined();
  });

  it('уважает FIRESTORE_DATABASE_ID', () => {
    const env = loadFirebaseEnv({
      FIREBASE_PROJECT_ID: 'p',
      FIREBASE_SERVICE_ACCOUNT: SA,
      FIRESTORE_DATABASE_ID: 'ai-studio-527e',
    } as NodeJS.ProcessEnv);
    expect(env.databaseId).toBe('ai-studio-527e');
  });

  it('некорректный JSON сервисного аккаунта → ошибка', () => {
    expect(() =>
      loadFirebaseEnv({ FIREBASE_PROJECT_ID: 'p', FIREBASE_SERVICE_ACCOUNT: '{not json' } as NodeJS.ProcessEnv),
    ).toThrow(/некорректный JSON/i);
  });

  it('путь GOOGLE_APPLICATION_CREDENTIALS без SA → credentialsPath', () => {
    const env = loadFirebaseEnv({
      FIREBASE_PROJECT_ID: 'p',
      GOOGLE_APPLICATION_CREDENTIALS: '/path/sa.json',
    } as NodeJS.ProcessEnv);
    expect(env.credentialsPath).toBe('/path/sa.json');
    expect(env.serviceAccount).toBeUndefined();
  });
});
