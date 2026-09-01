import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Banner, Credential, Field, Modal, Stat } from './ui.jsx';

/**
 * Academy detail: contact record, squad, progress, and the sign-in an admin
 * needs when a coach calls up locked out — their UID, and a password reset.
 */
export default function AcademyDrawer({ academyId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const [newPassword, setNewPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [confirm, setConfirm] = useState(null);
  const [issued, setIssued] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setData(await api.get(`/academies/${academyId}`));
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [academyId]);

  /**
   * Resets to the configured default when no password is typed, which is the
   * usual case; a typed one is used as given. Either way the server returns
   * what was set, since the admin has to read it back to the coach.
   */
  async function reset() {
    setBusy(true);
    setError('');
    setErrors({});
    try {
      const res = await api.post(`/academies/${academyId}/reset-password`, {
        newPassword: newPassword.trim() || undefined,
      });
      setConfirm(null);
      setIssued(res);
      setNewPassword('');
      await load();
    } catch (err) {
      setConfirm(null);
      setErrors(err.errors ?? {});
      if (!Object.keys(err.errors ?? {}).length) setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const a = data?.academy;
  const account = data?.account;
  const custom = newPassword.trim() !== '';

  return (
    <Modal title={a?.academyName ?? 'Academy'} onClose={onClose}>
      <Banner>{error}</Banner>

      {a && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            {a.academyId} · Coach {a.coachName} · {a.location}
          </p>

          <div className="grid cols-3" style={{ margin: '14px 0' }}>
            <Stat label="Participants" value={data.stats.participants} />
            <Stat label="Event entries" value={data.stats.eventEntries} />
            <Stat label="Scored" value={data.stats.completed} />
          </div>

          <h3 style={{ fontSize: 14, margin: '16px 0 8px' }}>Sign-in</h3>
          {account ? (
            <>
              <Credential label="UID" value={account.uid} />
              <p className="muted" style={{ fontSize: 13 }}>
                {account.usesDefaultPassword
                  ? 'Still on the default password.'
                  : 'Password has been changed from the default.'}
                {account.lastLoginAt
                  ? ` Last signed in ${new Date(account.lastLoginAt).toLocaleString()}.`
                  : ' Never signed in.'}
              </p>

              {issued && (
                <Banner kind="ok">
                  Password {issued.resetToDefault ? 'reset to the default' : 'updated'}. Give the
                  coach: <b>{issued.password}</b>
                </Banner>
              )}

              <Field
                label="New password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                error={errors.newPassword}
                hint="Leave blank to reset to the default password."
                autoComplete="new-password"
              />
              <div className="actions">
                <button type="button" disabled={busy} onClick={() => setConfirm(true)}>
                  {custom ? 'Set password' : 'Reset to default'}
                </button>
              </div>
            </>
          ) : (
            <Banner kind="warn">This academy has no sign-in record.</Banner>
          )}

          <h3 style={{ fontSize: 14, margin: '18px 0 8px' }}>Contact</h3>
          <div className="cred">
            <div>
              <div className="k">Phone</div>
              <div className="v" style={{ fontSize: 15 }}>{a.phone}</div>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>{a.address}</p>

          <h3 style={{ fontSize: 14, margin: '18px 0 8px' }}>Participants</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>UID</th><th>Name</th><th>Age</th><th>Events</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.participants.map((p) => (
                  <tr key={p.participantId}>
                    <td>{p.participantId}</td>
                    <td>{p.participantName}</td>
                    <td>{p.age}</td>
                    <td style={{ whiteSpace: 'normal' }}>{p.eventNames.join(', ')}</td>
                    <td>
                      <span className={`tag${p.completed ? ' on' : ''}`}>
                        {p.completed ? 'Scored' : 'Waiting'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.participants.length === 0 && (
            <div className="empty">No participants registered yet.</div>
          )}
        </>
      )}

      {confirm && (
        <Modal title="Reset this password?" onClose={() => setConfirm(null)}>
          <p className="muted" style={{ marginTop: 0 }}>
            {custom
              ? `${a.academyName} will sign in with the password you typed.`
              : `${a.academyName} will be put back to the default password.`}{' '}
            Their current password stops working immediately.
          </p>
          <Banner kind="warn">
            Tell the coach the new password — it is shown once here and stored hashed
            afterwards.
          </Banner>
          <div className="actions" style={{ marginTop: 14 }}>
            <button disabled={busy} onClick={reset}>
              {busy ? 'Saving…' : 'Confirm reset'}
            </button>
            <button type="button" className="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
