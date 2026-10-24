// "5 min ago" style text from a timestamp, in the user's language.
import type { StringKey } from '@relief-mesh/shared';

type T = (key: StringKey, vars?: Record<string, string | number>) => string;

export function timeAgo(then: number, now: number, t: T): string {
  const min = Math.floor(Math.max(0, now - then) / 60_000);
  if (min < 1) return t('justNow');
  if (min < 60) return t('minutesAgo', { n: min });
  const h = Math.floor(min / 60);
  if (h < 48) return t('hoursAgo', { n: h });
  return t('daysAgo', { n: Math.floor(h / 24) });
}
