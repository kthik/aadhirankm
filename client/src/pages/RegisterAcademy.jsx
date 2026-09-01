import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Brand, SettingsMenu } from '../components/Layout.jsx';
import { Banner, Credential, Field, Modal } from '../components/ui.jsx';

const EMPTY = { academyName: '', coachName: '', phone: '', address: '', location: '' };

export default function RegisterAcademy() {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    try {
      setCreated(await api.post('/academies', form));
    } catch (err) {
      setErrors(err.errors);
      if (!Object.keys(err.errors ?? {}).length) setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div style={{ width: '100%', maxWidth: 520 }}>
        <div className="auth-top">
          <Brand />
          <SettingsMenu withPassword={false} />
        </div>
        <form className="card" style={{ maxWidth: 520 }} onSubmit={submit}>
          <h2>Register your academy</h2>
          <p>You will receive a UID to sign in and enrol your participants.</p>

          <Banner>{error}</Banner>

          <div style={{ marginTop: error ? 14 : 0 }}>
            <Field label="Academy name" value={form.academyName} onChange={set('academyName')} error={errors.academyName} />
            <Field label="Coach name" value={form.coachName} onChange={set('coachName')} error={errors.coachName} />
            <div className="row two">
              <Field label="Phone number" inputMode="numeric" value={form.phone} onChange={set('phone')} error={errors.phone} />
              <Field label="Location" value={form.location} onChange={set('location')} error={errors.location} placeholder="City or district" />
            </div>
            <Field label="Address" error={errors.address}>
              <textarea value={form.address} onChange={set('address')} />
            </Field>
          </div>

          <button className="full" disabled={busy}>{busy ? 'Creating…' : 'Create academy'}</button>
          <div className="foot">Already registered? <Link to="/login">Sign in</Link></div>
        </form>

        {created && (
          <Modal title="Academy registered" onClose={() => navigate('/login')}>
            <p className="muted">Save these credentials — the password can be changed after your first sign-in.</p>
            <Credential label="UID" value={created.credentials.uid} />
            <Credential label="Temporary password" value={created.credentials.password} />
            <button className="full" onClick={() => navigate('/login')}>Go to sign in</button>
          </Modal>
        )}
      </div>
    </div>
  );
}
