// Every string exists in both languages; placeholders fill; unknown placeholders stay visible.
import { describe, expect, it } from 'vitest';
import { LANGS, STRINGS, isLang, translate, type StringKey } from './i18n.js';

describe('i18n', () => {
  it('has every key in every language, never empty', () => {
    const keys = Object.keys(STRINGS.en) as StringKey[];
    for (const lang of LANGS) for (const k of keys) expect(STRINGS[lang][k].trim().length, `${lang}.${k}`).toBeGreaterThan(0);
    expect(Object.keys(STRINGS.ml).sort()).toEqual(keys.sort());
  });

  it('keeps the agreed need labels in Malayalam', () => {
    expect(translate('ml', 'food')).toBe('ഭക്ഷണം');
    expect(translate('ml', 'water')).toBe('കുടിവെള്ളം');
    expect(translate('ml', 'medical')).toBe('വൈദ്യസഹായം');
    expect(translate('ml', 'rescue')).toBe('രക്ഷാപ്രവർത്തനം / ബോട്ട്');
    expect(translate('ml', 'shelter')).toBe('അഭയം');
  });

  it('fills placeholders and leaves unknown ones visible', () => {
    expect(translate('en', 'aboard', { name: 'Asha' })).toBe('You are aboard, Asha.');
    expect(translate('en', 'roundN', { n: 4 })).toBe('Round 4');
    expect(translate('en', 'roundN', {})).toBe('Round {n}');
  });

  it('recognises only en and ml', () => {
    expect(isLang('en')).toBe(true);
    expect(isLang('ml')).toBe(true);
    expect(isLang('ta')).toBe(false);
  });
});
