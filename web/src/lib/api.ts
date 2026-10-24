// Calls to the hub. Every failure becomes an ApiFail with the contract's error code, or 'network' when unreachable.
import type { ApiErrorBody, ErrorCode, PairResponse } from '@pralayam/shared';

export class ApiFail extends Error {
  constructor(
    /** `network` means the hub could not be reached at all (offline, wrong Wi-Fi, hub down). */
    public code: ErrorCode | 'network',
    message: string,
    /** Seconds to wait, from a 429's Retry-After header. */
    public retryAfterS?: number,
  ) {
    super(message);
  }
}

export interface HealthResponse {
  ok: true;
  time: number;
  hubId: string;
}

export async function request<T>(method: string, path: string, opts: { token?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      cache: 'no-store',
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiFail('network', 'Hub unreachable');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = (body as Partial<ApiErrorBody> | null)?.error;
    const retry = Number(res.headers.get('retry-after'));
    throw new ApiFail(err?.code ?? (res.status >= 500 ? 'internal' : 'invalid_body'), err?.message ?? `HTTP ${res.status}`, Number.isFinite(retry) && retry > 0 ? retry : undefined);
  }
  return body as T;
}

export const api = {
  health: (timeoutMs = 2000) => request<HealthResponse>('GET', '/api/health', { timeoutMs }),
  pair: (joinCode: string, deviceId: string, reporterName: string) =>
    request<PairResponse>('POST', '/api/pair', { body: { joinCode, deviceId, reporterName }, timeoutMs: 8000 }),
};
export type Api = typeof api;
