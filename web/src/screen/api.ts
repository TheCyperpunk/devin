// Big-screen calls: the coordinator session (host) reads the game and drives it (GAME-CONTRACT section 5, host).
import type { GameView } from '@pralayam/shared';
import { request } from '../lib/api.js';
import type { JoinInfo } from '@pralayam/shared';

export type StateResponse = { view: GameView } | { unchanged: true; revision: number; serverTime: number };
export type HostAction = 'start' | 'pause' | 'resume' | 'skip' | 'end';
export interface NewGameBody {
  roundSeconds?: 30 | 45 | 60;
  bots?: boolean;
}

export const screenApi = {
  login: (passcode: string) => request<{ sessionToken: string }>('POST', '/api/host/login', { body: { passcode }, timeoutMs: 8000 }),
  state: (token: string, after: number) => request<StateResponse>('GET', `/api/game/state?after=${after}`, { token }),
  join: (token: string) => request<JoinInfo>('GET', '/api/host/join', { token }),
  newGame: (token: string, body: NewGameBody) => request<{ view: GameView }>('POST', '/api/game/new', { token, body }),
  host: (token: string, action: HostAction) => request<{ view: GameView }>('POST', `/api/game/${action}`, { token }),
};
export type ScreenApi = typeof screenApi;
