import { useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { Banner, Field } from './ui.jsx';

const EMPTY = { currentPassword: '', newPassword: '' };

/** Shared reset-password card, shown on every role dashboard. */
export default function ChangePassword() {
  const { refresh } = useSession();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    setDone(false);
    try {
      await api.post('/auth/change-password', form);
      setForm(EMPTY);
      setDone(true);
      await refresh();
    } catch (err) {
      setErrors(err.errors);
      if (!Object.keys(err.errors ?? {}).length) setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Reset password</h2>
      <p>Use at least 6 characters.</p>
      <Banner>{error}</Banner>
      {done && <Banner kind="ok">Password updated.</Banner>}
      <div style={{ marginTop: error || done ? 14 : 0 }}>
        <Field
          label="Current password"
          type="password"
          value={form.currentPassword}
          onChange={set('currentPassword')}
          error={errors.currentPassword}
        />
        <Field
          label="New password"
          type="password"
          value={form.newPassword}
          onChange={set('newPassword')}
          error={errors.newPassword}
        />
      </div>
      <button disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
    </form>
  );
}
