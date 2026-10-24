// All phone text in English and Malayalam, in one place so a native speaker can fix it. Malayalam lines marked
// "draft" in GAME-PLAN G6 still need that check.

export type Lang = 'en' | 'ml';
export const LANGS: readonly Lang[] = ['en', 'ml'];

const en = {
  appName: 'Pralayam',
  tagline: 'The flood night. Crew a boat. Works without Internet.',
  languageName: 'English',

  // needs
  food: 'Food',
  water: 'Drinking water',
  medical: 'Medical help',
  rescue: 'Rescue / boat',
  shelter: 'Shelter',

  // pairing
  pairTitle: 'Join the night',
  pairHelp: 'Connect to the game Wi-Fi, then enter your name and the join code on the big screen.',
  yourName: 'Your name',
  joinCode: 'Join code',
  join: 'Join',
  joining: 'Joining…',
  errName: 'Enter your name.',
  errCode: 'Enter the join code.',
  errBadCode: 'That join code is not valid.',
  errNoHub: 'Cannot reach the hub. Join the game Wi-Fi and try again.',
  errTooMany: 'Too many tries. Wait a minute and try again.',
  errGeneric: 'Something went wrong. Try again.',
  pairAgainReset: 'The hub was restarted with a new database. Enter the join code again.',
  pairAgainToken: 'This phone is no longer paired with the hub. Enter the join code again.',

  // crew
  pickColour: 'Pick your boat',
  crewBoat: 'Crew a boat',
  aboard: 'You are aboard, {name}.',
  waitingHost: 'Waiting for the host to start the night…',
  noGame: 'No game open yet. Ask the host to open the lobby on the big screen.',
  nightOver: 'The night is over. Look at the big screen.',
  roundN: 'Round {n}',
  ordersSoon: 'Orders come from this phone in the next build. For now, watch the big screen.',
  hubOnline: 'Hub connected',
  hubOffline: 'Hub not reachable',
  loading: 'Loading…',
  retryNow: 'Retry now',
} as const;

export type StringKey = keyof typeof en;

const ml: Record<StringKey, string> = {
  appName: 'പ്രളയം',
  tagline: 'പ്രളയ രാത്രി. ഒരു ബോട്ട് ഏറ്റെടുക്കുക. ഇന്റർനെറ്റ് ഇല്ലാതെയും പ്രവർത്തിക്കും.',
  languageName: 'മലയാളം',

  food: 'ഭക്ഷണം',
  water: 'കുടിവെള്ളം',
  medical: 'വൈദ്യസഹായം',
  rescue: 'രക്ഷാപ്രവർത്തനം / ബോട്ട്',
  shelter: 'അഭയം',

  pairTitle: 'രാത്രിയിൽ ചേരുക',
  pairHelp: 'ഗെയിം വൈ-ഫൈയിൽ കണക്റ്റ് ചെയ്യുക. തുടർന്ന് നിങ്ങളുടെ പേരും വലിയ സ്ക്രീനിലെ ജോയിൻ കോഡും നൽകുക.',
  yourName: 'നിങ്ങളുടെ പേര്',
  joinCode: 'ജോയിൻ കോഡ്',
  join: 'ചേരുക',
  joining: 'ചേരുന്നു…',
  errName: 'നിങ്ങളുടെ പേര് നൽകുക.',
  errCode: 'ജോയിൻ കോഡ് നൽകുക.',
  errBadCode: 'ജോയിൻ കോഡ് ശരിയല്ല.',
  errNoHub: 'ഹബ്ബുമായി ബന്ധപ്പെടാൻ കഴിയുന്നില്ല. ഗെയിം വൈ-ഫൈയിൽ ചേർന്ന് വീണ്ടും ശ്രമിക്കുക.',
  errTooMany: 'കൂടുതൽ ശ്രമങ്ങൾ. ഒരു മിനിറ്റ് കാത്തിരുന്ന് വീണ്ടും ശ്രമിക്കുക.',
  errGeneric: 'എന്തോ പിശക് സംഭവിച്ചു. വീണ്ടും ശ്രമിക്കുക.',
  pairAgainReset: 'ഹബ് പുതിയ ഡാറ്റാബേസുമായി പുനരാരംഭിച്ചു. ജോയിൻ കോഡ് വീണ്ടും നൽകുക.',
  pairAgainToken: 'ഈ ഫോൺ ഇപ്പോൾ ഹബ്ബുമായി ബന്ധിപ്പിച്ചിട്ടില്ല. ജോയിൻ കോഡ് വീണ്ടും നൽകുക.',

  pickColour: 'നിങ്ങളുടെ ബോട്ട് തിരഞ്ഞെടുക്കുക',
  crewBoat: 'ബോട്ട് ഏറ്റെടുക്കുക',
  aboard: '{name}, നിങ്ങൾ ബോട്ടിലാണ്.',
  waitingHost: 'ഹോസ്റ്റ് രാത്രി തുടങ്ങുന്നത് കാത്തിരിക്കുന്നു…',
  noGame: 'ഗെയിം ഇതുവരെ തുറന്നിട്ടില്ല. വലിയ സ്ക്രീനിൽ ലോബി തുറക്കാൻ ഹോസ്റ്റിനോട് പറയുക.',
  nightOver: 'രാത്രി കഴിഞ്ഞു. വലിയ സ്ക്രീൻ നോക്കുക.',
  roundN: 'റൗണ്ട് {n}',
  ordersSoon: 'അടുത്ത പതിപ്പിൽ ഈ ഫോണിൽ നിന്ന് ഓർഡറുകൾ നൽകാം. ഇപ്പോൾ വലിയ സ്ക്രീൻ കാണുക.',
  hubOnline: 'ഹബ് കണക്റ്റഡ്',
  hubOffline: 'ഹബ്ബിനെ ബന്ധപ്പെടാൻ കഴിയുന്നില്ല',
  loading: 'ലോഡ് ചെയ്യുന്നു…',
  retryNow: 'വീണ്ടും ശ്രമിക്കുക',
};

export const STRINGS: Record<Lang, Record<StringKey, string>> = { en, ml };

export function translate(lang: Lang, key: StringKey, vars?: Record<string, string | number>): string {
  const text = STRINGS[lang][key];
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}

export function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'ml';
}
