import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GoogleAuth } from 'google-auth-library';
import type { FirebaseEnv } from '../env.js';
import {
  resolveAuthMode,
  buildWifExternalAccountConfig,
  buildStorageAuthOptions,
  createGoogleCloudAuth,
  getGoogleCloudAuth,
  setGoogleCloudAuth,
  type GoogleCloudAuth,
  type SubjectTokenFetcher,
} from '../googleAuth.js';
import { AdminFirestoreGateway } from '../adminFirestoreGateway.js';
import { createFirebaseStorageGateway, FirebaseStorageGateway } from '../../storage/firebaseStorageGateway.js';

const wifEnv: FirebaseEnv = {
  projectId: 'zakupki-app-3207e',
  databaseId: 'zakupki-app-3207e',
  storageBucket: 'zakupki-app-3207e.firebasestorage.app',
  wif: {
    projectNumber: '773408576833',
    poolId: 'vercel',
    providerId: 'vercel',
    serviceAccountEmail: 'auditor-backend@zakupki-app-3207e.iam.gserviceaccount.com',
  },
};

const adcEnv: FirebaseEnv = { projectId: 'zakupki-app-3207e', databaseId: '(default)' };

const saEnv: FirebaseEnv = {
  projectId: 'p',
  databaseId: '(default)',
  serviceAccount: { client_email: 'svc@p.iam.gserviceaccount.com', private_key: 'PRIVATE_KEY_VALUE' },
};

/** Структурная форма external_account-конфига для утверждений в тесте. */
interface WifCfgShape {
  type: string;
  audience: string;
  subject_token_type: string;
  token_url: string;
  service_account_impersonation_url: string;
  subject_token_supplier: { getSubjectToken: SubjectTokenFetcher };
}

beforeEach(() => {
  setGoogleCloudAuth(null);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  setGoogleCloudAuth(null);
  vi.restoreAllMocks();
});

describe('resolveAuthMode (приоритет service_account → wif → adc)', () => {
  it('WIF-окружение → wif', () => {
    expect(resolveAuthMode(wifEnv)).toBe('wif');
  });
  it('без кредов → adc (local ADC path)', () => {
    expect(resolveAuthMode(adcEnv)).toBe('adc');
  });
  it('serviceAccount задан → service_account (имеет приоритет над WIF)', () => {
    expect(resolveAuthMode({ ...saEnv, wif: wifEnv.wif })).toBe('service_account');
  });
});

