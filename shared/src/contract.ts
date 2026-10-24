// The hub's API contract as code: error codes, the two public request schemas (pair, host login), WebSocket messages.
// Game shapes live in game/contract.ts.
import { z } from 'zod';
import { LIMITS } from './constants.js';
import type { GameEvent, GameView } from './game/contract.js';

/** What a call can ask for. Shared by the urgency score and the game's calls. */
export const NEED_TYPES = ['food', 'water', 'medical', 'rescue', 'shelter'] as const;
export type NeedType = (typeof NEED_TYPES)[number];

export type ErrorCode =
  | 'invalid_body'
  | 'unauthorized'
  | 'forbidden'
  | 'bad_join_code'
  | 'not_found'
  | 'too_large'
  | 'rate_limited'
  | 'internal'
  | 'no_game'
  | 'game_over'
  | 'not_joined';

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
}

const crewName = z.string().trim().min(1).max(LIMITS.nameMax);

/** Phone -> hub, once: the join code from the big screen, this phone's id, the crew's name. */
export const PairRequestSchema = z.strictObject({
  joinCode: z.string().trim().min(1).max(32),
  deviceId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'deviceId must be 8-64 letters, digits, - or _'),
  reporterName: crewName,
});
export type PairRequest = z.infer<typeof PairRequestSchema>;

export interface PairResponse {
  deviceToken: string;
  deviceId: string;
  reporterName: string;
  hubId: string;
}

export const LoginRequestSchema = z.strictObject({
  passcode: z.string().min(1).max(200),
});

export interface JoinInfo {
  joinUrl: string;
  joinCode: string;
  qrDataUrl: string;
}

export type ClientMessage = { type: 'auth'; payload: { token: string } };

export type ServerMessage =
  | { type: 'auth:ok'; payload: { role: 'device' | 'coordinator'; serverTime: number } }
  | { type: 'game:state'; payload: { view: GameView } }
  | { type: 'game:round'; payload: GameRoundPayload }
  | { type: 'game:you'; payload: { boatId: string; queued: number; nextSeq: number } };

export interface GameRoundPayload {
  round: number;
  events: GameEvent[];
  scoreAfter: number;
  waterLevel: number;
}
