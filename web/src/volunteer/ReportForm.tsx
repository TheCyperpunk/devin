// The report form: big need buttons, people counter, three toggles, note, GPS. Submit saves on the phone first.
import { useRef, useState } from 'react';
import { LIMITS, NEED_TYPES, type NeedType } from '@relief-mesh/shared';
import { saveNewReport } from '../lib/db.js';
import { useLocation } from '../lib/hooks.js';
import { buildLocalReport, clampPeople, emptyForm, type FormState } from '../lib/report.js';
import { useLang } from './lang.js';

const ICON: Record<NeedType, string> = { food: '🍚', water: '💧', medical: '🩺', rescue: '🛟', shelter: '🏠' };

export function ReportForm({ onSaved, onShowMine }: { onSaved: () => void; onShowMine: () => void }) {
  const { t } = useLang();
  const { loc, retry } = useLocation();
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const busy = useRef(false); // a ref, not state, so a fast double tap cannot slip in before a re-render

  const patch = (p: Partial<FormState>) => {
    setSaved(false);
    setError(null);
    setForm((f) => ({ ...f, ...p }));
  };
  const toggleNeed = (n: NeedType) =>
    patch({ needs: form.needs.includes(n) ? form.needs.filter((x) => x !== n) : [...form.needs, n] });

  async function submit() {
    if (busy.current) return;
    const built = buildLocalReport({ ...form, position: loc.position }, crypto.randomUUID(), Date.now());
    if (!built.ok) return setError(built.error === 'needs' ? t('errPickNeed') : t('errGeneric'));
    busy.current = true;
    try {
      await saveNewReport(built.local);
      setForm(emptyForm());
      setSaved(true);
      onSaved();
    } catch {
      setError(t('errGeneric'));
    } finally {
      busy.current = false;
    }
  }

  return (
    <div className="stack">
      {saved && (
        <div className="saved" role="status">
          <strong>✓ {t('savedOnPhone')}</strong>
          <span>{t('savedHelp')}</span>
          <button type="button" className="link" onClick={onShowMine}>
            {t('tabMine')} →
          </button>
        </div>
      )}

      <section className="card pad">
        <h2>{t('whatNeeded')}</h2>
        <div className="needs">
          {NEED_TYPES.map((n) => (
            <button
              key={n}
              type="button"
              data-need={n}
              className={'need' + (form.needs.includes(n) ? ' on' : '')}
              aria-pressed={form.needs.includes(n)}
              onClick={() => toggleNeed(n)}
            >
              <span className="ico" aria-hidden="true">
                {ICON[n]}
              </span>
              {t(n)}
            </button>
          ))}
        </div>
      </section>

      <section className="card pad">
        <h2>{t('people')}</h2>
        <div className="counter">
          <button type="button" aria-label={t('fewer')} onClick={() => patch({ peopleCount: clampPeople(form.peopleCount - 1) })}>
            −
          </button>
          <input
            name="people"
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label={t('people')}
            value={form.peopleCount}
            onChange={(e) => patch({ peopleCount: clampPeople(Number(e.target.value.replace(/\D/g, '')) || 1) })}
          />
          <button type="button" aria-label={t('more')} onClick={() => patch({ peopleCount: clampPeople(form.peopleCount + 1) })}>
            +
          </button>
        </div>
        <div className="toggles">
          <Toggle label={t('children')} on={form.hasChildren} onChange={(v) => patch({ hasChildren: v })} name="children" />
          <Toggle label={t('elderly')} on={form.hasElderlyOrSick} onChange={(v) => patch({ hasElderlyOrSick: v })} name="elderly" />
          <Toggle label={t('urgent')} on={form.urgent} onChange={(v) => patch({ urgent: v })} name="urgent" danger />
        </div>
      </section>

      <section className="card pad">
        <label className="field">
          <span>{t('note')}</span>
          <textarea
            name="note"
            rows={3}
            maxLength={LIMITS.noteMax}
            placeholder={t('notePlaceholder')}
            value={form.note}
            onChange={(e) => patch({ note: e.target.value })}
          />
        </label>
        <div className="loc" aria-live="polite">
          {loc.status === 'getting' && <span>📍 {t('locGetting')}</span>}
          {loc.status === 'ok' && <span>📍 {t('locOk', { m: Math.round(loc.position.accuracyM) })}</span>}
          {loc.status === 'none' && (
            <>
              <span>📍 {t('locNone')}</span>
              <button type="button" className="link" onClick={retry}>
                {t('locRetry')}
              </button>
            </>
          )}
        </div>
      </section>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="btn primary big" onClick={submit} data-testid="submit">
        {t('submit')}
      </button>
    </div>
  );
}

function Toggle({ label, on, onChange, name, danger }: { label: string; on: boolean; onChange: (v: boolean) => void; name: string; danger?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-toggle={name}
      className={'toggle' + (on ? ' on' : '') + (danger ? ' danger' : '')}
      onClick={() => onChange(!on)}
    >
      <span>{label}</span>
      <span className="knob" aria-hidden="true" />
    </button>
  );
}
