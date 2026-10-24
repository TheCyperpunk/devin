// Coordinator calls (CONTRACT section 5, "Coordinator"). All but login carry the session token.
import type { ApiErrorBody, CloudStatus, PatchReport, Report, Stats } from '@relief-mesh/shared';
import { ApiFail, request, type ReportsPage } from '../lib/api.js';

export interface JoinInfo {
  joinUrl: string;
  joinCode: string;
  qrDataUrl: string;
}

export const dashApi = {
  login: (passcode: string) =>
    request<{ sessionToken: string }>('POST', '/api/dashboard/login', { body: { passcode }, timeoutMs: 8000 }),
  reports: (token: string, after: number) => request<ReportsPage>('GET', `/api/dashboard/reports?after=${after}`, { token }),
  patch: (token: string, id: string, body: PatchReport) =>
    request<{ report: Report }>('PATCH', `/api/dashboard/reports/${encodeURIComponent(id)}`, { token, body }),
  stats: (token: string) => request<Stats & { cloud: CloudStatus }>('GET', '/api/dashboard/stats', { token }),
  join: (token: string) => request<JoinInfo>('GET', '/api/dashboard/join', { token }),
  rotateJoin: (token: string) => request<JoinInfo>('POST', '/api/dashboard/join/rotate', { token }),
  exportDb,
};

/** The whole hub database as a file, plus the filename the hub suggests. Binary, so not through request(). */
async function exportDb(token: string): Promise<{ blob: Blob; filename: string }> {
  let res: Response;
  try {
    res = await fetch('/api/dashboard/export', { cache: 'no-store', headers: { authorization: `Bearer ${token}` } });
  } catch {
    throw new ApiFail('network', 'Hub unreachable');
  }
  if (!res.ok) {
    let err: ApiErrorBody['error'] | undefined;
    try {
      err = ((await res.json()) as Partial<ApiErrorBody>).error;
    } catch {
      err = undefined;
    }
    throw new ApiFail(err?.code ?? 'internal', err?.message ?? `HTTP ${res.status}`);
  }
  const m = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') ?? '');
  return { blob: await res.blob(), filename: m?.[1] ?? 'relief-hub.db' };
}

export type DashApi = typeof dashApi;
