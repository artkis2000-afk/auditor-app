import type { AuthUser, LoginResponse, DashboardStats, DashboardPeriodQuery } from '../types';

/** Единый ключ токена (совместимо с legacy). */
const TOKEN_KEY = 'auditor_token';

export const tokenStorage = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* ignore (private mode) */
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

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
  const token = tokenStorage.get();
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
  login(username: string, password: string): Promise<LoginResponse> {
    return request<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  },
  me(): Promise<{ user: AuthUser }> {
    return request<{ user: AuthUser }>('/auth/me');
  },
  dashboardStats(period: DashboardPeriodQuery = { periodType: 'all' }): Promise<DashboardStats> {
    return request<DashboardStats>(`/dashboard/stats${toQuery(period as Record<string, string | number | undefined>)}`);
  },
};
