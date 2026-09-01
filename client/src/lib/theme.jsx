import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useT } from './i18n.jsx';

const KEY = 'veeran.theme';
const ThemeContext = createContext(null);

/** Reads the saved choice. Storage can throw in a private window, so guard it. */
function stored() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Day / night, with a third "system" setting that follows the device.
 *
 * The choice is stamped on <html data-theme> and the stylesheet does the rest;
 * "system" removes the stamp so the prefers-color-scheme block applies and the
 * page tracks the OS if it changes while open.
 */
export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(stored);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  );

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return undefined;
    const onChange = (e) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (preference === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', preference);

    try {
      localStorage.setItem(KEY, preference);
    } catch {
      // A viewer with storage blocked still gets the theme, just not remembered.
    }
  }, [preference]);

  const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  // Keep the browser chrome (mobile address bar) in step with the page.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#070a12' : '#eef1f7');
  }, [resolved]);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

const OPTIONS = [
  { id: 'light', key: 'theme.light', label: 'Day', icon: '☀' },
  { id: 'dark', key: 'theme.dark', label: 'Night', icon: '☾' },
  { id: 'system', key: 'theme.system', label: 'Auto', icon: '◐' },
];

/** Three-way switch: day, night, or follow the device. */
export function ThemeSwitch() {
  const { preference, setPreference } = useTheme();
  const t = useT();
  return (
    <div className="seg-switch" role="group" aria-label={t('settings.appearance', 'Appearance')}>
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={preference === o.id}
          onClick={() => setPreference(o.id)}
        >
          <span aria-hidden="true">{o.icon}</span> {t(o.key, o.label)}
        </button>
      ))}
    </div>
  );
}
