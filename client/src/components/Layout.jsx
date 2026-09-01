import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session.jsx';
import ChangePassword from './ChangePassword.jsx';
import { ThemeSwitch } from '../lib/theme.jsx';
import { LanguageSwitch, useT } from '../lib/i18n.jsx';

export function Brand() {
  const { config } = useSession();
  const t = useT();
  return (
    <div className="brand">
      <span className="mark" aria-hidden="true">🥢</span>
      <span>
        {config?.app?.name ?? 'Veeran'}
        <small>{t('app.tagline', config?.app?.tagline ?? 'Silambam')}</small>
      </span>
    </div>
  );
}

/**
 * Settings gear. Holds appearance, language and — once signed in — the password
 * reset, so none of them needs a tab on each dashboard. The signed-out screens
 * render the same menu without the password section.
 */
export function SettingsMenu({ withPassword = true }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);

  // Close on outside click or Escape, the way a menu is expected to behave.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!wrap.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="settings-wrap" ref={wrap}>
      <button
        type="button"
        className="icon-btn"
        aria-label={t('nav.settings', 'Settings')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ⚙
      </button>

      {open && (
        <div className="settings-pop" role="dialog" aria-label={t('nav.settings', 'Settings')}>
          <h3>{t('settings.appearance', 'Appearance')}</h3>
          <ThemeSwitch />
          <hr />
          <h3>{t('settings.language', 'Language')}</h3>
          <LanguageSwitch />
          {withPassword && (
            <>
              <hr />
              <h3>{t('settings.security', 'Security')}</h3>
              <ChangePassword />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Chrome for signed-in screens: brand, who you are, settings, sign out. */
export function AppLayout() {
  const { user, logout, roles } = useSession();
  const t = useT();
  const navigate = useNavigate();

  return (
    <div className="shell">
      <header className="topbar">
        <Brand />
        <div className="spacer" />
        <div className="who">
          <div className="name">{user?.name}</div>
          <div className="role">
            {t(`role.${user?.role}`, roles[user?.role]?.label ?? user?.role)} · {user?.uid}
          </div>
        </div>
        <SettingsMenu />
        <button
          className="ghost"
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
        >
          {t('nav.signOut', 'Sign out')}
        </button>
      </header>
      <Outlet />
    </div>
  );
}

/**
 * Gate for authenticated routes. Waits for the session probe to finish so a
 * page refresh does not bounce a signed-in user back to the login screen.
 */
export function Protected({ allow }) {
  const { user, loading, roles } = useSession();
  const location = useLocation();

  if (loading) return <div className="auth muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (allow && !allow.includes(user.role)) {
    return <Navigate to={roles[user.role]?.home ?? '/login'} replace />;
  }
  return <AppLayout />;
}
