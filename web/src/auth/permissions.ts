import type { AuthUser } from '../types';

/**
 * Отображаемые права (UI affordance), зеркалят backend AuthorizationService.
 * Это НЕ enforcement — backend всё равно проверяет; здесь только показ/скрытие действий.
 */
export const perms = {
  canUpload: (u: AuthUser | null): boolean => u?.role === 'admin' || u?.role === 'manager',
  canConfirm: (u: AuthUser | null): boolean => u?.role === 'admin',
  canDelete: (u: AuthUser | null): boolean => u?.role === 'admin',
  // Ручной re-OCR (кнопка «Повторить OCR») — admin-only. Initial OCR для manager идёт server-side
  // внутри upload (legacy). Endpoint POST /:id/ocr — admin-only, поэтому кнопку видит только admin.
  canReOcr: (u: AuthUser | null): boolean => u?.role === 'admin',
  // Одобрять аномалии — только Владелец: role=admin И username != 'admin' (см. canApproveAnomaly).
  canApproveAnomaly: (u: AuthUser | null): boolean => u?.role === 'admin' && u.username !== 'admin',
};
