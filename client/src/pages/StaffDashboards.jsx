import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { useT } from '../lib/i18n.jsx';
import useJudgeAdmin from '../components/JudgeAdmin.jsx';
import useAdminAnalytics from '../components/AdminAnalytics.jsx';
import Tabs from '../components/Tabs.jsx';
import Collapsible from '../components/Collapsible.jsx';
import AcademyDrawer from '../components/AcademyDrawer.jsx';
import BackupRestore from '../components/BackupRestore.jsx';
import TournamentAdmin from '../components/TournamentAdmin.jsx';
import AdminManagement from '../components/AdminManagement.jsx';
import SystemLogs from '../components/SystemLogs.jsx';
import { Field } from '../components/ui.jsx';
import { Banner, Stat } from '../components/ui.jsx';

/** Lists the modules still switched off, so a stub panel says why it is empty. */
function Roadmap({ items }) {
  const { modules } = useSession();
  return (
    <section className="card">
      <h2>Coming next</h2>
      <p>These features ship once their modules are enabled in config.</p>
      <div className="chips">
        {items.map((m) => (
          <span key={m.key} className="tag">
            {m.label} {modules[m.key] ? '· on' : '· off'}
          </span>
        ))}
      </div>
    </section>
  );
}

export function AdminDashboard() {
  const { modules, user } = useSession();
  const t = useT();
  const [academies, setAcademies] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [events, setEvents] = useState([]);
  const [bouts, setBouts] = useState([]);
  const [error, setError] = useState('');
  const [academyDrilldown, setAcademyDrilldown] = useState(null);

  // Filters and bulk selection for the Participants tab.
  const [pFilter, setPFilter] = useState({ q: '', eventId: '', academyId: '', boutId: '', status: '' });
  const [picked, setPicked] = useState([]);
  const [bulkBout, setBulkBout] = useState('');
  const [bulkMsg, setBulkMsg] = useState('');

  const load = () =>
    Promise.all([
      api.get('/academies'),
      api.get('/participants'),
      api.get('/events'),
      api.get('/judges/bouts').catch(() => ({ bouts: [] })),
    ]).then(([a, p, e, b]) => {
      setAcademies(a.academies);
      setParticipants(p.participants);
      setEvents(e.events);
      setBouts(b.bouts);
    });

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  const judging = useJudgeAdmin({
    enabled: Boolean(modules.judging),
    events,
    participants,
    onParticipantsChanged: load,
  });

  const analytics = useAdminAnalytics({ enabled: Boolean(modules.analytics), events });

  const eventName = (id) => events.find((e) => e.eventId === id)?.name ?? id;
  const boutName = (id) => bouts.find((b) => b.boutId === id)?.boutName ?? id;

  // Filtering happens here rather than server-side: this tab already holds the
  // full participant list, and the analytics List view covers the deeper query.
  const filtered = participants.filter((p) => {
    const f = pFilter;
    if (f.q) {
      const needle = f.q.toLowerCase();
      if (
        !p.participantName.toLowerCase().includes(needle) &&
        !p.participantId.toLowerCase().includes(needle)
      ) return false;
    }
    if (f.eventId && !p.events.includes(f.eventId)) return false;
    if (f.academyId && (f.academyId === 'none' ? p.academyId : p.academyId !== f.academyId)) return false;
    if (f.boutId) {
      const held = p.boutIds ?? [];
      if (f.boutId === 'none' ? held.length > 0 : !held.includes(f.boutId)) return false;
    }
    if (f.status === 'assigned' && (p.boutIds ?? []).length === 0) return false;
    if (f.status === 'unassigned' && (p.boutIds ?? []).length > 0) return false;
    return true;
  });

  /**
   * One row per event a competitor entered, so a competitor in three events
   * reads as three consecutive rows under the same registration ID, each with
   * the bout covering that event. An event filter narrows to that event's rows
   * rather than listing every event of anyone who entered it.
   *
   * `first` marks the opening row of each competitor's block, which is what the
   * table uses to draw the group divider.
   */
  const entryRows = filtered.flatMap((p) => {
    const events = pFilter.eventId
      ? p.events.filter((id) => id === pFilter.eventId)
      : p.events;

    if (events.length === 0) {
      return [{ participant: p, eventId: null, boutId: null, first: true }];
    }

    const held = (p.boutIds ?? []).map((id) => bouts.find((b) => b.boutId === id)).filter(Boolean);

    return events.map((eventId, i) => ({
      participant: p,
      eventId,
      // The bout scoped to this event, falling back to one covering any event —
      // an unscoped bout judges everything its entrants are in, so it belongs
      // on every one of their rows rather than none.
      boutId:
        (held.find((b) => b.eventId === eventId) ?? held.find((b) => !b.eventId))?.boutId ?? null,
      first: i === 0,
    }));
  });

  async function bulkAssign(remove) {
    setError('');
    setBulkMsg('');
    try {
      const { updatedCount } = await api.post('/participants/assign-bout', {
        participantIds: picked,
        boutId: bulkBout,
        remove,
      });
      setPicked([]);
      setBulkMsg(
        `${updatedCount} participant(s) ${remove ? 'removed from' : 'added to'} ${boutName(bulkBout)}.`
      );
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  const academiesTab = () => (
    <section className="card">
      <h2>Academies</h2>
      <p>Registered academies and their squad sizes.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>UID</th>
              <th>Academy</th>
              <th>Coach</th>
              <th>Location</th>
              <th>Phone</th>
              <th>Participants</th>
            </tr>
          </thead>
          <tbody>
            {academies.map((a) => (
              <tr key={a.academyId}>
                <td>{a.academyId}</td>
                <td>
                  <button type="button" className="link" onClick={() => setAcademyDrilldown(a.academyId)}>
                    {a.academyName}
                  </button>
                </td>
                <td>{a.coachName}</td>
                <td>{a.location}</td>
                <td>{a.phone}</td>
                <td>{a.participantCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {academies.length === 0 && <div className="empty">No academies registered yet.</div>}
    </section>
  );

  const participantsTab = () => (
    <section className="card">
      <h2>Participants</h2>
      <p>
        {entryRows.length} entr{entryRows.length === 1 ? 'y' : 'ies'} across {filtered.length} of{' '}
        {participants.length} competitors. A competitor entered in several events appears once
        per event, under the same registration ID. Selecting any of their rows selects the
        competitor.
      </p>

      <div className="filters">
        <Field label="Search">
          <input
            value={pFilter.q}
            onChange={(e) => setPFilter({ ...pFilter, q: e.target.value })}
            placeholder="Name or UID"
          />
        </Field>
        <Field label="Event">
          <select value={pFilter.eventId} onChange={(e) => setPFilter({ ...pFilter, eventId: e.target.value })}>
            <option value="">All events</option>
            {events.map((e) => (
              <option key={e.eventId} value={e.eventId}>{e.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Academy">
          <select value={pFilter.academyId} onChange={(e) => setPFilter({ ...pFilter, academyId: e.target.value })}>
            <option value="">All academies</option>
            <option value="none">Individual entrants</option>
            {academies.map((a) => (
              <option key={a.academyId} value={a.academyId}>{a.academyName}</option>
            ))}
          </select>
        </Field>
        <Field label="Bout">
          <select value={pFilter.boutId} onChange={(e) => setPFilter({ ...pFilter, boutId: e.target.value })}>
            <option value="">All bouts</option>
            <option value="none">Not in a bout</option>
            {bouts.map((b) => (
              <option key={b.boutId} value={b.boutId}>{b.boutName}</option>
            ))}
          </select>
        </Field>
        <Field label="Assignment">
          <select value={pFilter.status} onChange={(e) => setPFilter({ ...pFilter, status: e.target.value })}>
            <option value="">Any</option>
            <option value="assigned">In a bout</option>
            <option value="unassigned">Not assigned</option>
          </select>
        </Field>
      </div>

      {bulkMsg && <Banner kind="ok">{bulkMsg}</Banner>}

      <div className="bulkbar">
        <label className="chip" data-on={picked.length > 0 && picked.length === filtered.length}>
          <input
            type="checkbox"
            checked={picked.length > 0 && picked.length === filtered.length}
            onChange={(e) =>
              setPicked(e.target.checked ? filtered.map((p) => p.participantId) : [])
            }
          />
          Select all shown
        </label>
        <select value={bulkBout} onChange={(e) => setBulkBout(e.target.value)}>
          <option value="">Choose a bout…</option>
          {bouts.map((b) => (
            <option key={b.boutId} value={b.boutId}>
              {b.boutName}
              {b.eventName ? ` · ${b.eventName}` : ''}
            </option>
          ))}
        </select>
        <button type="button" disabled={picked.length === 0 || !bulkBout} onClick={() => bulkAssign(false)}>
          Add {picked.length || ''} to bout
        </button>
        <button
          type="button"
          className="ghost"
          disabled={picked.length === 0 || !bulkBout}
          onClick={() => bulkAssign(true)}
        >
          Remove from bout
        </button>
        <button type="button" className="ghost" onClick={() => setPFilter({ q: '', eventId: '', academyId: '', boutId: '', status: '' })}>
          Clear filters
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th />
              <th>UID</th>
              <th>Name</th>
              <th>Academy</th>
              <th>Age</th>
              <th>Event</th>
              <th>Bout</th>
            </tr>
          </thead>
          <tbody>
            {entryRows.map(({ participant: p, eventId, boutId, first }) => (
              <tr
                key={`${p.participantId}-${eventId ?? 'none'}`}
                data-group-start={first}
                data-selected={picked.includes(p.participantId)}
              >
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${p.participantName}`}
                    checked={picked.includes(p.participantId)}
                    onChange={() =>
                      setPicked((sel) =>
                        sel.includes(p.participantId)
                          ? sel.filter((x) => x !== p.participantId)
                          : [...sel, p.participantId]
                      )
                    }
                  />
                </td>
                <td>{p.participantId}</td>
                <td>{p.participantName}</td>
                <td>
                  {p.academyId
                    ? academies.find((a) => a.academyId === p.academyId)?.academyName ?? p.academyId
                    : 'Individual'}
                </td>
                <td>{p.age}</td>
                <td style={{ whiteSpace: 'normal' }}>
                  {eventId ? eventName(eventId) : <span className="muted">No events</span>}
                </td>
                <td style={{ whiteSpace: 'normal' }}>
                  {boutId ? boutName(boutId) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {entryRows.length === 0 && <div className="empty">No entries match these filters.</div>}
    </section>
  );

  return (
    <main className="page">
      <div className="page-head">
        <h1>Admin</h1>
        <p>Registration overview across the competition.</p>
      </div>

      <Banner>{error || (modules.analytics ? analytics.error : '')}</Banner>

      <div className="grid cols-3" style={{ margin: '16px 0' }}>
        <Stat label={t('tab.academies', 'Academies')} value={academies.length} />
        <Stat label={t('stat.participants', 'Participants')} value={participants.length} />
        <Stat label="Individual entrants" value={participants.filter((p) => !p.academyId).length} />
      </div>

      <Tabs
        tabs={[
          ...(modules.analytics ? analytics.tabs : []),
          { id: 'academies', label: t('tab.academies', 'Academies'), icon: '🏫', badge: academies.length, render: academiesTab },
          {
            id: 'participants',
            label: t('tab.participants', 'Participants'),
            icon: '👥',
            badge: entryRows.length,
            render: participantsTab,
          },
          ...(modules.judging ? judging.tabs : []),
          ...(modules.backupRestore && user?.role === 'ADMIN'
            ? [{ id: 'backup', label: t('tab.backup', 'Backup & restore'), icon: '💾', render: () => <BackupRestore /> }]
            : []),
          {
            id: 'roadmap',
            label: t('tab.comingNext', 'Coming next'),
            icon: '🧭',
            render: () => (
              <Roadmap
                items={[
                  { key: 'realtime', label: 'Live scoring' },
                  { key: 'backupRestore', label: 'Backup / restore' },
                ]}
              />
            ),
          },
        ]}
      />

      {modules.judging && judging.modals}
      {modules.analytics && analytics.drawer}
      {academyDrilldown && (
        <AcademyDrawer academyId={academyDrilldown} onClose={() => setAcademyDrilldown(null)} />
      )}
    </main>
  );
}

export function SuperAdminDashboard() {
  const t = useT();
  const { modules } = useSession();
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState({ name: '', category: '', description: '' });
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () =>
    api.get('/events').then((d) => setEvents(d.events)).catch((err) => setError(err.message));

  useEffect(() => { load(); }, []);

  async function toggle(event) {
    setError('');
    try {
      await api.patch(`/events/${event.eventId}`, { active: !event.active });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    setMsg('');
    try {
      const { event } = await api.post('/events', form);
      setForm({ name: '', category: '', description: '' });
      setMsg(`Event "${event.name}" created as ${event.eventId}.`);
      await load();
    } catch (err) {
      setErrors(err.errors ?? {});
      if (!Object.keys(err.errors ?? {}).length) setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const createEventPanel = () => (
    <form className="card" onSubmit={create}>
      {msg && <Banner kind="ok">{msg}</Banner>}
      <div className="row two">
        <Field label="Event name" value={form.name} onChange={set('name')} error={errors.name} />
        <Field label="Category" value={form.category} onChange={set('category')} error={errors.category} placeholder="Solo, Pair, Weapon…" />
      </div>
      <Field label="Description" error={errors.description}>
        <textarea value={form.description} onChange={set('description')} />
      </Field>
      <button disabled={busy}>{busy ? 'Creating…' : 'Create event'}</button>
    </form>
  );

  const eventListPanel = () => (
    <section className="card">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Event</th>
              <th>Category</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.eventId}>
                <td>{e.eventId}</td>
                <td>{e.name}</td>
                <td>{e.category}</td>
                <td>
                  <span className={`tag${e.active ? ' on' : ''}`}>
                    {e.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  <button className="ghost" onClick={() => toggle(e)}>
                    {e.active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );

  return (
    <main className="page">
      <div className="page-head">
        <h1>Super Admin</h1>
        <p>Full ownership of events and system configuration.</p>
      </div>

      <Banner>{error}</Banner>

      <div style={{ marginTop: 16 }}>
        <Tabs
          tabs={[
            ...(modules.adminManagement
              ? [{ id: 'admins', label: 'Admins', icon: '⚙', render: () => <AdminManagement /> }]
              : []),
            ...(modules.tournaments
              ? [{ id: 'tournaments', label: 'Tournaments', icon: '🏆', render: () => <TournamentAdmin /> }]
              : []),
            ...(modules.backupRestore
              ? [{ id: 'backup', label: 'Backup & restore', icon: '💾', render: () => <BackupRestore /> }]
              : []),
            ...(modules.systemLogs
              ? [{ id: 'logs', label: 'System logs', icon: '📜', render: () => <SystemLogs /> }]
              : []),
            {
              id: 'events',
              label: t('tab.events', 'Events'),
              icon: '🥋',
              badge: events.length,
              render: () => (
                <>
                  <Collapsible
                    title="Create an event"
                    description="New events become selectable on every registration form immediately."
                    defaultOpen
                  >
                    {createEventPanel()}
                  </Collapsible>
                  <Collapsible
                    title="All events"
                    description="Deactivated events disappear from every registration form."
                    badge={events.length}
                    defaultOpen
                  >
                    {eventListPanel()}
                  </Collapsible>
                </>
              ),
            },
            {
              id: 'roadmap',
              label: t('tab.comingNext', 'Coming next'),
              icon: '🧭',
              render: () => (
                <Roadmap
                  items={[
                    { key: 'realtime', label: 'Live updates' },
                    { key: 'multiLanguage', label: 'Languages' },
                    { key: 'backupRestore', label: 'Backup / restore' },
                  ]}
                />
              ),
            },
            ]}
        />
      </div>
    </main>
  );
}
