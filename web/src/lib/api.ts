export interface ApiFailure {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(status: number, failure: ApiFailure) {
    super(failure.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = failure.code;
    this.details = failure.details;
  }
}

type Options = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
};

export async function api<T = any>(path: string, options: Options = {}): Promise<T> {
  const url = new URL(`/api${path}`, window.location.origin);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
  }
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: options.body === undefined ? { accept: 'application/json' } : { 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, {
      code: 'network_error',
      message: 'Could not reach the POMP NET CLOUD API. Check your connection and try again.',
    });
  }

  const text = await res.text();
  let payload: any = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!res.ok) {
    const failure: ApiFailure = payload?.error ?? {
      code: res.status === 401 ? 'unauthorized' : 'request_failed',
      message: payload?.message || `Request failed with status ${res.status}`,
    };
    if (res.status === 401) window.dispatchEvent(new CustomEvent('pn:unauthorized'));
    throw new ApiError(res.status, failure);
  }
  return (payload ?? {}) as T;
}

export const get = <T = any>(path: string, query?: Options['query']) => api<T>(path, { query });
export const post = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const patch = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unexpected error';
}

export function formatDate(value?: string | null, lang: 'fa' | 'en' = 'fa'): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function relativeTime(value?: string | null, lang: 'fa' | 'en' = 'fa'): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 365 * 24 * 3600_000],
    ['month', 30 * 24 * 3600_000],
    ['day', 24 * 3600_000],
    ['hour', 3600_000],
    ['minute', 60_000],
    ['second', 1000],
  ];
  const rtf = new Intl.RelativeTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-US', { numeric: 'auto' });
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === 'second') return rtf.format(Math.round(diff / ms), unit);
  }
  return '—';
}

export function duration(start?: string | null, end?: string | null): string {
  if (!start) return '—';
  const from = new Date(start).getTime();
  const to = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(from) || Number.isNaN(to)) return '—';
  const seconds = Math.max(0, Math.round((to - from) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${minutes}m ${rest}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
