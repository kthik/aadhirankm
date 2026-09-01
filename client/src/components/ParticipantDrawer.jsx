import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Banner, EventPicker, Field, Modal } from './ui.jsx';

/**
 * Participant drill-down: event history, every judge's sheet round by round,
 * the position achieved, and the fields an admin may correct.
 */
export default function ParticipantDrawer({ participantId, events, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/dashboard/participants/${participantId}`)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setForm({
          participantName: d.participant.participantName,
          fatherName: d.participant.fatherName,
          age: String(d.participant.age),
          mobile: d.participant.mobile,
          address: d.participant.address,
          location: d.participant.location,
          events: d.participant.events,
        });
      })
      .catch((err) => setError(err.message));
    return () => { cancelled = true; };
  }, [participantId]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    setSaved(false);
    try {
      await api.put(`/participants/${participantId}`, { ...form, age: Number(form.age) });
      setSaved(true);
      await onSaved?.();
    } catch (err) {
      setErrors(err.errors);
      if (!Object.keys(err.errors ?? {}).length) setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const p = data?.participant;

  return (
    <Modal title={p?.participantName ?? 'Participant'} onClose={onClose}>
      <Banner>{error}</Banner>

      {p && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            {p.participantId} · {p.ageCategoryName ?? 'No age band'} · {p.boutId ?? 'No bout'}
            {p.positionName ? ` · Position ${p.positionName}` : ''}
          </p>

          <h3 style={{ fontSize: 14, margin: '16px 0 8px' }}>Event history</h3>
          <div className="podium">
            {data.events.map((e) => (
              <span key={e.eventId} className="tag">{e.name ?? e.eventId}</span>
            ))}
            {data.events.length === 0 && <span className="muted">No events.</span>}
          </div>

          <h3 style={{ fontSize: 14, margin: '18px 0 8px' }}>Scores per round</h3>
          {data.history.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>Not yet judged.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Bout</th>
                    <th>Judge</th>
                    {data.categories.map((c) => (
                      <th key={c.categoryId}>{c.categoryName}</th>
                    ))}
                    <th>Total</th>
                    <th>Position</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.map((h) => (
                    <tr key={h.scoreId}>
                      <td>{h.boutName}</td>
                      <td>{h.judgeName}</td>
                      {data.categories.map((c) => (
                        <td key={c.categoryId}>{h.scores?.[c.categoryId] ?? '—'}</td>
                      ))}
                      <td><b>{h.total}</b></td>
                      <td>{h.positionName ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 style={{ fontSize: 14, margin: '18px 0 8px' }}>Admin update</h3>
          {saved && <Banner kind="ok">Participant updated.</Banner>}

          <form onSubmit={submit}>
            <div className="row two">
              <Field label="Name" value={form.participantName} onChange={set('participantName')} error={errors.participantName} />
              <Field label="Father's name" value={form.fatherName} onChange={set('fatherName')} error={errors.fatherName} />
            </div>
            <div className="row two">
              <Field label="Age" inputMode="numeric" value={form.age} onChange={set('age')} error={errors.age} />
              <Field label="Mobile" inputMode="numeric" value={form.mobile} onChange={set('mobile')} error={errors.mobile} />
            </div>
            <Field label="Location" value={form.location} onChange={set('location')} error={errors.location} />
            <Field label="Address" error={errors.address}>
              <textarea value={form.address} onChange={set('address')} />
            </Field>
            <EventPicker
              events={events}
              value={form.events}
              onChange={(next) => setForm({ ...form, events: next })}
              error={errors.events}
            />
            <div className="actions">
              <button disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
              <button type="button" className="ghost" onClick={onClose}>Close</button>
            </div>
          </form>
        </>
      )}
    </Modal>
  );
}
