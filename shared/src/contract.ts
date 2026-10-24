// The API contract as code (docs/CONTRACT.md sections 2-6): report types and strict zod request schemas.
import { z } from 'zod';
import { LIMITS } from './constants.js';
import type { GameEvent, GameView } from './game/contract.js';

export const NEED_TYPES = ['food', 'water', 'medical', 'rescue', 'shelter'] as const;
export type NeedType = (typeof NEED_TYPES)[number];

export const STATUSES = ['open', 'assigned', 'done'] as const;
export type Status = (typeof STATUSES)[number];

/** A report as the hub stores it and sends it to clients (CONTRACT 2.2). */
export interface Report {
  id: string;
  deviceId: string;
  reporterName: string;
  needs: NeedType[];
  peopleCount: number;
  hasChildren: boolean;
  hasElderlyOrSick: boolean;
  urgent: boolean;
  note: string | null;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  receivedAt: number;
  reportedAt: number;
  updatedAt: number;
  revision: number;
  status: Status;
  assignee: string | null;
  baseScore: number;
}

export type CloudStatus =
  | { state: 'not_configured' }
  | { state: 'offline'; pending: number; lastSyncAt: number | null }
  | { state: 'syncing'; pending: number; lastSyncAt: number | null }
  | { state: 'synced'; total: number; lastSyncAt: number };

export interface Stats {
  open: number;
  assigned: number;
  done: number;
}

export type ErrorCode =
  | 'invalid_body'
  | 'unauthorized'
  | 'forbidden'
  | 'bad_join_code'
  | 'not_found'
  | 'conflict'
  | 'too_large'
  | 'rate_limited'
  | 'internal'
  // game (GAME-CONTRACT section 5)
  | 'no_game'
  | 'game_over'
  | 'not_joined';

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
}

// ---------- request schemas ----------

const reporterName = z.string().trim().min(1).max(LIMITS.reporterNameMax);
const note = z
  .string()
  .trim()
  .max(LIMITS.noteMax)
  .transform((s) => (s === '' ? undefined : s));

/** Phone -> hub. Strict: any hub-owned field (status, assignee, deviceId, ...) is rejected (D5). */
export const PhoneReportInputSchema = z
  .strictObject({
    id: z.uuidv4(),
    needs: z
      .array(z.enum(NEED_TYPES))
      .min(1)
      .max(NEED_TYPES.length)
      .refine((a) => new Set(a).size === a.length, 'needs must be unique'),
    peopleCount: z.number().int().min(LIMITS.peopleCount[0]).max(LIMITS.peopleCount[1]),
    hasChildren: z.boolean(),
    hasElderlyOrSick: z.boolean(),
    urgent: z.boolean(),
    note: note.optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    accuracyM: z.number().min(0).max(100_000).optional(),
    ageMs: z.number().int().min(0),
  })
  .superRefine((v, ctx) => {
    if ((v.lat === undefined) !== (v.lng === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'lat and lng must be given together', path: ['lat'] });
    }
    if (v.accuracyM !== undefined && v.lat === undefined) {
      ctx.addIssue({ code: 'custom', message: 'accuracyM needs lat and lng', path: ['accuracyM'] });
    }
  });
export type PhoneReportInput = z.infer<typeof PhoneReportInputSchema>;

export const PairRequestSchema = z.strictObject({
  joinCode: z.string().trim().min(1).max(32),
  deviceId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'deviceId must be 8-64 letters, digits, - or _'),
  reporterName,
});
export type PairRequest = z.infer<typeof PairRequestSchema>;

export const LoginRequestSchema = z.strictObject({
  passcode: z.string().min(1).max(200),
});

/** Batch envelope only; each report inside is validated one by one so one bad item never blocks the rest. */
export const BatchEnvelopeSchema = z.strictObject({
  reports: z.array(z.unknown()).min(1),
});

export const PatchReportSchema = z
  .strictObject({
    status: z.enum(STATUSES).optional(),
    assignee: z.string().trim().max(LIMITS.assigneeMax).nullable().optional(),
    note: z.string().trim().max(LIMITS.noteMax).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'give at least one of status, assignee, note');
export type PatchReport = z.infer<typeof PatchReportSchema>;

export type BatchItemResult =
  | { id: string; result: 'created' | 'duplicate'; report: Report }
  | { id: string; result: 'conflict' | 'invalid'; message?: string };

export type ClientMessage = { type: 'auth'; payload: { token: string } };

export type ServerMessage =
  | { type: 'auth:ok'; payload: { role: 'device' | 'coordinator'; serverTime: number } }
  | { type: 'report:upserted'; payload: { report: Report } }
  | { type: 'stats'; payload: Stats }
  | { type: 'cloud:status'; payload: CloudStatus }
  // game (GAME-CONTRACT section 6)
  | { type: 'game:state'; payload: { view: GameView } }
  | { type: 'game:round'; payload: GameRoundPayload }
  | { type: 'game:you'; payload: { boatId: string; queued: number; nextSeq: number } };

export interface GameRoundPayload {
  round: number;
  events: GameEvent[];
  scoreAfter: number;
  waterLevel: number;
}
