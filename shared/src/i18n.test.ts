// Guards the translations: nothing missing, nothing empty, placeholders match, and the agreed labels stay put.
import { describe, expect, it } from 'vitest';
import { STRINGS, translate, type StringKey } from './i18n.js';

const keys = Object.keys(STRINGS.en) as StringKey[];
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');

describe('i18n', () => {
  it('has the same keys in English and Malayalam', () => {
    expect(Object.keys(STRINGS.ml).sort()).toEqual([...keys].sort());
  });
  it('has no empty strings', () => {
    for (const lang of ['en', 'ml'] as const) for (const k of keys) expect(STRINGS[lang][k].trim(), `${lang}.${k}`).not.toBe('');
  });
  it('uses the same {placeholders} in both languages', () => {
    for (const k of keys) expect(placeholders(STRINGS.ml[k]), k).toBe(placeholders(STRINGS.en[k]));
  });
  it('keeps the 12 agreed Malayalam labels from docs/PLAN.md', () => {
    const agreed: Partial<Record<StringKey, string>> = {
      food: 'ഭക്ഷണം',
      water: 'കുടിവെള്ളം',
      medical: 'വൈദ്യസഹായം',
      rescue: 'രക്ഷാപ്രവർത്തനം / ബോട്ട്',
      shelter: 'അഭയം',
      children: 'കുട്ടികൾ ഉണ്ട്',
      elderly: 'പ്രായമായവർ / രോഗികൾ',
      urgent: 'അടിയന്തരം',
      people: 'ആളുകളുടെ എണ്ണം',
      submit: 'അയയ്ക്കുക',
      savedOnPhone: 'ഫോണിൽ സേവ് ചെയ്തു',
      sentToHub: 'ഹബ്ബിലേക്ക് അയച്ചു',
    };
    for (const [k, v] of Object.entries(agreed)) expect(STRINGS.ml[k as StringKey]).toBe(v);
  });
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(translate('en', 'assignedTo', { name: 'Boat 2' })).toBe('Assigned to Boat 2');
    expect(translate('en', 'locOk', { m: 12 })).toBe('Location saved (±12 m)');
    expect(translate('en', 'assignedTo')).toBe('Assigned to {name}');
  });
});
