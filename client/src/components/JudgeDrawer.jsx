import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Banner, Field, Modal } from './ui.jsx';

/** Judge detail with an admin edit for their details and the bouts they hold. */
export default function JudgeDrawer({ judgeId, bouts, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [lifecycle, setLifecycle] = useState(null);
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    const d = await api.get(`/judges/${judgeId}`);
    setData(d);
    setForm({
      judgeName: d.judge.judgeName,
      academyName: d.judge.academyName,
      location: d.judge.location,
      address: d.judge.address,
      mobile: d.judge.mobile,
      boutIds: d.judge.boutIds ?? [],
    });
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [judgeId]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save(confirmReassign) {
    setBusy(true);
    setError('');
    setErrors({});
    setSaved(false);
    try {
      await api.put(`/judges/${judgeId}`, { ...form, confirmReassign });
      setConfirm(null);
      setSaved(true);
      await load();
      await onSaved?.();
    } catch (err) {
      if (err.data?.requiresConfirmation) setConfirm(err.data);
      else {
        setErrors(err.errors);
        if (!Object.keys(err.errors ?? {}).length) setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * Deactivate or delete. Either way the server hands back the bouts it
   * released, which is the part an admin needs to see: those bouts are now
   * unassigned and need a new judge.
   */
  async function runLifecycle(action, force = false) {
    setBusy(true);
    setError('');
    try {
      const res =
        action === 'delete'
          ? await api.del(`/judges/${judgeId}${force ? '?force=true' : ''}`)
          : await api.patch(`/judges/${judgeId}`, { active: action === 'activate' });

      setLifecycle(null);

      if (action === 'delete') {
        onSaved?.();
        onClose();
        return;
      }
      setNotice(
        res.released?.length
          ? `${res.judge.active ? 'Reactivated' : 'Deactivated'}. Unassigned: ${res.released.join(', ')}.`
          : `${res.judge.active ? 'Reactivated' : 'Deactivated'}.`
      );
      await load();
      await onSaved?.();
    } catch (err) {
      if (err.data?.requiresConfirmation) setLifecycle({ action, ...err.data });
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const j = data?.judge;

  return (
    <Modal title={j?.judgeName ?? 'Judge'} onClose={onClose}>
      <Banner>{error}</Banner>

      {j && form && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            {j.judgeId} · {j.academyName} · {j.participantCount} participant
            {j.participantCount === 1 ? '' : 's'} across {j.boutIds.length} bout
            {j.boutIds.length === 1 ? '' : 's'}
            {' · '}
            <span className={`tag${j.active ? ' on' : ' locked'}`}>
              {j.active ? 'Active' : 'Deactivated'}
            </span>
          </p>

          {notice && <Banner kind="ok">{notice}</Banner>}

          {!j.active && (
            <Banner kind="warn">
              This judge cannot sign in. Their unfinished bouts were returned to the pool.
            </Banner>
          )}

          <h3 style={{ fontSize: 14, margin: '16px 0 8px' }}>Bouts held</h3>
          <div className="podium">
            {data.bouts.map((b) => (
              <span key={b.boutId} className="tag on">
                {b.boutName}
                {b.eventName ? ` · ${b.eventName}` : ''} · {b.participantCount}
              </span>
            ))}
            {data.bouts.length === 0 && <span className="muted">No bouts assigned.</span>}
          </div>

          <h3 style={{ fontSize: 14, margin: '18px 0 8px' }}>Sheets filed</h3>
          {data.sheets.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>Nothing scored yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Participant</th><th>Bout</th><th>Total</th><th>Position</th></tr>
                </thead>
                <tbody>
                  {data.sheets.map((s) => (
                    <tr key={s.scoreId}>
                      <td>{s.participantName}</td>
                      <td>{s.boutName}</td>
                      <td><b>{s.total}</b></td>
                      <td>{s.positionName ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 style={{ fontSize: 14, margin: '18px 0 8px' }}>Admin update</h3>
          {saved && <Banner kind="ok">Judge updated.</Banner>}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              save(false);
            }}
          >
            <div className="row two">
              <Field label="Judge name" value={form.judgeName} onChange={set('judgeName')} error={errors.judgeName} />
              <Field label="Academy name" value={form.academyName} onChange={set('academyName')} error={errors.academyName} />
            </div>
            <div className="row two">
              <Field label="Mobile" inputMode="numeric" value={form.mobile} onChange={set('mobile')} error={errors.mobile} />
              <Field label="Location" value={form.location} onChange={set('location')} error={errors.location} />
            </div>
            <Field label="Address" error={errors.address}>
              <textarea value={form.address} onChange={set('address')} />
            </Field>

            <div className={`field${errors.boutIds ? ' invalid' : ''}`}>
              <span>Bouts assigned</span>
              <div className="chips">
                {bouts.map((b) => (
                  <label key={b.boutId} className="chip" data-on={form.boutIds.includes(b.boutId)}>
                    <input
                      type="checkbox"
                      checked={form.boutIds.includes(b.boutId)}
                      onChange={() =>
                        setForm({
                          ...form,
                          boutIds: form.boutIds.includes(b.boutId)
                            ? form.boutIds.filter((id) => id !== b.boutId)
                            : [...form.boutIds, b.boutId],
                        })
                      }
                    />
                    {b.boutName}
                    {b.assignedTo && b.assignedTo.judgeId !== judgeId
                      ? ` — ${b.assignedTo.judgeName}`
                      : ''}
                  </label>
                ))}
              </div>
              {errors.boutIds && <div className="error-text">{errors.boutIds}</div>}
            </div>

            <div className="actions">
              <button disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
              <button type="button" className="ghost" onClick={onClose}>Close</button>
            </div>
          </form>

          <h3 style={{ fontSize: 14, margin: '20px 0 8px' }}>Manage</h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Deactivating or deleting returns any bout they have not finished to the pool as
            unassigned. Bouts they finished keep their name, so the results stay attributable.
          </p>
          <div className="actions">
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() =>
                j.active
                  ? setLifecycle({ action: 'deactivate' })
                  : runLifecycle('activate')
              }
            >
              {j.active ? 'Deactivate judge' : 'Reactivate judge'}
            </button>
            <button
              type="button"
              className="ghost danger"
              disabled={busy}
              onClick={() => setLifecycle({ action: 'delete' })}
            >
              Delete judge
            </button>
          </div>
        </>
      )}

      {lifecycle && (
        <Modal
          title={lifecycle.action === 'delete' ? 'Delete this judge?' : 'Deactivate this judge?'}
          onClose={() => setLifecycle(null)}
        >
          <p className="muted" style={{ marginTop: 0 }}>
            {lifecycle.action === 'delete'
              ? `${j?.judgeName} and their sign-in will be removed. Scores they already filed are kept — deleting a judge must not delete competitors' results.`
              : `${j?.judgeName} will not be able to sign in. Their unfinished bouts become unassigned.`}
          </p>

          {lifecycle.keptBouts?.length > 0 && (
            <Banner kind="warn">
              Finished bouts staying on record under their name: {lifecycle.keptBouts.join(', ')}.
            </Banner>
          )}
          {lifecycle.released?.length > 0 && (
            <Banner kind="ok">Already unassigned: {lifecycle.released.join(', ')}.</Banner>
          )}

          <div className="actions" style={{ marginTop: 14 }}>
            <button
              disabled={busy}
              onClick={() => runLifecycle(lifecycle.action, lifecycle.requiresConfirmation)}
            >
              {busy
                ? 'Working…'
                : lifecycle.action === 'delete'
                  ? 'Delete judge'
                  : 'Deactivate judge'}
            </button>
            <button type="button" className="ghost" onClick={() => setLifecycle(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {confirm && (
        <Modal title="Reassign these bouts?" onClose={() => setConfirm(null)}>
          <p className="muted">
            Confirming releases each bout from its current judge and gives it to {j?.judgeName}.
          </p>
          <div className="podium" style={{ marginBottom: 14 }}>
            {confirm.conflicts.map((c) => (
              <span key={c.boutId} className="tag">{c.boutName} — {c.judgeName}</span>
            ))}
          </div>
          <div className="actions">
            <button disabled={busy} onClick={() => save(true)}>
              {busy ? 'Reassigning…' : 'Confirm reassignment'}
            </button>
            <button type="button" className="ghost" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
