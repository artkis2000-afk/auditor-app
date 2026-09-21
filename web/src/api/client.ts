import { getCurrentIdToken } from '../firebase';
import type {
  AuthUser,
  DashboardStats,
  DashboardPeriodQuery,
  InvoiceListEntry,
  InvoiceDetail,
  Vehicle,
  InvoiceStatus,
} from '../types';

export interface UploadResponse {
  success: boolean;
  invoiceId: string;
  status: string;
}
export interface OcrOutcome {
  status: string;
  itemsCount: number;
  fallback: boolean;
  error?: string;
}
export interface ConfirmResponse {
  success: boolean;
  status: string;
  flagsCount: number;
  flags: unknown[];
}
export interface InvoicesListParams {
  status?: InvoiceStatus;
  supplierId?: string;
}

/** Ошибка API: несёт HTTP-статус и человекочитаемое сообщение (из {error}). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || '/api';

// Централизованная реакция на 401 (регистрируется AuthProvider'ом).
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getCurrentIdToken();
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'Нет связи с сервером. Проверьте подключение и попробуйте снова.');
  }

  if (res.status === 401) {
    if (onUnauthorized) onUnauthorized();
    throw new ApiError(401, await extractError(res, 'Сессия истекла. Войдите снова.'));
  }
  if (!res.ok) {
    throw new ApiError(res.status, await extractError(res, 'Ошибка сервера. Попробуйте позже.'));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function extractError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown };
    if (data && typeof data.error === 'string' && data.error.trim()) return data.error;
  } catch {
    /* тело не JSON */
  }
  return fallback;
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const api = {
  me(): Promise<{ user: AuthUser }> {
    return request<{ user: AuthUser }>('/auth/me');
  },
  dashboardStats(period: DashboardPeriodQuery = { periodType: 'all' }): Promise<DashboardStats> {
    return request<DashboardStats>(`/dashboard/stats${toQuery(period as Record<string, string | number | undefined>)}`);
  },

  // --- invoices ---
  invoicesList(params: InvoicesListParams = {}): Promise<InvoiceListEntry[]> {
    return request<InvoiceListEntry[]>(`/invoices${toQuery(params as Record<string, string | undefined>)}`);
  },
  invoiceDetail(id: string): Promise<InvoiceDetail> {
    return request<InvoiceDetail>(`/invoices/${encodeURIComponent(id)}`);
  },
  invoiceUpload(payload: { name?: string; type: string; base64: string }): Promise<UploadResponse> {
    return request<UploadResponse>('/invoices/upload', { method: 'POST', body: JSON.stringify(payload) });
  },
  invoiceOcr(id: string): Promise<OcrOutcome> {
    return request<OcrOutcome>(`/invoices/${encodeURIComponent(id)}/ocr`, { method: 'POST' });
  },
  invoiceConfirm(id: string): Promise<ConfirmResponse> {
    return request<ConfirmResponse>(`/invoices/${encodeURIComponent(id)}/confirm`, { method: 'POST' });
  },
  invoiceDelete(id: string): Promise<{ success: true }> {
    return request<{ success: true }>(`/invoices/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  invoiceApproveAllFlags(id: string): Promise<{ success: true; status: string; flags: unknown[] }> {
    return request(`/invoices/${encodeURIComponent(id)}/approve-all-flags`, { method: 'POST' });
  },

  /** Оригинал изображения как Blob (с Bearer-заголовком; <img src> его отдать не может). */
  async invoiceImageBlob(id: string): Promise<Blob> {
    const token = await getCurrentIdToken();
    const headers = new Headers();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/invoices/${encodeURIComponent(id)}/image`, { headers });
    } catch {
      throw new ApiError(0, 'Нет связи с сервером.');
    }
    if (res.status === 401) {
      if (onUnauthorized) onUnauthorized();
      throw new ApiError(401, 'Сессия истекла. Войдите снова.');
    }
    if (!res.ok) throw new ApiError(res.status, await extractError(res, 'Не удалось загрузить изображение.'));
    return res.blob();
  },

  // --- vehicles (для отображения имён ТС в позициях) ---
  vehiclesList(): Promise<Vehicle[]> {
    return request<Vehicle[]>('/vehicles');
  },
};
