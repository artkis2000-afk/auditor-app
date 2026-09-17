import type { RequestHandler } from 'express';
import type { ZodTypeAny, z } from 'zod';

/**
 * Валидация тела запроса по Zod-схеме. При ошибке — next(ZodError) → 400 в error handler.
 * При успехе req.body заменяется распарсенными (типизированными) данными.
 */
export function validateBody<S extends ZodTypeAny>(schema: S): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(result.error);
      return;
    }
    req.body = result.data as z.infer<S>;
    next();
  };
}

/**
 * Валидация query. Express 5 делает req.query доступным только для чтения,
 * поэтому результат кладётся в req.validatedQuery (типобезопасно на call-site).
 */
export function validateQuery<S extends ZodTypeAny>(schema: S): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(result.error);
      return;
    }
    (req as unknown as { validatedQuery: unknown }).validatedQuery = result.data;
    next();
  };
}
