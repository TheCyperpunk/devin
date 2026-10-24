// Language context: t('key') returns the string in the current language (English or Malayalam).
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { translate, type Lang, type StringKey } from '@relief-mesh/shared';

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<LangCtx | null>(null);

export function LangProvider({ lang, setLang, children }: { lang: Lang; setLang: (l: Lang) => void; children: ReactNode }) {
  const value = useMemo<LangCtx>(() => ({ lang, setLang, t: (k, v) => translate(lang, k, v) }), [lang, setLang]);
  useEffect(() => {
    document.documentElement.lang = lang; // lets the phone pick a Malayalam font and screen readers the right voice
  }, [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLang(): LangCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useLang outside LangProvider');
  return c;
}

export function LangToggle() {
  const { lang, setLang } = useLang();
  // Each button is written in its own language so it can be found without reading the current one.
  return (
    <div className="lang" role="group" aria-label="Language / ഭാഷ">
      <button type="button" className={lang === 'en' ? 'on' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
        English
      </button>
      <button type="button" className={lang === 'ml' ? 'on' : ''} aria-pressed={lang === 'ml'} onClick={() => setLang('ml')}>
        മലയാളം
      </button>
    </div>
  );
}
