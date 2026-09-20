import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { corsMiddleware } from '../cors.js';

function run(origins: string[], reqInit: { origin?: string; method?: string }) {
  const headers: Record<string, string> = {};
  const state = { status: 0, ended: false };
  const resLike = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    status: (c: number) => {
      state.status = c;
      return resLike;
    },
    end: () => {
      state.ended = true;
    },
  };
  const res = resLike as unknown as Response;
  const req = { headers: { origin: reqInit.origin }, method: reqInit.method ?? 'GET' } as unknown as Request;
  const next = vi.fn();
  corsMiddleware(origins)(req, res, next);
  return { headers, state, next };
}

describe('corsMiddleware', () => {
  it('разрешённый origin → отражается в Access-Control-Allow-Origin, next()', () => {
    const { headers, next } = run(['https://auditor-web.vercel.app'], { origin: 'https://auditor-web.vercel.app' });
    expect(headers['Access-Control-Allow-Origin']).toBe('https://auditor-web.vercel.app');
    expect(headers['Access-Control-Allow-Headers']).toContain('Authorization');
    expect(next).toHaveBeenCalled();
  });

  it('чужой origin → без ACAO-заголовка, next()', () => {
    const { headers, next } = run(['https://auditor-web.vercel.app'], { origin: 'https://evil.example.com' });
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('wildcard-шаблон покрывает preview-домены', () => {
    const { headers } = run(['https://auditor-web-*.vercel.app'], { origin: 'https://auditor-web-git-feature.vercel.app' });
    expect(headers['Access-Control-Allow-Origin']).toBe('https://auditor-web-git-feature.vercel.app');
  });

  it('OPTIONS preflight от разрешённого origin → 204 и завершение без next()', () => {
    const { state, next } = run(['https://auditor-web.vercel.app'], { origin: 'https://auditor-web.vercel.app', method: 'OPTIONS' });
    expect(state.status).toBe(204);
    expect(state.ended).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });
});
