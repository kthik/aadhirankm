import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Brand, SettingsMenu } from '../components/Layout.jsx';
import { Banner, Credential, Field, Modal } from '../components/ui.jsx';

const EMPTY = { academyName: '', coachName: '', phone: '' };

export default function ForgotUid() {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    try {
      setFound(await api.post('/auth/forgot-uid', form));
    } catch (err) {
      setErrors(err.errors);
      if (!Object.keys(err.errors ?? {}).length) setError(err.message);
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
          <h2>Recover your UID</h2>
          <p>All three details must match the academy record exactly.</p>

          <Banner>{error}</Banner>

          <div style={{ marginTop: error ? 14 : 0 }}>
            <Field label="Academy name" value={form.academyName} onChange={set('academyName')} error={errors.academyName} />
            <Field label="Coach name" value={form.coachName} onChange={set('coachName')} error={errors.coachName} />
            <Field label="Phone number" inputMode="numeric" value={form.phone} onChange={set('phone')} error={errors.phone} />
          </div>

          <button className="full" disabled={busy}>{busy ? 'Checking…' : 'Find my UID'}</button>
          <div className="foot"><Link to="/login">Back to sign in</Link></div>
        </form>

        {found && (
          <Modal title="UID found" onClose={() => navigate('/login')}>
            <p className="muted">Registered to {found.academyName}.</p>
            <Credential label="Your UID" value={found.uid} />
            <button className="full" onClick={() => navigate('/login')}>Continue to sign in</button>
          </Modal>
        )}
      </div>
    </div>
  );
}
