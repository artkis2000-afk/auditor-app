import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AuthError } from '../auth/index.js';
import { ServiceError, InvoiceServiceError } from '../services/index.js';
import { OcrError } from '../ai/index.js';

export interface MappedError {
  status: number;
  message: string;
}

function mapServiceCode(code: string): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'CONFLICT':
      return 409;
    case 'FORBIDDEN':
      return 403;
    case 'VALIDATION':
    case 'PIN_REQUIRED':
    case 'UNSUPPORTED':
      return 400;
    case 'PAYLOAD_TOO_LARGE':
      return 413;
    default:
      return 500;
  }
}

/** OCR-ошибки: image/not-found — клиентские (4xx), сбой провайдера — 502, прочее — 500. */
function mapOcrCode(code: string | undefined): number {
  switch (code) {
    case 'NOT_FOUND':
    case 'IMAGE_MISSING':
      return 404;
    case 'PROVIDER':
      return 502;
    default:
      return 500;
  }
}

function mapAuthCode(code: string): number {
  switch (code) {
    case 'MISSING_CREDENTIALS':
      return 400;
    case 'FORBIDDEN':
      return 403;
    case 'CONFIG':
      return 500;
    // USER_NOT_FOUND / INVALID_PASSWORD / TOKEN_INVALID / TOKEN_EXPIRED / UNAUTHORIZED
    default:
      return 401;
  }
}

/** Единый маппинг ошибок домена/сервисов/auth/валидации → HTTP-статус + безопасное сообщение. */
export function mapError(err: unknown): MappedError {
  if (err instanceof ZodError) {
    return { status: 400, message: 'Некорректные данные запроса' };
  }
  if (err instanceof AuthError) {
    return { status: mapAuthCode(err.code), message: err.message };
  }
  if (err instanceof ServiceError || err instanceof InvoiceServiceError) {
    return { status: mapServiceCode(err.code), message: err.message };
  }
  if (err instanceof OcrError) {
    return { status: mapOcrCode(err.code), message: err.message };
  }
  // Неизвестная ошибка (в т.ч. сбой хранилища) — не раскрываем детали/стек
  return { status: 500, message: 'Внутренняя ошибка сервера' };
}

/** Центральный обработчик ошибок Express. Формат ответа — {error: message}, как в legacy. */
export function errorHandler(): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    const { status, message } = mapError(err);
    res.status(status).json({ error: message });
  };
}
