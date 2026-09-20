import type { RequestHandler } from 'express';

/**
 * Минимальный CORS без сторонних зависимостей. Разрешает ТОЛЬКО origin из allowlist (WEB_ORIGIN):
 * точное совпадение или шаблон с '*' (для preview-доменов Vercel, напр. https://auditor-web-*.vercel.app).
 * Аутентификация — Bearer-токен (не cookie), поэтому Allow-Credentials не выставляется.
 * '*' как значение НЕ используется — origin отражается только если он в allowlist.
 */
function toMatcher(pattern: string): (origin: string) => boolean {
  if (!pattern.includes('*')) return (o) => o === pattern;
  const re = new RegExp('^' + pattern.split('*').map(escapeRe).join('.*') + '$');
  return (o) => re.test(o);
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function corsMiddleware(origins: string[]): RequestHandler {
  const matchers = origins.map(toMatcher);
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && matchers.some((m) => m(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Pin');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}