describe('buildWifExternalAccountConfig (Vercel WIF construction)', () => {
  it('строит верный external_account-конфиг с default-audience', () => {
    const cfg = buildWifExternalAccountConfig(wifEnv.wif!) as unknown as WifCfgShape;
    expect(cfg.type).toBe('external_account');
    expect(cfg.audience).toBe(
      '//iam.googleapis.com/projects/773408576833/locations/global/workloadIdentityPools/vercel/providers/vercel',
    );
    expect(cfg.subject_token_type).toBe('urn:ietf:params:oauth:token-type:jwt');
    expect(cfg.token_url).toBe('https://sts.googleapis.com/v1/token');
    expect(cfg.service_account_impersonation_url).toBe(
      'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/auditor-backend@zakupki-app-3207e.iam.gserviceaccount.com:generateAccessToken',
    );
  });

  it('уважает явный audience (allowed-audiences режим)', () => {
    const cfg = buildWifExternalAccountConfig({ ...wifEnv.wif!, audience: '//custom-audience' }) as unknown as WifCfgShape;
    expect(cfg.audience).toBe('//custom-audience');
  });

  it('subject_token_supplier делегирует инжектированному фетчеру (getVercelOidcToken не вызывается в тесте)', async () => {
    const fetcher: SubjectTokenFetcher = vi.fn(async () => 'FAKE_OIDC_TOKEN');
    const cfg = buildWifExternalAccountConfig(wifEnv.wif!, fetcher) as unknown as WifCfgShape;
    const token = await cfg.subject_token_supplier.getSubjectToken();
    expect(token).toBe('FAKE_OIDC_TOKEN');
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe('createGoogleCloudAuth', () => {
  it('WIF → mode wif, projectId, firestoreAuth это GoogleAuth (без service-account key)', () => {
    const auth = createGoogleCloudAuth(wifEnv);
    expect(auth.mode).toBe('wif');
    expect(auth.projectId).toBe('zakupki-app-3207e');
    expect(auth.firestoreAuth).toBeInstanceOf(GoogleAuth);
    // Keyless: никакого serviceAccount JSON в окружении.
    expect(wifEnv.serviceAccount).toBeUndefined();
  });

  it('ADC (local) → mode adc, firestoreAuth построен без кредов и без сети', () => {
    const auth = createGoogleCloudAuth(adcEnv);
    expect(auth.mode).toBe('adc');
    expect(auth.firestoreAuth).toBeInstanceOf(GoogleAuth);
    expect(adcEnv.serviceAccount).toBeUndefined();
  });

  it('service_account escape hatch → mode service_account', () => {
    const auth = createGoogleCloudAuth(saEnv);
    expect(auth.mode).toBe('service_account');
    expect(auth.firestoreAuth).toBeInstanceOf(GoogleAuth);
  });

  it('диагностический лог: режим + идентификаторы, без токенов/секретов (KI-prod)', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    createGoogleCloudAuth(wifEnv);
    expect(spy).toHaveBeenCalledOnce();
    const line = String(spy.mock.calls[0]?.[0] ?? '');
    expect(line).toContain('mode=wif');
    expect(line).toContain('projectId=zakupki-app-3207e');
    expect(line).toContain('poolId=vercel');
    expect(line).toContain('providerId=vercel');
    expect(line).toContain('serviceAccount=auditor-backend@zakupki-app-3207e.iam.gserviceaccount.com');
  });
});

describe('buildStorageAuthOptions (Storage строит клиент своей встроенной google-auth-library)', () => {
  it('WIF → projectId + external_account credentials (тот же конфиг, что у Firestore)', () => {
    const opts = buildStorageAuthOptions(wifEnv);
    expect(opts.projectId).toBe('zakupki-app-3207e');
    const creds = opts.credentials as unknown as WifCfgShape;
    expect(creds.type).toBe('external_account');
    expect(creds.audience).toBe(
      '//iam.googleapis.com/projects/773408576833/locations/global/workloadIdentityPools/vercel/providers/vercel',
    );
    expect(creds.service_account_impersonation_url).toContain('auditor-backend@zakupki-app-3207e.iam.gserviceaccount.com');
  });

  it('ADC → только projectId (credentials не задаётся)', () => {
    const opts = buildStorageAuthOptions(adcEnv);
    expect(opts.projectId).toBe('zakupki-app-3207e');
    expect(opts.credentials).toBeUndefined();
  });

  it('service_account → credentials {client_email, private_key}', () => {
    const opts = buildStorageAuthOptions(saEnv);
    expect(opts.credentials).toEqual({ client_email: 'svc@p.iam.gserviceaccount.com', private_key: 'PRIVATE_KEY_VALUE' });
  });
});

describe('getGoogleCloudAuth (единый auth на lifetime)', () => {
  it('возвращает один и тот же singleton', () => {
    const a = getGoogleCloudAuth(wifEnv);
    const b = getGoogleCloudAuth(wifEnv);
    expect(a).toBe(b);
  });

  it('setGoogleCloudAuth(null) сбрасывает — далее строится заново', () => {
    const a = getGoogleCloudAuth(wifEnv);
    setGoogleCloudAuth(null);
    const b = getGoogleCloudAuth(wifEnv);
    expect(a).not.toBe(b);
  });
});

describe('Firestore gateway получает auth client из общего адаптера', () => {
  it('AdminFirestoreGateway(WIF) конструируется без throw (нет firestore/invalid-credential) и читает firestoreAuth', () => {
    // Sentinel-auth: getter фиксирует, что gateway взял именно общий firestoreAuth.
    const real = createGoogleCloudAuth(wifEnv);
    let accessed = false;
    const sentinel: GoogleCloudAuth = {
      mode: 'wif',
      projectId: wifEnv.projectId,
      get firestoreAuth() {
        accessed = true;
        return real.firestoreAuth;
      },
    };
    setGoogleCloudAuth(sentinel);

    const gw = new AdminFirestoreGateway(wifEnv);
    expect(accessed).toBe(true);
    expect(typeof gw.getAll).toBe('function');
    expect(typeof gw.commitBatch).toBe('function');
  });

  it('AdminFirestoreGateway(ADC) конструируется без throw', () => {
    expect(() => new AdminFirestoreGateway(adcEnv)).not.toThrow();
  });
});

describe('Storage gateway получает auth из общего адаптера', () => {
  it('createFirebaseStorageGateway(WIF, bucket) → рабочий ImageStore (ленивая инициализация)', () => {
    const gw = createFirebaseStorageGateway(wifEnv, 'zakupki-app-3207e.firebasestorage.app');
    expect(gw).toBeInstanceOf(FirebaseStorageGateway);
    expect(typeof gw.put).toBe('function');
    expect(typeof gw.get).toBe('function');
    expect(typeof gw.delete).toBe('function');
  });
});
