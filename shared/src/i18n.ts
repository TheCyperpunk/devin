// All UI text in English and Malayalam. Keep every string here so a native speaker can fix them in one place.
// The 12 labels from docs/PLAN.md are fixed; the rest are first drafts and NEED A NATIVE-SPEAKER CHECK (Phase 10).

export type Lang = 'en' | 'ml';
export const LANGS: readonly Lang[] = ['en', 'ml'];

const en = {
  appName: 'Relief Mesh',
  tagline: 'Report needs. Works without Internet.',
  languageName: 'English',

  // need types
  food: 'Food',
  water: 'Drinking water',
  medical: 'Medical help',
  rescue: 'Rescue / boat',
  shelter: 'Shelter',

  // report form
  children: 'Children present',
  elderly: 'Elderly or sick',
  urgent: 'Urgent',
  people: 'Number of people',
  submit: 'Submit',
  whatNeeded: 'What is needed?',
  errPickNeed: 'Choose at least one need.',
  note: 'Note (optional)',
  notePlaceholder: 'Place, landmark, what is happening',
  more: 'Add one more person',
  fewer: 'Remove one person',
  locGetting: 'Getting your location…',
  locOk: 'Location saved (±{m} m)',
  locNone: 'No location. You can still send.',
  locRetry: 'Try again',
  savedOnPhone: 'Saved on phone',
  savedHelp: 'It is sent to the hub when you are connected.',
  saving: 'Saving…',
  loading: 'Loading…',

  // report status
  sentToHub: 'Sent to hub',
  assignedTo: 'Assigned to {name}',
  done: 'Done',
  rejected: 'Not accepted',

  // my reports
  tabNew: 'New report',
  tabMine: 'My reports',
  noReports: 'No reports yet.',
  waitingToSend: '{n} waiting to send',
  justNow: 'Just now',
  minutesAgo: '{n} min ago',
  hoursAgo: '{n} h ago',
  daysAgo: '{n} d ago',

  // pairing
  pairTitle: 'Join the relief hub',
  pairHelp: 'Connect to the relief Wi-Fi, then enter your name and the join code shown on the coordinator’s screen.',
  yourName: 'Your name',
  joinCode: 'Join code',
  join: 'Join',
  joining: 'Joining…',
  errName: 'Enter your name.',
  errCode: 'Enter the join code.',
  errBadCode: 'That join code is not valid.',
  errNoHub: 'Cannot reach the hub. Join the relief Wi-Fi and try again.',
  errTooMany: 'Too many tries. Wait a minute and try again.',
  errGeneric: 'Something went wrong. Try again.',

  // status line
  hubOnline: 'Hub connected',
  hubOffline: 'Hub not reachable',
  sending: 'Sending…',
  retryNow: 'Retry now',
  allSent: 'All reports sent',
  pairAgainReset: 'The hub was restarted with a new database. Enter the join code again. Your saved reports will be sent again.',
  pairAgainToken: 'This phone is no longer paired with the hub. Enter the join code again.',
  rejectedWhy: 'The hub did not accept this report: {reason}',
  storageWarn: 'This browser may delete saved reports. Install the app and send reports soon.',
} as const;

export type StringKey = keyof typeof en;

