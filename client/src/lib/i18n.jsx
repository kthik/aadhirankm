import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const KEY = 'veeran.lang';
const I18nContext = createContext(null);

export const LANGUAGES = [
  { id: 'en', label: 'English', native: 'English' },
  { id: 'ta', label: 'Tamil', native: 'தமிழ்' },
];

/**
 * Tamil strings for the interface chrome.
 *
 * Only UI text is translated. Data stays exactly as it was entered — an academy
 * called "Veeran Academy" and an event called "Maankombu" read the same in both
 * languages, because translating a competitor's name would be wrong and
 * translating an event name would break the code that matches on it.
 */
const TA = {
  // chrome
  'app.tagline': 'சிலம்பம் போட்டி மேலாண்மை',
  'nav.signOut': 'வெளியேறு',
  'nav.settings': 'அமைப்புகள்',
  'settings.appearance': 'தோற்றம்',
  'settings.language': 'மொழி',
  'settings.security': 'பாதுகாப்பு',
  'theme.light': 'பகல்',
  'theme.dark': 'இரவு',
  'theme.system': 'தானியங்கி',

  // auth
  'auth.signIn': 'உள்நுழைக',
  'auth.signInHint': 'பதிவின்போது வழங்கப்பட்ட UID ஐப் பயன்படுத்தவும்.',
  'auth.uid': 'UID',
  'auth.password': 'கடவுச்சொல்',
  'auth.signingIn': 'உள்நுழைகிறது…',
  'auth.forgotUid': 'UID மறந்துவிட்டதா?',
  'auth.newHere': 'புதியவரா?',
  'auth.registerAcademy': 'பயிற்சிக்கூடத்தைப் பதிவு செய்க',
  'auth.registerIndividual': 'தனிநபராகப் பதிவு செய்க',
  'auth.alreadyRegistered': 'ஏற்கனவே பதிவு செய்துள்ளீர்களா?',
  'auth.backToSignIn': 'உள்நுழைவுக்குத் திரும்பு',

  // common actions
  'action.save': 'சேமி',
  'action.saving': 'சேமிக்கிறது…',
  'action.cancel': 'ரத்து',
  'action.close': 'மூடு',
  'action.confirm': 'உறுதிப்படுத்து',
  'action.delete': 'நீக்கு',
  'action.edit': 'திருத்து',
  'action.activate': 'செயல்படுத்து',
  'action.deactivate': 'செயலிழக்கச் செய்',
  'action.done': 'முடிந்தது',
  'action.clearFilters': 'வடிகட்டிகளை அழி',
  'action.export': 'CSV ஏற்றுமதி',

  // tabs
  'tab.overview': 'மேலோட்டம்',
  'tab.listView': 'பட்டியல்',
  'tab.categories': 'வகைகள்',
  'tab.champions': 'வெற்றியாளர்கள்',
  'tab.academies': 'பயிற்சிக்கூடங்கள்',
  'tab.participants': 'போட்டியாளர்கள்',
  'tab.bouts': 'சுற்றுகள்',
  'tab.judges': 'நடுவர்கள்',
  'tab.backup': 'காப்புப்பிரதி',
  'tab.comingNext': 'அடுத்து வரவுள்ளது',
  'tab.register': 'போட்டியாளரைப் பதிவு செய்க',
  'tab.bulkUpload': 'மொத்தமாக பதிவேற்று',
  'tab.roster': 'போட்டியாளர்கள்',
  'tab.results': 'என் முடிவுகள்',
  'tab.myEvents': 'பதிவு செய்த போட்டிகள்',
  'tab.profile': 'சுயவிவரம்',
  'tab.runningOrder': 'வரிசை',
  'tab.events': 'போட்டிகள்',

  // roles
  'role.SUPER_ADMIN': 'தலைமை நிர்வாகி',
  'role.ADMIN': 'நிர்வாகி',
  'role.JUDGE': 'நடுவர்',
  'role.ACADEMY': 'பயிற்சிக்கூடம்',
  'role.ACADEMY_PARTICIPANT': 'பயிற்சிக்கூட போட்டியாளர்',
  'role.INDIVIDUAL': 'தனிநபர்',

  // stats
  'stat.participants': 'போட்டியாளர்கள்',
  'stat.events': 'போட்டிகள்',
  'stat.bouts': 'சுற்றுகள்',
  'stat.judgesActive': 'செயலில் உள்ள நடுவர்கள்',
  'stat.completion': 'மொத்த நிறைவு',
  'stat.averageScore': 'சராசரி மதிப்பெண்',
  'stat.medals': 'பதக்கங்கள்',
  'stat.eventEntries': 'போட்டி பதிவுகள்',
  'stat.inABout': 'சுற்றில்',
  'stat.scored': 'மதிப்பிடப்பட்டது',
  'stat.judged': 'மதிப்பிடப்பட்டது',
  'stat.bestPosition': 'சிறந்த இடம்',
  'stat.ageGroup': 'வயது பிரிவு',
  'stat.assigned': 'ஒதுக்கப்பட்டவர்கள்',
  'stat.stillToJudge': 'மதிப்பிட வேண்டியவை',
  'stat.inOther': 'வேறு ஆட்டத்தில்',
  'stat.podiumClosed': 'இட நிர்ணயம்',

  // table headers
  'th.uid': 'UID',
  'th.name': 'பெயர்',
  'th.age': 'வயது',
  'th.academy': 'பயிற்சிக்கூடம்',
  'th.event': 'போட்டி',
  'th.events': 'போட்டிகள்',
  'th.bout': 'சுற்று',
  'th.bouts': 'சுற்றுகள்',
  'th.status': 'நிலை',
  'th.position': 'இடம்',
  'th.total': 'மொத்தம்',
  'th.judge': 'நடுவர்',
  'th.mobile': 'கைபேசி',
  'th.location': 'இடம்',
  'th.ageGroup': 'வயது பிரிவு',
  'th.medal': 'பதக்கம்',
  'th.issued': 'வழங்கப்பட்டது',

  // statuses
  'status.scored': 'மதிப்பிடப்பட்டது',
  'status.ready': 'தயார்',
  'status.waiting': 'காத்திருக்கிறது',
  'status.completed': 'முடிந்தது',
  'status.pending': 'நிலுவையில்',
  'status.active': 'செயலில்',
  'status.inactive': 'செயலற்றது',
  'status.inOtherPerformance': 'வேறு ஆட்டத்தில்',
  'status.assigned': 'ஒதுக்கப்பட்டது',
  'status.unassigned': 'ஒதுக்கப்படவில்லை',
  'status.individual': 'தனிநபர்',

  // misc
  'common.all': 'அனைத்தும்',
  'common.none': 'எதுவுமில்லை',
  'common.loading': 'ஏற்றுகிறது…',
  'common.noData': 'தரவு இல்லை.',
  'common.search': 'தேடு',
  'common.defaultPasswordWarning':
    'நீங்கள் இன்னும் இயல்புநிலை கடவுச்சொல்லைப் பயன்படுத்துகிறீர்கள். அமைப்புகளில் மாற்றவும்.',
};

