// Limits, timings and ports shared by the hub and the web app.
export const LIMITS = {
  nameMax: 60,
  bodyMaxBytes: 64 * 1024,
  rateLimitPerMin: 60,
} as const;

export const TIMING = {
  healthTimeoutMs: 2000,
  backoffStartMs: 1000,
  backoffMaxMs: 30000,
  pollIntervalMs: 10000,
  wsAuthDeadlineMs: 5000,
  wsPingIntervalMs: 20000,
} as const;

export const PORTS = {
  https: 3443,
  setup: 8080,
} as const;