const ml: Record<StringKey, string> = {
  appName: 'Relief Mesh',
  tagline: 'ആവശ്യങ്ങൾ അറിയിക്കുക. ഇന്റർനെറ്റ് ഇല്ലാതെയും പ്രവർത്തിക്കും.',
  languageName: 'മലയാളം',

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
  whatNeeded: 'എന്താണ് ആവശ്യം?',
  errPickNeed: 'ഒരു ആവശ്യമെങ്കിലും തിരഞ്ഞെടുക്കുക.',
  note: 'കുറിപ്പ് (ഓപ്ഷണൽ)',
  notePlaceholder: 'സ്ഥലം, അടയാളം, എന്താണ് സംഭവിക്കുന്നത്',
  more: 'ഒരാളെ കൂട്ടുക',
  fewer: 'ഒരാളെ കുറയ്ക്കുക',
  locGetting: 'ലൊക്കേഷൻ എടുക്കുന്നു…',
  locOk: 'ലൊക്കേഷൻ സേവ് ചെയ്തു (±{m} മീറ്റർ)',
  locNone: 'ലൊക്കേഷൻ ഇല്ല. എങ്കിലും അയയ്ക്കാം.',
  locRetry: 'വീണ്ടും ശ്രമിക്കുക',
  savedOnPhone: 'ഫോണിൽ സേവ് ചെയ്തു',
  savedHelp: 'കണക്റ്റ് ചെയ്യുമ്പോൾ ഹബ്ബിലേക്ക് അയയ്ക്കും.',
  saving: 'സേവ് ചെയ്യുന്നു…',
  loading: 'ലോഡ് ചെയ്യുന്നു…',

  sentToHub: 'ഹബ്ബിലേക്ക് അയച്ചു',
  assignedTo: '{name}-ന് നൽകി',
  done: 'പൂർത്തിയായി',
  rejected: 'സ്വീകരിച്ചില്ല',

  tabNew: 'പുതിയ റിപ്പോർട്ട്',
  tabMine: 'എന്റെ റിപ്പോർട്ടുകൾ',
  noReports: 'റിപ്പോർട്ടുകൾ ഒന്നുമില്ല.',
  waitingToSend: 'അയയ്ക്കാൻ {n} എണ്ണം ബാക്കി',
  justNow: 'ഇപ്പോൾ',
  minutesAgo: '{n} മിനിറ്റ് മുമ്പ്',
  hoursAgo: '{n} മണിക്കൂർ മുമ്പ്',
  daysAgo: '{n} ദിവസം മുമ്പ്',

  pairTitle: 'റിലീഫ് ഹബ്ബിൽ ചേരുക',
  pairHelp: 'റിലീഫ് വൈ-ഫൈയിൽ കണക്റ്റ് ചെയ്യുക. തുടർന്ന് നിങ്ങളുടെ പേരും കോർഡിനേറ്ററുടെ സ്ക്രീനിലെ ജോയിൻ കോഡും നൽകുക.',
  yourName: 'നിങ്ങളുടെ പേര്',
  joinCode: 'ജോയിൻ കോഡ്',
  join: 'ചേരുക',
  joining: 'ചേരുന്നു…',
  errName: 'നിങ്ങളുടെ പേര് നൽകുക.',
  errCode: 'ജോയിൻ കോഡ് നൽകുക.',
  errBadCode: 'ജോയിൻ കോഡ് ശരിയല്ല.',
  errNoHub: 'ഹബ്ബുമായി ബന്ധപ്പെടാൻ കഴിയുന്നില്ല. റിലീഫ് വൈ-ഫൈയിൽ ചേർന്ന് വീണ്ടും ശ്രമിക്കുക.',
  errTooMany: 'കൂടുതൽ ശ്രമങ്ങൾ. ഒരു മിനിറ്റ് കാത്തിരുന്ന് വീണ്ടും ശ്രമിക്കുക.',
  errGeneric: 'എന്തോ പിശക് സംഭവിച്ചു. വീണ്ടും ശ്രമിക്കുക.',

  hubOnline: 'ഹബ് കണക്റ്റഡ്',
  hubOffline: 'ഹബ്ബിനെ ബന്ധപ്പെടാൻ കഴിയുന്നില്ല',
  sending: 'അയയ്ക്കുന്നു…',
  retryNow: 'വീണ്ടും ശ്രമിക്കുക',
  allSent: 'എല്ലാ റിപ്പോർട്ടുകളും അയച്ചു',
  pairAgainReset: 'ഹബ് പുതിയ ഡാറ്റാബേസുമായി പുനരാരംഭിച്ചു. ജോയിൻ കോഡ് വീണ്ടും നൽകുക. സേവ് ചെയ്ത റിപ്പോർട്ടുകൾ വീണ്ടും അയയ്ക്കും.',
  pairAgainToken: 'ഈ ഫോൺ ഇപ്പോൾ ഹബ്ബുമായി ബന്ധിപ്പിച്ചിട്ടില്ല. ജോയിൻ കോഡ് വീണ്ടും നൽകുക.',
  rejectedWhy: 'ഹബ് ഈ റിപ്പോർട്ട് സ്വീകരിച്ചില്ല: {reason}',
  storageWarn: 'സേവ് ചെയ്ത റിപ്പോർട്ടുകൾ ബ്രൗസർ മായ്ച്ചേക്കാം. ആപ്പ് ഇൻസ്റ്റാൾ ചെയ്യുക, റിപ്പോർട്ടുകൾ വേഗം അയയ്ക്കുക.',
};

export const STRINGS: Record<Lang, Record<StringKey, string>> = { en, ml };

export function translate(lang: Lang, key: StringKey, vars?: Record<string, string | number>): string {
  const text = STRINGS[lang][key];
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}

export function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'ml';
}
