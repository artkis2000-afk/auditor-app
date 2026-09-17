import { describe, it, expect } from 'vitest';
import { loadFirebaseEnv } from '../env.js';

const SA = JSON.stringify({ project_id: 'zakupki-auditor', client_email: 'a@b.iam', private_key: 'KEY' });

describe('loadFirebaseEnv', () => {
  it('бросает ошибку без FIREBASE_PROJECT_ID', () => {
    expect(() => loadFirebaseEnv({ FIREBASE_SERVICE_ACCOUNT: SA } as NodeJS.ProcessEnv)).toThrow(/FIREBASE_PROJECT_ID/);
  });

  it('бросает ошибку без креденшелов (нет SA и нет пути)', () => {
    expect(() => loadFirebaseEnv({ FIREBASE_PROJECT_ID: 'p' } as NodeJS.ProcessEnv)).toThrow(/креденшелы/i);
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
