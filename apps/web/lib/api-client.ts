// API client wrapper for the drawing management web app.
// Auto-includes credentials, parses JSON, and throws ApiError on non-2xx.

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(message: string, opts: { code?: string; status: number; details?: unknown }) {
    super(message);
    this.name = 'ApiError';
    this.code = opts.code ?? 'UNKNOWN';
    this.status = opts.status;
    this.details = opts.details;
  }
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

// `body` is widened to `unknown` so callers with their own request shape
// (e.g. CreateObjectBody) don't need a `Record<string, unknown>` cast at the
// call site. We only branch on FormData; everything else is JSON-stringified.
export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
}

function buildUrl(path: string, query?: ApiRequestOptions['query']) {
  const url = new URL(path.startsWith('http') ? path : `${API_BASE}${path}`, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export async function apiRequest<T = unknown>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { body, query, headers, ...rest } = options;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const init: RequestInit = {
    credentials: 'include',
    ...rest,
    headers: {
      Accept: 'application/json',
      ...(isForm ? {} : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(headers ?? {}),
    },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  };

  const res = await fetch(buildUrl(path, query), init);
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const errEnvelope = (parsed as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
    throw new ApiError(errEnvelope?.message ?? `Request failed (${res.status})`, {
      code: errEnvelope?.code,
      status: res.status,
      details: errEnvelope?.details,
    });
  }

  if (parsed && typeof parsed === 'object' && 'data' in (parsed as Record<string, unknown>)) {
    return (parsed as { data: T }).data;
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string, options?: ApiRequestOptions) => apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: ApiRequestOptions) => apiRequest<T>(path, { ...options, method: 'DELETE' }),
};
