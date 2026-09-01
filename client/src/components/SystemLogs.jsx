import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Banner, Field, Stat } from './ui.jsx';

const GROUPS = [
  { id: '', label: 'Everything' },
  { id: 'admin.', label: 'Admin accounts' },
  { id: 'tournament.', label: 'Tournaments' },
  { id: 'backup.', label: 'Backup & restore' },
];

/** The audit trail: who did what, newest first. */
export default function SystemLogs() {
  const [logs, setLogs] = useState([]);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(
    () =>
      api
        .get(`/logs${action ? `?action=${encodeURIComponent(action)}` : ''}`)
        .then((d) => setLogs(d.logs)),
    [action]
  );

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  return (
    <>
      <div className="grid cols-3">
        <Stat label="Entries shown" value={logs.length} />
        <Stat
          label="Distinct actors"
          value={new Set(logs.map((l) => l.actor)).size}
        />
        <Stat label="Last action" value={logs[0] ? new Date(logs[0].at).toLocaleTimeString() : '—'} />
      </div>

      <Banner>{error}</Banner>

      <section className="card">
        <h2>System logs</h2>
        <p>
          Administrative actions only — account changes, tournament switches, backups and
          restores. Routine reads are not recorded, and no password is ever written here.
        </p>

        <div className="filters">
          <Field label="Show">
            <select value={action} onChange={(e) => setAction(e.target.value)}>
              {GROUPS.map((g) => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr><th>When</th><th>Actor</th><th>Role</th><th>Action</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.logId}>
                  <td>{new Date(l.at).toLocaleString()}</td>
                  <td>{l.actor}</td>
                  <td>{l.actorRole}</td>
                  <td><span className="tag">{l.action}</span></td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 420 }}>
                    <code style={{ fontSize: 12 }}>{JSON.stringify(l.detail)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {logs.length === 0 && <div className="empty">Nothing recorded yet.</div>}
      </section>
    </>
  );
}
