// Shared constants used by both the hub and the web app. Phase 2 adds contract.ts (zod schemas) here.
export const LIMITS = {
  peopleCount: [1, 500] as const,
  noteMax: 280,
  reporterNameMax: 60,
  assigneeMax: 60,
  batchMax: 50,
  bodyMaxBytes: 64 * 1024,
  ageMsMax: 48 * 60 * 60 * 1000,
  rateLimitPerMin: 60,
} as const;

export const TIMING = {
  healthTimeoutMs: 2000,
  gpsTimeoutMs: 5000,
  backoffStartMs: 1000,
  backoffMaxMs: 30000,
  pollIntervalMs: 10000,
  wsAuthDeadlineMs: 5000,
  wsPingIntervalMs: 20000,
  cloudCheckIntervalMs: 10000,
} as const;

export const PORTS = {
  https: 3443,
  setup: 8080,
} as const;
