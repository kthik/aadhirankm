import { lazy, Suspense, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { useT } from '../lib/i18n.jsx';
import Tabs from '../components/Tabs.jsx';
import { BarChart, ProgressBar, SeriesLegend } from '../components/charts.jsx';
import { Banner, Credential, EventPicker, Field, Modal, Stat } from '../components/ui.jsx';
// Split out: the spreadsheet parser is ~430 kB and only academies ever load it.
const BulkUpload = lazy(() => import('../components/BulkUpload.jsx'));

const EMPTY = {
  participantName: '',
  fatherName: '',
  age: '',
  mobile: '',
  address: '',
  location: '',
  events: [],
};

export default function AcademyDashboard() {
  const { user, modules } = useSession();
  const t = useT();
  const [data, setData] = useState({ academy: null, participants: [], byEvent: [], stats: null, podium: [] });
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [mine, evts] = await Promise.all([api.get('/academies/me'), api.get('/events')]);
    setData(mine);
    setEvents(evts.events);
    // Contact details default to the academy's own, per the direct-registration spec.
    setForm((f) => ({
      ...f,
      mobile: f.mobile || mine.academy.phone,
      address: f.address || mine.academy.address,
      location: f.location || mine.academy.location,
    }));
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    try {
      const result = await api.post('/participants/academy', { ...form, age: Number(form.age) });
      setCreated(result);
      setForm(EMPTY);
      await load();
    } catch (err) {
      setErrors(err.errors);
      if (!Object.keys(err.errors ?? {}).length) setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const eventName = (id) => events.find((e) => e.eventId === id)?.name ?? id;
  const stats = data.stats;

  return (
    <main className="page">
      <div className="page-head">
        <h1>{data.academy?.academyName ?? 'Academy'}</h1>
        <p>Coach {data.academy?.coachName} · {data.academy?.location}</p>
      </div>

      {user?.mustChangePassword && (
        <Banner kind="warn">
          {t('common.defaultPasswordWarning', 'You are still using the default password. Reset it under the settings gear.')}
        </Banner>
      )}

      <div className="grid cols-3" style={{ margin: '16px 0' }}>
        <Stat label={t('stat.participants', 'Participants')} value={stats?.participants ?? 0} />
        <Stat label={t('stat.eventEntries', 'Event entries')} value={stats?.eventEntries ?? 0} />
        <Stat label={t('stat.inABout', 'In a bout')} value={`${stats?.assigned ?? 0} / ${stats?.participants ?? 0}`} />
      </div>
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Stat
          label="Scored"
          value={`${stats?.completed ?? 0} · ${
            stats?.participants ? Math.round((stats.completed / stats.participants) * 100) : 0
          }%`}
        />
        <Stat label={t('stat.medals', 'Medals')} value={stats?.medals ?? 0} />
        <Stat label={t('stat.averageScore', 'Average score')} value={stats?.averageScore ?? '—'} />
      </div>

      <Tabs
        tabs={[
          {
            id: 'overview',
            label: t('tab.overview', 'Overview'),
            icon: '📊',
            render: () => (
              <>
                <section className="card">
                  <h2>Squad by event</h2>
                  <p>Where this academy's entries are concentrated, and how far each has got.</p>
                  <SeriesLegend
                    items={[
                      { label: 'Scored', color: 'var(--series-1)' },
                      { label: 'Waiting', color: 'var(--series-2)' },
                    ]}
                  />
                  <div className="grid cols-2" style={{ marginTop: 14 }}>
                    {data.byEvent.map((e) => (
                      <div key={e.eventId} className="card event-card">
                        <div className="head">
                          <h3>{e.name}</h3>
                          <span className="tag">{e.entered} entered</span>
                        </div>
                        <ProgressBar completed={e.completed} waiting={e.entered - e.completed} />
                        <div className="meta">
                          <span><b>{e.completed}</b> scored</span>
                          <span><b>{e.entered - e.completed}</b> waiting</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {data.byEvent.length === 0 && (
                    <div className="empty">No event entries yet.</div>
                  )}
                </section>

                <section className="card">
                  <h2>Events entered per competitor</h2>
                  <p>Competitors in more than one event perform earlier in each bout.</p>
                  <BarChart
                    valueLabel="events"
                    emptyText="No participants yet."
                    rows={data.participants
                      .slice()
                      .sort((a, b) => b.events.length - a.events.length)
                      .slice(0, 10)
                      .map((p) => ({
                        label: p.participantName,
                        value: p.events.length,
                        detail: [
                          p.eventNames?.join(', ') || 'No events',
                          p.boutNames?.length ? `Bouts: ${p.boutNames.join(', ')}` : 'Not in a bout',
                          p.completed ? 'Scored' : 'Waiting',
                        ],
                      }))}
                  />
                </section>

                {data.podium.length > 0 && (
                  <section className="card">
                    <h2>Podium</h2>
                    <p>Medal positions earned by this academy.</p>
                    <div className="podium">
                      {data.podium.map((r, i) => (
                        <span key={`${r.name}-${i}`} className="tag on">
                          #{r.positionName} {r.name} · {r.boutName} · {r.total}
                        </span>
                      ))}
                    </div>
                  </section>
                )}
              </>
            ),
          },
          {
            id: 'register',
            label: t('tab.register', 'Register participant'),
            icon: '➕',
            render: () => (
              <form className="card" onSubmit={submit}>
                <h2>Register a participant</h2>
                <p>
                  Contact details are pre-filled from your academy — edit them for a participant who
                  differs.
                  {modules.bulkUpload ? ' For a whole squad, use the Bulk upload tab.' : ''}
                </p>

                <Banner>{error}</Banner>

                <div style={{ marginTop: error ? 14 : 0 }}>
                  <div className="row two">
                    <Field label="Participant name" value={form.participantName} onChange={set('participantName')} error={errors.participantName} />
                    <Field label="Father's name" value={form.fatherName} onChange={set('fatherName')} error={errors.fatherName} />
                  </div>
                  <div className="row two">
                    <Field label="Age" inputMode="numeric" value={form.age} onChange={set('age')} error={errors.age} />
                    <Field label="Mobile number" inputMode="numeric" value={form.mobile} onChange={set('mobile')} error={errors.mobile} />
                  </div>
                  <Field label="Location" value={form.location} onChange={set('location')} error={errors.location} />
                  <Field label="Address" error={errors.address}>
                    <textarea value={form.address} onChange={set('address')} />
                  </Field>
                  <EventPicker
                    events={events}
                    value={form.events}
                    onChange={(events) => setForm({ ...form, events })}
                    error={errors.events}
                  />
                </div>

                <button disabled={busy}>{busy ? 'Registering…' : 'Register participant'}</button>
              </form>
            ),
          },
          modules.bulkUpload && {
            id: 'bulk',
            label: t('tab.bulkUpload', 'Bulk upload'),
            icon: '📄',
            render: () => (
              <Suspense fallback={<div className="card muted">Loading bulk upload…</div>}>
                <BulkUpload events={events} onImported={load} />
              </Suspense>
            ),
          },
          {
            id: 'roster',
            label: t('tab.roster', 'Participants'),
            icon: '👥',
            badge: data.participants.length,
            render: () => (
              <section className="card">
                <h2>Participants</h2>
                <p>Everyone registered under this academy.</p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>UID</th>
                        <th>Name</th>
                        <th>Age</th>
                        <th>Age group</th>
                        <th>Events</th>
                        <th>Bouts</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.participants.map((p) => (
                        <tr key={p.participantId}>
                          <td>{p.participantId}</td>
                          <td>{p.participantName}</td>
                          <td>{p.age}</td>
                          <td>{p.ageCategoryName ?? '—'}</td>
                          <td style={{ whiteSpace: 'normal' }}>{p.eventNames?.join(', ') ?? p.events.map(eventName).join(', ')}</td>
                          <td style={{ whiteSpace: 'normal' }}>{p.boutNames?.join(', ') || '—'}</td>
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
                {data.participants.length === 0 && <div className="empty">No participants yet.</div>}
              </section>
            ),
          },
        ]}
      />


      {created && (
        <Modal title="Participant registered" onClose={() => setCreated(null)}>
          <p className="muted">{created.participant.participantName} can sign in with:</p>
          <Credential label="UID" value={created.credentials.uid} />
          <Credential label="Temporary password" value={created.credentials.password} />
          <button className="full" onClick={() => setCreated(null)}>Done</button>
        </Modal>
      )}
    </main>
  );
}
