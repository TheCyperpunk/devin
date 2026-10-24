// Calls to the hub. Phase 4 only needs pairing; the outbox sender arrives in Phase 5.
import type { ApiErrorBody, ErrorCode } from '@relief-mesh/shared';

export class ApiFail extends Error {
  /** `network` means the hub could not be reached at all (offline, wrong Wi-Fi, hub down). */
  constructor(
    public code: ErrorCode | 'network',
    message: string,
  ) {
    super(message);
  }
}

export interface PairResponse {
  deviceToken: string;
  deviceId: string;
  reporterName: string;
  hubId: string;
}

export async function pair(joinCode: string, deviceId: string, reporterName: string, timeoutMs = 8000): Promise<PairResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch('/api/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ joinCode, deviceId, reporterName }),
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiFail('network', 'Hub unreachable');
  } finally {
    clearTimeout(timer);
  }
  const body = (await res.json().catch(() => null)) as (PairResponse & Partial<ApiErrorBody>) | null;
  if (!res.ok) {
    throw new ApiFail(body?.error?.code ?? 'internal', body?.error?.message ?? `HTTP ${res.status}`);
  }
  return body as PairResponse;
}
