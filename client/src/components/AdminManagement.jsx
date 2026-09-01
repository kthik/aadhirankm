import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Collapsible from './Collapsible.jsx';
import { Banner, Credential, Field, Modal, Stat } from './ui.jsx';

const EMPTY = { name: '', email: '', password: '', tournamentIds: [] };

/**
 * Admin accounts.
 *
 * A tournament list narrows an admin to those tournaments; leaving it empty
 * means unrestricted, which is how every admin behaved before tournaments
 * existed. Super Admin overrides the restriction either way.
 */
export default function AdminManagement() {
  const [admins, setAdmins] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [created, setCreated] = useState(null);
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [a, t] = await Promise.all([api.get('/admins'), api.get('/tournaments')]);
    setAdmins(a.admins);
    setTournaments(t.tournaments);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  async function run(fn) {
    setBusy(true);
    setError('');
    setErrors({});
    setMessage('');
    try {
      const msg = await fn();
      if (msg) setMessage(msg);
      await load();
    } catch (err) {
      setErrors(err.errors ?? {});
      if (!Object.keys(err.errors ?? {}).length) setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const toggleTournament = (id) =>
    setForm((f) => ({
      ...f,
      tournamentIds: f.tournamentIds.includes(id)
        ? f.tournamentIds.filter((x) => x !== id)
        : [...f.tournamentIds, id],
    }));

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (editing) {
        await api.put(`/admins/${editing}`, form);
        setEditing(null);
        setForm(EMPTY);
        return 'Admin updated.';
      }
      const res = await api.post('/admins', form);
      setCreated(res);
      setForm(EMPTY);
      return null;
    });
  };

  const picker = (
    <div className={`field${errors.tournamentIds ? ' invalid' : ''}`}>
      <span>Tournament privileges</span>
      <div className="chips">
        {tournaments.map((t) => (
          <label key={t.tournamentId} className="chip" data-on={form.tournamentIds.includes(t.tournamentId)}>
            <input
              type="checkbox"
              checked={form.tournamentIds.includes(t.tournamentId)}
              onChange={() => toggleTournament(t.tournamentId)}
            />
            {t.name}
          </label>
        ))}
        {tournaments.length === 0 && <span className="muted">Create a tournament first.</span>}
      </div>
      <div className="hint">Leave all unticked for access to every tournament.</div>
      {errors.tournamentIds && <div className="error-text">{errors.tournamentIds}</div>}
    </div>
  );

  return (
    <>
      <div className="grid cols-3">
        <Stat label="Admins" value={admins.length} />
        <Stat label="Active" value={admins.filter((a) => a.active).length} />
        <Stat label="On default password" value={admins.filter((a) => a.usesDefaultPassword).length} />
      </div>

      <Banner>{error}</Banner>
      {message && <Banner kind="ok">{message}</Banner>}

      <Collapsible
        title={editing ? `Edit ${editing}` : 'Create an admin'}
        description="A new admin signs in with the default password unless you set one here."
        defaultOpen
      >
        <form className="card" onSubmit={submit}>
          <div className="row two">
            <Field label="Admin name" value={form.name} onChange={set('name')} error={errors.name} />
            <Field label="Email" type="email" value={form.email} onChange={set('email')} error={errors.email} />
          </div>
          {!editing && (
            <Field
              label="Password"
              type="password"
              value={form.password}
              onChange={set('password')}
              error={errors.password}
              hint="Leave blank to use the default password."
              autoComplete="new-password"
            />
          )}
          {picker}
          <div className="actions">
            <button disabled={busy}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Create admin'}
            </button>
            {editing && (
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setEditing(null);
                  setForm(EMPTY);
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </Collapsible>

      <Collapsible title="All admins" badge={admins.length} defaultOpen>
        <section className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>UID</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Tournaments</th>
                  <th>Password</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.uid}>
                    <td>{a.uid}</td>
                    <td>{a.name}</td>
                    <td>{a.email ?? '—'}</td>
                    <td style={{ whiteSpace: 'normal' }}>
                      {a.tournamentNames.length ? a.tournamentNames.join(', ') : 'All'}
                    </td>
                    <td>
                      <span className={`tag${a.usesDefaultPassword ? ' locked' : ' on'}`}>
                        {a.usesDefaultPassword ? 'Default' : 'Changed'}
                      </span>
                    </td>
                    <td>
                      <span className={`tag${a.active ? ' on' : ' locked'}`}>
                        {a.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div className="actions" style={{ margin: 0 }}>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            setEditing(a.uid);
                            setForm({
                              name: a.name,
                              email: a.email ?? '',
                              password: '',
                              tournamentIds: a.tournamentIds ?? [],
                            });
                          }}
                        >
                          Edit
                        </button>
                        <button type="button" className="ghost" onClick={() => setResetting(a)}>
                          Password
                        </button>
                        <button
                          type="button"
                          className="ghost danger"
                          onClick={() => setConfirmDelete({ admin: a, force: false })}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {admins.length === 0 && <div className="empty">No admins yet.</div>}
        </section>
      </Collapsible>

      {created && (
        <Modal title="Admin created" onClose={() => setCreated(null)}>
          <p className="muted" style={{ marginTop: 0 }}>{created.admin.name} can sign in with:</p>
          <Credential label="UID" value={created.credentials.uid} />
          <Credential label="Password" value={created.credentials.password} />
          <button className="full" onClick={() => setCreated(null)}>Done</button>
        </Modal>
      )}

      {resetting && (
        <Modal
          title={`Reset password for ${resetting.name}`}
          onClose={() => {
            setResetting(null);
            setNewPassword('');
          }}
        >
          <Field
            label="New password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            error={errors.newPassword}
            hint="Leave blank to reset to the default password."
            autoComplete="new-password"
          />
          <Banner kind="warn">
            Their current password stops working immediately. The new one is shown once.
          </Banner>
          <div className="actions" style={{ marginTop: 14 }}>
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const res = await api.post(`/admins/${resetting.uid}/reset-password`, {
                    newPassword: newPassword.trim() || undefined,
                  });
                  setResetting(null);
                  setNewPassword('');
                  return `Password for ${res.uid} is now: ${res.password}`;
                })
              }
            >
              {busy ? 'Saving…' : 'Confirm reset'}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setResetting(null);
                setNewPassword('');
              }}
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal title="Delete this admin?" onClose={() => setConfirmDelete(null)}>
          <p className="muted" style={{ marginTop: 0 }}>
            {confirmDelete.admin.name} ({confirmDelete.admin.uid}) and their sign-in will be
            removed. Competition data is untouched.
          </p>
          {confirmDelete.error && <Banner kind="warn">{confirmDelete.error}</Banner>}
          <div className="actions" style={{ marginTop: 14 }}>
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  try {
                    await api.del(
                      `/admins/${confirmDelete.admin.uid}${confirmDelete.force ? '?force=true' : ''}`
                    );
                    setConfirmDelete(null);
                    return `${confirmDelete.admin.uid} deleted.`;
                  } catch (err) {
                    if (err.data?.requiresConfirmation) {
                      setConfirmDelete({ ...confirmDelete, force: true, error: err.message });
                      return null;
                    }
                    throw err;
                  }
                })
              }
            >
              {busy ? 'Deleting…' : confirmDelete.force ? 'Delete anyway' : 'Delete admin'}
            </button>
            <button type="button" className="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
