// Small formatting helpers for the dashboard (English only: the coordinator sits at the laptop).
import type { NeedType, Report } from '@relief-mesh/shared';

export const NEED_LABEL: Record<NeedType, string> = {
  food: 'Food',
  water: 'Water',
  medical: 'Medical',
  rescue: 'Rescue',
  shelter: 'Shelter',
};
export const NEED_ICON: Record<NeedType, string> = { food: '🍚', water: '💧', medical: '🩺', rescue: '🛟', shelter: '🏠' };

export function ago(then: number, now: number): string {
  const min = Math.floor(Math.max(0, now - then) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${min % 60} min ago`;
  return `${Math.floor(h / 24)} d ago`;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export const clock = (t: number) => timeFmt.format(t);
export const dateTime = (t: number) => dateTimeFmt.format(t);

export function flags(r: Report): string[] {
  const out: string[] = [];
  if (r.urgent) out.push('Urgent');
  if (r.hasChildren) out.push('Children');
  if (r.hasElderlyOrSick) out.push('Elderly/sick');
  return out;
}

export function statusLabel(r: Report): string {
  if (r.status === 'done') return 'Done';
  if (r.status === 'assigned') return `Assigned: ${r.assignee ?? ''}`;
  return 'Open';
}
