import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session.jsx';
import { useT } from '../lib/i18n.jsx';
import { Brand, SettingsMenu } from '../components/Layout.jsx';
import { Banner, Field } from '../components/ui.jsx';

export default function Login() {
  const { login, modules } = useSession();
  const t = useT();
  const navigate = useNavigate();
  const [form, setForm] = useState({ uid: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      navigate(await login(form.uid, form.password), { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div>
        <div className="auth-top">
          <Brand />
          <SettingsMenu withPassword={false} />
        </div>
        <form className="card" onSubmit={submit}>
          <h2>{t('auth.signIn', 'Sign in')}</h2>
          <p>{t('auth.signInHint', 'Use the UID issued at registration.')}</p>

          <Banner>{error}</Banner>

          <div style={{ marginTop: error ? 14 : 0 }}>
            <Field
              label={t('auth.uid', 'UID')}
              value={form.uid}
              onChange={set('uid')}
              placeholder="A001 / P001"
              autoCapitalize="characters"
              autoComplete="username"
            />
            <Field
              label={t('auth.password', 'Password')}
              type="password"
              value={form.password}
              onChange={set('password')}
              autoComplete="current-password"
            />
          </div>

          <button className="full" disabled={busy}>
            {busy ? t('auth.signingIn', 'Signing in…') : t('auth.signIn', 'Sign in')}
          </button>

          <div className="foot">
            <Link to="/forgot-uid">{t('auth.forgotUid', 'Forgot your UID?')}</Link>
            <div style={{ marginTop: 12 }}>
              {t('auth.newHere', 'New here?')}{' '}
              {modules.academyRegistration && <Link to="/register/academy">{t('auth.registerAcademy', 'Register an academy')}</Link>}
              {modules.academyRegistration && modules.individualRegistration && ' · '}
              {modules.individualRegistration && (
                <Link to="/register/individual">
                  {t('auth.registerIndividual', 'Register as an individual')}
                </Link>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
