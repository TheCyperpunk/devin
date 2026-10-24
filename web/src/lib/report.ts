// Turns the form state into a validated local report. Pure, so it is easy to test.
import { NEED_TYPES, PhoneReportInputSchema, LIMITS, type NeedType } from '@relief-mesh/shared';
import type { LocalReport, ReportDraft } from './db.js';

export interface Position {
  lat: number;
  lng: number;
  accuracyM: number;
}

export interface FormState {
  needs: NeedType[];
  peopleCount: number;
  hasChildren: boolean;
  hasElderlyOrSick: boolean;
  urgent: boolean;
  note: string;
  position: Position | null;
}

export const emptyForm = (position: Position | null = null): FormState => ({
  needs: [],
  peopleCount: 1,
  hasChildren: false,
  hasElderlyOrSick: false,
  urgent: false,
  note: '',
  position,
});

export type BuildResult = { ok: true; local: LocalReport } | { ok: false; error: 'needs' | 'invalid' };

export function clampPeople(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(LIMITS.peopleCount[1], Math.max(LIMITS.peopleCount[0], Math.trunc(n)));
}

export function buildLocalReport(form: FormState, id: string, now: number): BuildResult {
  if (form.needs.length === 0) return { ok: false, error: 'needs' };

  const note = form.note.trim();
  const draft: ReportDraft = {
    id,
    // canonical order, no duplicates, whatever order the buttons were tapped in
    needs: NEED_TYPES.filter((n) => form.needs.includes(n)),
    peopleCount: clampPeople(form.peopleCount),
    hasChildren: form.hasChildren,
    hasElderlyOrSick: form.hasElderlyOrSick,
    urgent: form.urgent,
    ...(note ? { note } : {}),
    ...(form.position
      ? { lat: form.position.lat, lng: form.position.lng, accuracyM: Math.round(form.position.accuracyM) }
      : {}),
  };

  // The hub validates again, but catching a bad report here means it never sits in the outbox failing forever.
  if (!PhoneReportInputSchema.safeParse({ ...draft, ageMs: 0 }).success) return { ok: false, error: 'invalid' };
  return { ok: true, local: { id, input: draft, createdAtLocal: now, syncState: 'saved' } };
}
