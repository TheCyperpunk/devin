// buildLocalReport: what the form is allowed to turn into a report, and what the hub would accept.
import { describe, expect, it } from 'vitest';
import { PhoneReportInputSchema } from '@relief-mesh/shared';
import { buildLocalReport, clampPeople, emptyForm } from './report.js';
import { timeAgo } from './timeago.js';

const ID = '6f9619ff-8b86-4d11-b42d-00c04fc964ff';
const form = (over = {}) => ({ ...emptyForm(), needs: ['food' as const], ...over });

describe('buildLocalReport', () => {
  it('refuses a report with no need selected', () => {
    expect(buildLocalReport(emptyForm(), ID, 1)).toEqual({ ok: false, error: 'needs' });
  });
  it('builds a saved report that the hub schema accepts once ageMs is added', () => {
    const r = buildLocalReport(form({ peopleCount: 5, urgent: true }), ID, 1234);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.local).toMatchObject({ id: ID, createdAtLocal: 1234, syncState: 'saved' });
    expect(PhoneReportInputSchema.safeParse({ ...r.local.input, ageMs: 0 }).success).toBe(true);
  });
  it('never includes hub-owned fields', () => {
    const r = buildLocalReport(form(), ID, 1);
    if (!r.ok) throw new Error('expected ok');
    for (const k of ['status', 'assignee', 'deviceId', 'reporterName', 'baseScore', 'revision', 'ageMs']) {
      expect(r.local.input).not.toHaveProperty(k);
    }
  });
  it('puts needs in canonical order without duplicates', () => {
    const r = buildLocalReport(form({ needs: ['shelter', 'food', 'food', 'medical'] }), ID, 1);
    if (!r.ok) throw new Error('expected ok');
    expect(r.local.input.needs).toEqual(['food', 'medical', 'shelter']);
  });
  it('trims the note and drops an empty one', () => {
    const a = buildLocalReport(form({ note: '  need a boat  ' }), ID, 1);
    const b = buildLocalReport(form({ note: '   ' }), ID, 1);
    if (!a.ok || !b.ok) throw new Error('expected ok');
    expect(a.local.input.note).toBe('need a boat');
    expect(b.local.input).not.toHaveProperty('note');
  });
  it('includes position only when there is one, with rounded accuracy', () => {
    const withPos = buildLocalReport(form({ position: { lat: 10.1, lng: 76.3, accuracyM: 12.6 } }), ID, 1);
    const without = buildLocalReport(form(), ID, 1);
    if (!withPos.ok || !without.ok) throw new Error('expected ok');
    expect(withPos.local.input).toMatchObject({ lat: 10.1, lng: 76.3, accuracyM: 13 });
    expect(without.local.input).not.toHaveProperty('lat');
  });
  it('clamps the people count to 1-500', () => {
    expect(clampPeople(0)).toBe(1);
    expect(clampPeople(-5)).toBe(1);
    expect(clampPeople(9999)).toBe(500);
    expect(clampPeople(3.9)).toBe(3);
    expect(clampPeople(NaN)).toBe(1);
  });
  it('rejects a position outside the earth instead of queueing a report the hub will refuse', () => {
    const r = buildLocalReport(form({ position: { lat: 123, lng: 76, accuracyM: 5 } }), ID, 1);
    expect(r).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('timeAgo', () => {
  const t = (k: string, v?: Record<string, string | number>) => (v ? `${k}:${v.n}` : k);
  const now = 10_000_000;
  it('picks the right unit', () => {
    expect(timeAgo(now - 10_000, now, t as never)).toBe('justNow');
    expect(timeAgo(now - 5 * 60_000, now, t as never)).toBe('minutesAgo:5');
    expect(timeAgo(now - 3 * 3_600_000, now, t as never)).toBe('hoursAgo:3');
    expect(timeAgo(now - 72 * 3_600_000, now, t as never)).toBe('daysAgo:3');
  });
  it('treats a future time as just now', () => {
    expect(timeAgo(now + 99_000, now, t as never)).toBe('justNow');
  });
});
