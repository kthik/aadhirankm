import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Banner, Field, Modal } from './ui.jsx';

/*
 * Database location, for the Super Admin.
 *
 * Repointing the database is the most destructive action in the app, so the
 * screen never applies a change straight from the form. Checking a location is
 * a separate, read-only step; saving opens a dialog that states where the data
 * is going, what is already there, and demands a decision about copying plus
 * the admin's own password.
 *
 * The copy decision is not cosmetic. Switching to a folder with no Super Admin
 * login and no copy would leave a database nobody can sign in to, with the real
 * data stranded at the old path - so that combination is refused here and again
 * on the server.
 */

const DRIVER_LABEL = {
  local: 'Local JSON',
  gdrive: 'Google Drive',
};

function Contents({ at }) {
  if (!at) return null;
  if (!at.exists) return <p className="muted">Folder does not exist yet — it will be created.</p>;
  if (at.empty) return <p className="muted">Folder is empty: no database files in it yet.</p>;

  return (
    <p className="muted">
      Already holds <b>{at.files}</b> collection file(s), <b>{at.rows}</b> row(s) and{' '}
      <b>{at.superAdmins}</b> Super Admin login(s).
    </p>
  );
}

export default function StorageSettings() {
  const [state, setState] = useState(null);
  const [form, setForm] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // Dialog state for the save flow.
  const [asking, setAsking] = useState(false);
  const [copyData, setCopyData] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const [password, setPassword] = useState('');
  const [dialogError, setDialogError] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api.get('/storage');
      setState(d);
      setForm({
        driver: d.driver,
        local: { dataDir: d.local.dataDir },
        gdrive: { ...d.gdrive },
      });
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!state || !form) return <div className="card muted">Loading database settings…</div>;

  const setDriver = (driver) => {
    setForm({ ...form, driver });
    setPreview(null);
  };
  const setLocal = (e) => {
    setForm({ ...form, local: { dataDir: e.target.value } });
    setPreview(null);
  };
  const setGdrive = (k) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm({ ...form, gdrive: { ...form.gdrive, [k]: value } });
    setPreview(null);
  };

  async function check() {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      setPreview(await api.post('/storage/preview', form));
    } catch (err) {
      setPreview(null);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function openSave() {
    setPassword('');
    setDialogError('');
    setCopyData(true);
    setOverwrite(false);
    setAsking(true);
  }

  async function save() {
    setBusy(true);
    setDialogError('');
    try {
      const result = await api.put('/storage', { ...form, password, copyData, overwrite });
      setAsking(false);
      setMsg(
        result.moved
          ? `Database is now at ${result.active.dir}.` +
              (result.copied
                ? ` Copied ${Object.values(result.copied).reduce((a, b) => a + b, 0)} row(s) across.`
                : '')
          : 'Settings saved. The database location did not change.'
      );
      if (result.warning) setError(result.warning);
      setPreview(null);
      await load();
    } catch (err) {
      setDialogError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const target = preview?.target;
  const movingAway = preview && !preview.same;
  // The client mirror of the server's guard, so the dialog can explain the
  // refusal instead of showing a rejected request.
  const wouldLockOut = movingAway && !copyData && target?.superAdmins === 0;
  const needsOverwrite = movingAway && copyData && !target?.empty && !overwrite;

  return (
    <>
      <Banner kind={msg ? 'ok' : 'error'}>{msg || error}</Banner>

      <section className="card">
        <h2>Where the database lives</h2>
        <p>
          The competition data is JSON collections in a folder. Keep it on this machine, or in a
          synced Google Drive folder so several machines share one database.
        </p>

        <div className="dbnow">
          <div>
            <span className="k">Currently reading and writing</span>
            <span className="v">{state.active.dir}</span>
          </div>
          <div>
            <span className="k">Driver</span>
            <span className="v">{DRIVER_LABEL[state.driver] ?? state.driver}</span>
          </div>
          {state.active.cacheDir && (
            <div>
              <span className="k">Local cache</span>
              <span className="v">{state.active.cacheDir}</span>
            </div>
          )}
          <div>
            <span className="k">Holds</span>
            <span className="v">
              {state.contents.rows} row(s) · {state.contents.superAdmins} Super Admin login(s)
            </span>
          </div>
        </div>

        {(state.envOverride.dataDir || state.envOverride.driver) && (
          <Banner kind="warn">
            An environment variable is overriding this configuration
            {state.envOverride.driver ? ` (driver: ${state.envOverride.driver})` : ''}
            {state.envOverride.dataDir ? ` (folder: ${state.envOverride.dataDir})` : ''}. Saving here
            changes the config file, but the variable still wins until it is removed.
          </Banner>
        )}
      </section>

      <section className="card">
        <h2>Change location</h2>

        <div className="seg-switch" style={{ maxWidth: 320, marginBottom: 14 }}>
          {state.drivers.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={form.driver === d}
              onClick={() => setDriver(d)}
            >
              {DRIVER_LABEL[d] ?? d}
            </button>
          ))}
        </div>

        {form.driver === 'local' ? (
          <Field
            label="Folder on this machine"
            value={form.local.dataDir}
            onChange={setLocal}
            placeholder="server/data"
            hint="Absolute, or relative to the project root. Leave as server/data for the default."
          />
        ) : (
          <>
            <div className="row two">
              <Field
                label="Folder inside Google Drive"
                value={form.gdrive.dataDir}
                onChange={setGdrive('dataDir')}
                placeholder="Veeran/data"
                hint="Path within the synced Drive folder. Created if it does not exist."
              />
              <Field
                label="Synced Drive folder (optional)"
                value={form.gdrive.driveRoot}
                onChange={setGdrive('driveRoot')}
                placeholder="Detected automatically"
                hint="Set only if Drive for desktop is mounted somewhere unusual, e.g. G:\My Drive."
              />
            </div>
            <div className="row two">
              <Field
                label="Google account (for reference)"
                value={form.gdrive.account}
                onChange={setGdrive('account')}
                placeholder="competition@example.com"
                hint="Recorded so it is clear whose Drive holds the data. Sign-in itself is handled by Drive for desktop on this machine, not by this app."
              />
              <Field label="Local cache">
                <label className="issue-box">
                  <input
                    type="checkbox"
                    checked={form.gdrive.cache !== false}
                    onChange={setGdrive('cache')}
                  />
                  Keep a local copy for reads
                </label>
                <div className="hint">
                  Reads are served from local disk and refreshed from Drive; writes always go to
                  Drive first. Leave on unless you want every read to hit the Drive folder.
                </div>
              </Field>
            </div>
          </>
        )}

        <div className="actions">
          <button type="button" className="ghost" onClick={check} disabled={busy}>
            {busy ? 'Checking…' : 'Check location'}
          </button>
          <button type="button" onClick={openSave} disabled={busy || !preview}>
            Save location
          </button>
        </div>

        {!preview && <p className="muted">Check a location before saving it.</p>}

        {preview && (
          <div className="dbcheck">
            <h3>{preview.same ? 'Same folder as now' : 'Destination'}</h3>
            <p className="v">{preview.resolved.dir}</p>
            {preview.resolved.driveRoot && (
              <p className="muted">Drive folder detected at {preview.resolved.driveRoot}</p>
            )}
            <Contents at={target} />
            {preview.copyRequired && (
              <Banner kind="warn">
                This folder has no Super Admin login. You must copy the current data across, or
                nobody will be able to sign in after the switch.
              </Banner>
            )}
            {preview.overwriteNeeded && (
              <Banner kind="warn">
                This folder already holds a database. Copying into it replaces what is there.
              </Banner>
            )}
          </div>
        )}
      </section>

      {asking && (
        <Modal title="Move the database?" onClose={() => setAsking(false)}>
          <p>
            From <b>{state.active.dir}</b>
            <br />
            to <b>{preview.resolved.dir}</b>
          </p>
          <Contents at={target} />

          {movingAway ? (
            <>
              <div className="field">
                <span>Copy the current data to the new location?</span>
                <label className="issue-box">
                  <input
                    type="radio"
                    name="copy"
                    checked={copyData}
                    onChange={() => setCopyData(true)}
                  />
                  Yes — copy all {state.contents.rows} row(s) across, then switch
                </label>
                <label className="issue-box">
                  <input
                    type="radio"
                    name="copy"
                    checked={!copyData}
                    onChange={() => setCopyData(false)}
                  />
                  No — just switch, and use whatever is already there
                </label>
              </div>

              {!copyData && !wouldLockOut && (
                <Banner kind="warn">
                  Nothing will be copied. The data at {state.active.dir} stays on disk but the app
                  will stop reading it, and the new location will be used as it is.
                </Banner>
              )}

              {wouldLockOut && (
                <Banner kind="error">
                  Not allowed: {preview.resolved.dir} has no Super Admin login, so after the switch
                  nobody could sign in — and the current database, with all{' '}
                  {state.contents.rows} row(s), would be left behind at {state.active.dir}. Choose
                  “copy”, or pick a folder that already has a Super Admin account.
                </Banner>
              )}

              {copyData && !target?.empty && (
                <label className="issue-box">
                  <input
                    type="checkbox"
                    checked={overwrite}
                    onChange={(e) => setOverwrite(e.target.checked)}
                  />
                  I understand the {target.rows} row(s) already in that folder will be replaced
                </label>
              )}
            </>
          ) : (
            <p className="muted">
              The folder is not changing, so nothing is copied — only the settings are saved.
            </p>
          )}

          <Field
            label="Your Super Admin password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint="Confirms it is you making a change that moves the whole database."
          />

          <Banner>{dialogError}</Banner>

          <div className="actions">
            <button type="button" className="ghost" onClick={() => setAsking(false)}>
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy || !password || wouldLockOut || needsOverwrite}
            >
              {busy ? 'Applying…' : copyData && movingAway ? 'Copy and switch' : 'Switch'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
