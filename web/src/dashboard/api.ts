// Coordinator calls (CONTRACT section 5, "Coordinator"). All but login carry the session token.
import type { CloudStatus, PatchReport, Report, Stats } from '@relief-mesh/shared';
import { request, type ReportsPage } from '../lib/api.js';

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
};

export type DashApi = typeof dashApi;
