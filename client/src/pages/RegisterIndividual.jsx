import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Brand, SettingsMenu } from '../components/Layout.jsx';
import { Banner, Credential, EventPicker, Field, Modal } from '../components/ui.jsx';

const EMPTY = {
  participantName: '',
  fatherName: '',
  age: '',
  mobile: '',
  address: '',
  location: '',
  events: [],
};

export default function RegisterIndividual() {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/events').then((d) => setEvents(d.events)).catch(() => setEvents([]));
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    try {
      setCreated(await api.post('/participants/individual', { ...form, age: Number(form.age) }));
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
          <h2>Register as an individual</h2>
          <p>For competitors entering without an academy.</p>

          <Banner>{error}</Banner>

          <div style={{ marginTop: error ? 14 : 0 }}>
            <Field label="Participant name" value={form.participantName} onChange={set('participantName')} error={errors.participantName} />
            <Field label="Father's name" value={form.fatherName} onChange={set('fatherName')} error={errors.fatherName} />
            <div className="row two">
              <Field label="Age" inputMode="numeric" value={form.age} onChange={set('age')} error={errors.age} />
              <Field label="Mobile number" inputMode="numeric" value={form.mobile} onChange={set('mobile')} error={errors.mobile} />
            </div>
            <Field label="Location" value={form.location} onChange={set('location')} error={errors.location} placeholder="City or district" />
            <Field label="Address" error={errors.address}>
              <textarea value={form.address} onChange={set('address')} />
            </Field>
            <EventPicker
              events={events}
              value={form.events}
              onChange={(events) => setForm({ ...form, events })}
              error={errors.events}
            />
          </div>

          <button className="full" disabled={busy}>{busy ? 'Registering…' : 'Register'}</button>
          <div className="foot">Already registered? <Link to="/login">Sign in</Link></div>
        </form>

        {created && (
          <Modal title="Registration complete" onClose={() => navigate('/login')}>
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
