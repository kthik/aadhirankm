import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Collapsible from './Collapsible.jsx';
import { Banner, Field, Modal, Stat } from './ui.jsx';

const EMPTY = { name: '', description: '', location: '', startDate: '', endDate: '' };

/**
 * Tournament management.
 *
 * A tournament switches itself off once its end date passes; the sweep runs on
 * boot and on a timer, and "Check now" runs it on demand. Reactivating a
 * finished tournament is refused by the server rather than quietly undone on
 * the next sweep, so the admin is told to extend the end date instead.
 */
export default function TournamentAdmin() {
  const [tournaments, setTournaments] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () => api.get('/tournaments').then((d) => setTournaments(d.tournaments)),
    []
  );

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  async function run(fn) {
    setBusy(true);
    setError('');
    setErrors({});
    setMessage('');
    try {
      setMessage(await fn());
      await load();
    } catch (err) {
      setErrors(err.errors ?? {});
      if (!Object.keys(err.errors ?? {}).length) setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (editing) {
        const { tournament } = await api.put(`/tournaments/${editing}`, form);
        setEditing(null);
        setForm(EMPTY);
        return `${tournament.name} updated.`;
      }
      const { tournament } = await api.post('/tournaments', form);
      setForm(EMPTY);
      return `${tournament.name} created as ${tournament.tournamentId}.`;
    });
  };

  const running = tournaments.filter((t) => t.running).length;

  return (
    <>
      <div className="grid cols-3">
        <Stat label="Tournaments" value={tournaments.length} />
        <Stat label="Running now" value={running} />
        <Stat label="Records held" value={tournaments.reduce((n, t) => n + t.records, 0)} />
      </div>

      <Banner>{error}</Banner>
      {message && <Banner kind="ok">{message}</Banner>}

      <Collapsible
        title={editing ? 'Edit tournament' : 'Create a tournament'}
        description="Dates are inclusive: a tournament ending today is still running."
        defaultOpen
      >
        <form className="card" onSubmit={submit}>
          <div className="row two">
            <Field label="Name" value={form.name} onChange={set('name')} error={errors.name} />
            <Field label="Location" value={form.location} onChange={set('location')} error={errors.location} />
          </div>
          <div className="row two">
            <Field label="Start date" type="date" value={form.startDate} onChange={set('startDate')} error={errors.startDate} />
            <Field
              label="End date"
              type="date"
              value={form.endDate}
              onChange={set('endDate')}
              error={errors.endDate}
              hint="Leave blank for an open-ended tournament."
            />
          </div>
          <Field label="Description" error={errors.description}>
            <textarea value={form.description} onChange={set('description')} />
          </Field>
          <div className="actions">
            <button disabled={busy}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Create tournament'}
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

      <Collapsible title="All tournaments" badge={tournaments.length} defaultOpen>
        <section className="card">
          <div className="actions" style={{ marginBottom: 14 }}>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const { deactivated } = await api.post('/tournaments/auto-deactivate');
                  return deactivated.length
                    ? `Switched off: ${deactivated.join(', ')}.`
                    : 'Nothing has expired.';
                })
              }
            >
              Check end dates now
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Dates</th>
                  <th>Location</th>
                  <th>Records</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tournaments.map((t) => (
                  <tr key={t.tournamentId}>
                    <td>{t.tournamentId}</td>
                    <td>{t.name}</td>
                    <td>
                      {t.startDate} → {t.endDate || 'open'}
                    </td>
                    <td>{t.location || '—'}</td>
                    <td>{t.records}</td>
                    <td>
                      <span className={`tag${t.running ? ' on' : ' locked'}`}>
                        {t.running ? 'Running' : t.status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div className="actions" style={{ margin: 0 }}>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            setEditing(t.tournamentId);
                            setForm({
                              name: t.name,
                              description: t.description ?? '',
                              location: t.location ?? '',
                              startDate: t.startDate ?? '',
                              endDate: t.endDate ?? '',
                            });
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              const next = t.status === 'active' ? 'inactive' : 'active';
                              await api.patch(`/tournaments/${t.tournamentId}/status`, { status: next });
                              return `${t.name} ${next === 'active' ? 'activated' : 'deactivated'}.`;
                            })
                          }
                        >
                          {t.status === 'active' ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {tournaments.length === 0 && <div className="empty">No tournaments yet.</div>}
        </section>
      </Collapsible>
    </>
  );
}
