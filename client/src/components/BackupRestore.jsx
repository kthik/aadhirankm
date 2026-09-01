import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import Collapsible from './Collapsible.jsx';
import { Banner, Field, Modal } from './ui.jsx';

const EMPTY_FILTER = { tournamentId: '', academyId: '', participantId: '', from: '', to: '' };

/** Reads a picked file as base64, which is how the workbook reaches the API. */
function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('That file could not be read'));
    reader.readAsDataURL(file);
  });
}

function ScopeFields({ filter, setFilter, tournaments, academies }) {
  const set = (k) => (e) => setFilter({ ...filter, [k]: e.target.value });
  return (
    <div className="filters">
      <Field label="Tournament">
        <select value={filter.tournamentId} onChange={set('tournamentId')}>
          <option value="">All tournaments</option>
          {tournaments.map((t) => (
            <option key={t.tournamentId} value={t.tournamentId}>{t.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Academy">
        <select value={filter.academyId} onChange={set('academyId')}>
          <option value="">All academies</option>
          <option value="none">Individual entrants</option>
          {academies.map((a) => (
            <option key={a.academyId} value={a.academyId}>{a.academyName}</option>
          ))}
        </select>
      </Field>
      <Field label="Participant UID">
        <input value={filter.participantId} onChange={set('participantId')} placeholder="P001" />
      </Field>
      <Field label="From date">
        <input type="date" value={filter.from} onChange={set('from')} />
      </Field>
      <Field label="To date">
        <input type="date" value={filter.to} onChange={set('to')} />
      </Field>
    </div>
  );
}

function CountTable({ rows, columns }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Table</th>
            {columns.map((c) => <th key={c.header}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.collection}>
              <td>{r.collection}</td>
              {columns.map((c) => <td key={c.header}>{c.value(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Backup, restore and the post-backup delete.
 *
 * Backup and delete are deliberately separate actions rather than one
 * "backup and clear" button: a download that also wipes data on the way out is
 * far too easy to fire by accident. Restore skips rows that already exist
 * instead of overwriting them, so it is safe to run twice.
 */
export default function BackupRestore() {
  const { user } = useSession();
  const isSuper = user?.role === 'SUPER_ADMIN';

  const inputRef = useRef(null);
  const [tournaments, setTournaments] = useState([]);
  const [academies, setAcademies] = useState([]);
  const [history, setHistory] = useState([]);

  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [preview, setPreview] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const [restoreFilter, setRestoreFilter] = useState(EMPTY_FILTER);
  const [deleteBefore, setDeleteBefore] = useState(false);
  const [pending, setPending] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const narrowed = Object.values(filter).some(Boolean);
  const query = new URLSearchParams(
    Object.entries(filter).filter(([, v]) => v)
  ).toString();

  const loadPreview = useCallback(async () => {
    const [p, h] = await Promise.all([
      api.get(`/backup/preview${query ? `?${query}` : ''}`),
      api.get('/backup/history').catch(() => ({ backups: [] })),
    ]);
    setPreview(p.summary);
    setHistory(h.backups);
  }, [query]);

  useEffect(() => {
    Promise.all([
      api.get('/tournaments').then((d) => setTournaments(d.tournaments)).catch(() => {}),
      api.get('/academies').then((d) => setAcademies(d.academies)).catch(() => {}),
    ]);
  }, []);

  useEffect(() => {
    loadPreview().catch((err) => setError(err.message));
  }, [loadPreview]);

  const selected = preview.reduce((n, r) => n + r.selected, 0);

  async function download() {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const res = await fetch(`/api/backup/export${query ? `?${query}` : ''}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export failed');

      const blob = await res.blob();
      const name =
        res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ??
        'veeran-backup.xlsx';

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      setMessage(`Downloaded ${name}.`);
      await loadPreview();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function runDelete(confirm) {
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/backup/delete', { ...filter, confirm });
      setConfirmDelete(null);
      setMessage(`Deleted ${res.total} record(s).`);
      await loadPreview();
    } catch (err) {
      if (err.data?.requiresConfirmation) setConfirmDelete(err.data);
      else {
        setConfirmDelete(null);
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function pick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const fileBase64 = await toBase64(file);
      const { summary } = await api.post('/backup/preview-restore', {
        fileBase64,
        filter: restoreFilter,
      });
      setPending({ fileBase64, summary, name: file.name });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function runRestore() {
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/backup/restore', {
        fileBase64: pending.fileBase64,
        filter: restoreFilter,
        deleteBefore,
        confirm: true,
      });
      const added = Object.values(res.result).reduce((n, r) => n + r.added, 0);
      const skipped = Object.values(res.result).reduce((n, r) => n + r.skipped, 0);
      setPending(null);
      setMessage(`Restored ${added} row(s); skipped ${skipped} already present. Reload to see them.`);
      await loadPreview();
    } catch (err) {
      setPending(null);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Banner>{error}</Banner>
      {message && <Banner kind="ok">{message}</Banner>}

      <Collapsible
        title="Backup"
        description="Leave the scope empty for a full backup, or narrow it to one tournament, academy, competitor or date range."
        defaultOpen
      >
        <section className="card">
          {isSuper ? (
            <ScopeFields
              filter={filter}
              setFilter={setFilter}
              tournaments={tournaments}
              academies={academies}
            />
          ) : (
            <Banner kind="warn">
              Filtered backups are Super Admin only. This will take a full backup.
            </Banner>
          )}

          <p className="muted" style={{ marginTop: 14 }}>
            {narrowed ? 'This scope selects' : 'A full backup covers'} <b>{selected}</b> record(s).
          </p>
          <CountTable
            rows={preview}
            columns={[
              { header: 'Selected', value: (r) => r.selected },
              { header: 'Total', value: (r) => r.total },
            ]}
          />

          <div className="actions" style={{ marginTop: 14 }}>
            <button type="button" disabled={busy} onClick={download}>
              {busy ? 'Working…' : narrowed ? 'Download filtered backup' : 'Download full backup'}
            </button>
            {isSuper && (
              <button
                type="button"
                className="ghost danger"
                disabled={busy || selected === 0}
                onClick={() => runDelete(false)}
              >
                Delete these records
              </button>
            )}
            {narrowed && (
              <button type="button" className="ghost" onClick={() => setFilter(EMPTY_FILTER)}>
                Clear scope
              </button>
            )}
          </div>
          {isSuper && (
            <p className="muted" style={{ fontSize: 13 }}>
              Deleting is a separate step on purpose. Take the backup, check the file, then delete.
            </p>
          )}
        </section>
      </Collapsible>

      {isSuper && (
        <Collapsible
          title="Restore"
          description="Rows already present are skipped, never overwritten, so a restore is safe to run twice."
        >
          <section className="card">
            <ScopeFields
              filter={restoreFilter}
              setFilter={setRestoreFilter}
              tournaments={tournaments}
              academies={academies}
            />
            <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
              A scope here restores only the matching part of the file. Leave it empty to restore
              everything in the workbook.
            </p>

            <label className="chip" data-on={deleteBefore} style={{ marginTop: 8 }}>
              <input
                type="checkbox"
                checked={deleteBefore}
                onChange={(e) => setDeleteBefore(e.target.checked)}
              />
              Delete the matching records first (true replace)
            </label>

            <div className="actions" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                {busy ? 'Reading…' : 'Choose backup file'}
              </button>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={pick}
                style={{ display: 'none' }}
              />
            </div>
          </section>
        </Collapsible>
      )}

      <Collapsible title="Backup history" badge={history.length}>
        <section className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>ID</th><th>Scope</th><th>Size</th><th>By</th><th>When</th><th>Deleted after</th></tr>
              </thead>
              <tbody>
                {history.map((b) => (
                  <tr key={b.backupId}>
                    <td>{b.backupId}</td>
                    <td>{b.scope}</td>
                    <td>{Math.round(b.bytes / 1024)} kB</td>
                    <td>{b.createdBy}</td>
                    <td>{new Date(b.createdAt).toLocaleString()}</td>
                    <td>
                      <span className={`tag${b.deletedAfterBackup ? ' locked' : ''}`}>
                        {b.deletedAfterBackup ? 'Yes' : 'No'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {history.length === 0 && <div className="empty">No backups taken yet.</div>}
        </section>
      </Collapsible>

      {pending && (
        <Modal title="Restore this backup?" onClose={() => setPending(null)}>
          <p className="muted" style={{ marginTop: 0 }}>
            {pending.name} — duplicates are skipped, so only new rows are added.
          </p>
          {deleteBefore && (
            <Banner kind="warn">
              The matching records will be deleted first. This is a true replace.
            </Banner>
          )}
          <CountTable
            rows={pending.summary.filter((r) => r.incoming > 0)}
            columns={[
              { header: 'In file', value: (r) => r.incoming },
              { header: 'Duplicates', value: (r) => r.duplicates },
              { header: 'Will add', value: (r) => r.willAdd },
              { header: 'Current', value: (r) => r.current },
            ]}
          />
          <div className="actions" style={{ marginTop: 16 }}>
            <button disabled={busy} onClick={runRestore}>
              {busy ? 'Restoring…' : 'Run restore'}
            </button>
            <button type="button" className="ghost" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal title="Delete these records?" onClose={() => setConfirmDelete(null)}>
          <Banner kind="warn">{confirmDelete.error}</Banner>
          <p className="muted">
            This removes the rows below and the sign-ins belonging to any academy, competitor or
            judge deleted. Take a backup first if you have not.
          </p>
          <CountTable
            rows={confirmDelete.summary.filter((r) => r.selected > 0)}
            columns={[{ header: 'Deleting', value: (r) => r.selected }]}
          />
          <div className="actions" style={{ marginTop: 16 }}>
            <button className="ghost danger" disabled={busy} onClick={() => runDelete(true)}>
              {busy ? 'Deleting…' : `Delete ${confirmDelete.total} record(s)`}
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
