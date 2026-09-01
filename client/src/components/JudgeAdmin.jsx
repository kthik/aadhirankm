import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useT } from '../lib/i18n.jsx';
import Collapsible from './Collapsible.jsx';
import JudgeDrawer from './JudgeDrawer.jsx';
import { Banner, Credential, Field, Modal } from './ui.jsx';

const EMPTY = {
  judgeName: '',
  academyName: '',
  location: '',
  address: '',
  mobile: '',
  boutIds: [],
};

/**
 * Supplies the Admin dashboard's judging tabs (bouts, create judge, judges,
 * assign participants) plus the modals they raise.
 *
 * It is a hook rather than a component so all four panels share one copy of the
 * bout and judge state: reassigning a bout in one tab is reflected in the
 * others without a refetch per panel.
 */
export default function useJudgeAdmin({ enabled = true, events = [], participants, onParticipantsChanged }) {
  const t = useT();
  const [bouts, setBouts] = useState([]);
  const [judges, setJudges] = useState([]);
  const [ages, setAges] = useState([]);
  const [newBout, setNewBout] = useState({ boutName: '', eventId: '', ageCategoryId: '' });
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);

  const [assignBout, setAssignBout] = useState('');
  const [selected, setSelected] = useState([]);
  const [assignMsg, setAssignMsg] = useState('');
  const [boutMsg, setBoutMsg] = useState('');
  const [drilldown, setDrilldown] = useState(null);

  async function load() {
    const [b, j, a] = await Promise.all([
      api.get('/judges/bouts'),
      api.get('/judges'),
      api.get('/age-categories'),
    ]);
    setBouts(b.bouts);
    setJudges(j.judges);
    setAges(a.ageCategories);
  }

  // Hooks cannot be called conditionally, so the module flag gates the fetch
  // instead: with judging off, the panels are never rendered anyway.
  useEffect(() => {
    if (enabled) load().catch((err) => setError(err.message));
  }, [enabled]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  /**
   * Posts the judge. A bout that is already held comes back as 409 with
   * `requiresConfirmation`, which opens the confirmation alert rather than
   * silently stealing the bout.
   */
  async function create(confirmReassign) {
    setBusy(true);
    setError('');
    setErrors({});
    try {
      const result = await api.post('/judges', { ...form, confirmReassign });
      setConfirm(null);
      setCreated(result);
      setForm(EMPTY);
      await load();
    } catch (err) {
      if (err.data?.requiresConfirmation) {
        setConfirm(err.data);
      } else {
        setErrors(err.errors);
        if (!Object.keys(err.errors ?? {}).length) setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function assign(remove) {
    setError('');
    setAssignMsg('');
    try {
      const { updatedCount } = await api.post('/participants/assign-bout', {
        participantIds: selected,
        boutId: assignBout,
        remove,
      });
      setSelected([]);
      setAssignMsg(
        remove
          ? `${updatedCount} participant(s) removed from ${assignBout}.`
          : `${updatedCount} participant(s) added to ${assignBout}.`
      );
      await Promise.all([load(), onParticipantsChanged?.()]);
    } catch (err) {
      setError(err.message);
    }
  }

  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function createBout(e) {
    e.preventDefault();
    setError('');
    setErrors({});
    setBoutMsg('');
    try {
      const { bout } = await api.post('/bouts', newBout);
      setNewBout({ boutName: '', eventId: '', ageCategoryId: '' });
      setBoutMsg(`Bout "${bout.boutName}" created.`);
      await load();
    } catch (err) {
      setErrors(err.errors ?? {});
      if (!Object.keys(err.errors ?? {}).length) setError(err.message);
    }
  }

  const boutListPanel = () => (
    <section className="card">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Bout</th>
              <th>Name</th>
              <th>Judge</th>
              <th>Participants</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {bouts.map((b) => (
              <tr key={b.boutId}>
                <td>{b.boutId}</td>
                <td>{b.boutName}</td>
                <td>{b.assignedTo ? `${b.assignedTo.judgeName} (${b.assignedTo.judgeId})` : '—'}</td>
                <td>{b.participantCount}</td>
                <td>
                  <span className={`tag${b.assignedTo ? ' on' : ''}`}>
                    {b.assignedTo ? 'Assigned' : 'Unassigned'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );

  const createBoutPanel = () => (
    <form className="card" onSubmit={createBout}>
      {boutMsg && <Banner kind="ok">{boutMsg}</Banner>}
      <Field label="Bout name" value={newBout.boutName} onChange={(e) => setNewBout({ ...newBout, boutName: e.target.value })} error={errors.boutName} />
      <div className="row two">
        <Field label="Event" error={errors.eventId}>
          <select value={newBout.eventId} onChange={(e) => setNewBout({ ...newBout, eventId: e.target.value })}>
            <option value="">Any event</option>
            {events.map((e) => (
              <option key={e.eventId} value={e.eventId}>{e.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Age group" error={errors.ageCategoryId}>
          <select value={newBout.ageCategoryId} onChange={(e) => setNewBout({ ...newBout, ageCategoryId: e.target.value })}>
            <option value="">Any age</option>
            {ages.filter((a) => a.active !== false).map((a) => (
              <option key={a.ageCategoryId} value={a.ageCategoryId}>{a.name}</option>
            ))}
          </select>
        </Field>
      </div>
      <button>Create bout</button>
    </form>
  );

  const createJudgePanel = () => (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        create(false);
      }}
    >
      <Banner>{error}</Banner>

      <div style={{ marginTop: error ? 14 : 0 }}>
        <div className="row two">
          <Field label="Judge name" value={form.judgeName} onChange={set('judgeName')} error={errors.judgeName} />
          <Field label="Academy name" value={form.academyName} onChange={set('academyName')} error={errors.academyName} />
        </div>
        <div className="row two">
          <Field label="Mobile number" inputMode="numeric" value={form.mobile} onChange={set('mobile')} error={errors.mobile} />
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
                {b.eventName ? ` · ${b.eventName}` : ''}
                {b.assignedTo ? ` — ${b.assignedTo.judgeName}` : ''}
              </label>
            ))}
            {bouts.length === 0 && <span className="muted">Create a bout first.</span>}
          </div>
          {errors.boutIds && <div className="error-text">{errors.boutIds}</div>}
        </div>
      </div>

      <button disabled={busy}>{busy ? 'Creating…' : 'Create judge'}</button>
    </form>
  );

  const judgeListPanel = () => (
    <section className="card">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>UID</th>
              <th>Name</th>
              <th>Academy</th>
              <th>Mobile</th>
              <th>Bouts</th>
              <th>Participants</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {judges.map((j) => (
              <tr key={j.judgeId}>
                <td>{j.judgeId}</td>
                <td>
                  <button type="button" className="link" onClick={() => setDrilldown(j.judgeId)}>
                    {j.judgeName}
                  </button>
                </td>
                <td>{j.academyName}</td>
                <td>{j.mobile}</td>
                <td style={{ whiteSpace: 'normal' }}>{j.boutNames?.join(', ') || '—'}</td>
                <td>{j.participantCount}</td>
                <td>
                  <span className={`tag${j.active ? ' on' : ' locked'}`}>
                    {j.active ? 'Active' : 'Deactivated'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {judges.length === 0 && <div className="empty">No judges registered yet.</div>}
    </section>
  );

  const assignPanel = () => (
    <form className="card" onSubmit={(e) => e.preventDefault()}>
      {assignMsg && <Banner kind="ok">{assignMsg}</Banner>}

      <div className="chips" style={{ margin: '14px 0' }}>
        {participants.map((p) => (
          <label key={p.participantId} className="chip" data-on={selected.includes(p.participantId)}>
            <input
              type="checkbox"
              checked={selected.includes(p.participantId)}
              onChange={() => toggle(p.participantId)}
            />
            {p.participantName} · {p.participantId}
            {p.boutIds?.length
              ? ` (${p.boutIds.map((id) => bouts.find((b) => b.boutId === id)?.boutName ?? id).join(', ')})`
              : ''}
          </label>
        ))}
        {participants.length === 0 && <span className="muted">No participants registered yet.</span>}
      </div>

      <Field
        label="Bout"
        hint="A competitor entered in several events belongs in one bout per event."
      >
        <select value={assignBout} onChange={(e) => setAssignBout(e.target.value)}>
          <option value="">Select a bout…</option>
          {bouts.map((b) => (
            <option key={b.boutId} value={b.boutId}>
              {b.boutName}
              {b.eventName ? ` — ${b.eventName}` : ''}
            </option>
          ))}
        </select>
      </Field>

      <div className="actions">
        <button type="button" disabled={selected.length === 0 || !assignBout} onClick={() => assign(false)}>
          Add {selected.length || ''} to bout
        </button>
        <button
          type="button"
          className="ghost"
          disabled={selected.length === 0 || !assignBout}
          onClick={() => assign(true)}
        >
          Remove from bout
        </button>
      </div>
    </form>
  );

  const modals = (
    <>
      {drilldown && (
        <JudgeDrawer
          judgeId={drilldown}
          bouts={bouts}
          onClose={() => setDrilldown(null)}
          onSaved={load}
        />
      )}
      {confirm && (
        <Modal title="Reassign these bouts?" onClose={() => setConfirm(null)}>
          <p className="muted">
            Confirming releases each bout from its current judge and gives it to the new one.
          </p>
          <div className="podium" style={{ marginBottom: 14 }}>
            {confirm.conflicts.map((c) => (
              <span key={c.boutId} className="tag">
                {c.boutName} — {c.judgeName}
              </span>
            ))}
          </div>
          <div className="actions">
            <button disabled={busy} onClick={() => create(true)}>
              {busy ? 'Reassigning…' : 'Confirm reassignment'}
            </button>
            <button type="button" className="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {created && (
        <Modal title="Judge registered" onClose={() => setCreated(null)}>
          {created.conflicts?.length > 0 && (
            <Banner kind="warn">
              Reassigned from {created.conflicts.map((c) => c.judgeName).join(', ')}.
            </Banner>
          )}
          <p className="muted">{created.judge.judgeName} can sign in with:</p>
          <Credential label="UID" value={created.credentials.uid} />
          <Credential label="Temporary password" value={created.credentials.password} />
          <button className="full" onClick={() => setCreated(null)}>Done</button>
        </Modal>
      )}
    </>
  );

  return {
    modals,
    tabs: [
      {
        id: 'bouts',
        label: t('tab.bouts', 'Bouts'),
        icon: '🎯',
        badge: bouts.length,
        render: () => (
          <>
            <Collapsible
              title="Create a bout"
              description="Event and age group are optional; setting them narrows who is eligible."
              defaultOpen
            >
              {createBoutPanel()}
            </Collapsible>
            <Collapsible
              title="Assign participants to a bout"
              description="A judge sees only the participants sitting in their own bout."
            >
              {assignPanel()}
            </Collapsible>
            <Collapsible
              title="All bouts"
              description="Each bout is held by exactly one judge."
              badge={bouts.length}
            >
              {boutListPanel()}
            </Collapsible>
          </>
        ),
      },
      {
        id: 'judges',
        label: t('tab.judges', 'Judges'),
        icon: '⚖',
        badge: judges.length,
        render: () => (
          <>
            <Collapsible
              title="Register a judge"
              description="The judge receives a UID and the default password."
              defaultOpen
            >
              {createJudgePanel()}
            </Collapsible>
            <Collapsible
              title="All judges"
              description="Click a name to edit, deactivate or delete. Releasing a judge returns their unfinished bouts to the pool."
              badge={judges.length}
            >
              {judgeListPanel()}
            </Collapsible>
          </>
        ),
      },
    ],
  };
}