const DICTS = { en: {}, ta: TA };

function stored() {
  try {
    const v = localStorage.getItem(KEY);
    return LANGUAGES.some((l) => l.id === v) ? v : 'en';
  } catch {
    return 'en';
  }
}

/**
 * Translation context.
 *
 * `t(key, fallback)` returns the Tamil string when one exists and the English
 * fallback otherwise, so an untranslated key degrades to readable English
 * rather than showing the key itself.
 */
export function I18nProvider({ children }) {
  const [lang, setLang] = useState(stored);

  useEffect(() => {
    document.documentElement.setAttribute('lang', lang);
    try {
      localStorage.setItem(KEY, lang);
    } catch {
      // Storage blocked: the choice still applies, it just is not remembered.
    }
  }, [lang]);

  const t = useCallback(
    (key, fallback) => DICTS[lang]?.[key] ?? fallback ?? key,
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

/** Shorthand for components that only need the translate function. */
export function useT() {
  return useI18n().t;
}

export function LanguageSwitch() {
  const { lang, setLang } = useI18n();
  return (
    <div className="seg-switch" role="group" aria-label="Language">
      {LANGUAGES.map((l) => (
        <button
          key={l.id}
          type="button"
          lang={l.id}
          aria-pressed={lang === l.id}
          onClick={() => setLang(l.id)}
        >
          {l.native}
        </button>
      ))}
    </div>
  );
}
