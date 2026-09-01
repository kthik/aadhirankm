import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { useT } from '../lib/i18n.jsx';
import Tabs from '../components/Tabs.jsx';
import { BarChart } from '../components/charts.jsx';
import { Banner, Field, Stat } from '../components/ui.jsx';

export default function ParticipantDashboard() {
  const { user } = useSession();
  const t = useT();
  const [participant, setParticipant] = useState(null);
  const [events, setEvents] = useState([]);
  const [categories, setCategories] = useState([]);
  const [stats, setStats] = useState(null);
  const [form, setForm] = useState({ mobile: '', address: '', location: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get('/participants/me')
      .then((d) => {
        setParticipant(d.participant);
        setEvents(d.events);
        setCategories(d.categories ?? []);
        setStats(d.stats ?? null);
        setForm({ mobile: d.participant.mobile, address: d.participant.address, location: d.participant.location });
      })
      .catch((err) => setError(err.message));
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    setSaved(false);
    try {
      const { participant: updated } = await api.put('/participants/me', form);
      setParticipant(updated);
      setSaved(true);
    } catch (err) {
      setErrors(err.errors);
      if (!Object.keys(err.errors ?? {}).length) setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <h1>{participant?.participantName ?? 'Participant'}</h1>
        <p>
          {participant?.academyId ? `Academy ${participant.academyId}` : 'Individual entrant'} ·{' '}
          {participant?.location}
        </p>
      </div>

      {user?.mustChangePassword && (
        <Banner kind="warn">
          {t('common.defaultPasswordWarning', 'You are still using the default password. Reset it under the settings gear.')}
        </Banner>
      )}

      <div className="grid cols-3" style={{ margin: '16px 0' }}>
        <Stat label={t('stat.events', 'Events entered')} value={stats?.events ?? 0} />
        <Stat label={t('stat.judged', 'Judged')} value={`${stats?.judged ?? 0} / ${stats?.events ?? 0}`} />
        <Stat label={t('stat.medals', 'Medals')} value={stats?.medals ?? 0} />
      </div>
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Stat label={t('stat.bestPosition', 'Best position')} value={stats?.bestPosition ?? '—'} />
        <Stat label={t('stat.averageScore', 'Average score')} value={stats?.averageScore ?? '—'} />
        <Stat label={t('stat.ageGroup', 'Age group')} value={participant?.ageCategoryName ?? `${participant?.age ?? '—'}`} />
      </div>

      <Tabs
        tabs={[
          {
            id: 'results',
            label: t('tab.results', 'My results'),
            icon: '📈',
            render: () => (
              <>
                <section className="card">
                  <h2>Score by category</h2>
                  <p>
                    {stats?.judged
                      ? 'Your marks in each judged event, category by category.'
                      : 'Your marks appear here once a judge has scored you.'}
                  </p>
                  {events
                    .filter((e) => e.scores)
                    .map((e) => (
                      <div key={e.eventId} style={{ marginBottom: 18 }}>
                        <div className="event-card head">
                          <h3>{e.name}</h3>
                          <span className="tag on">
                            {e.positionName ? `Position ${e.positionName}` : 'Scored'} · {e.total}
                          </span>
                        </div>
                        <BarChart
                          valueLabel="points"
                          rows={categories.map((c) => ({
                            label: c.categoryName,
                            value: e.scores?.[c.categoryId] ?? 0,
                            detail: [`${c.categoryName}: ${e.scores?.[c.categoryId] ?? 0}`, `Judge: ${e.judgeName ?? '—'}`],
                          }))}
                        />
                      </div>
                    ))}
                  {!stats?.judged && <div className="empty">Nothing scored yet.</div>}
                </section>
              </>
            ),
          },
          {
            id: 'events',
            label: t('tab.myEvents', 'Registered events'),
            icon: '🥋',
            badge: events.length,
            render: () => (
              <section className="card">
                <h2>Registered events</h2>
                <p>Entries confirmed for this competition.</p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('th.event', 'Event')}</th>
                        <th>{t('th.status', 'Category')}</th>
                        <th>{t('th.bout', 'Bout')}</th>
                        <th>{t('th.judge', 'Judge')}</th>
                        <th>{t('th.position', 'Position')}</th>
                        <th>{t('th.total', 'Total')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((e) => (
                        <tr key={e.eventId}>
                          <td>{e.name}</td>
                          <td>{e.category ?? '—'}</td>
                          <td>{e.boutName ?? 'Not assigned'}</td>
                          <td>{e.judgeName ?? '—'}</td>
                          <td>
                            {e.positionName ? (
                              <span className="tag on">{e.positionName}</span>
                            ) : (
                              <span className="tag">{t('status.waiting', 'Waiting')}</span>
                            )}
                          </td>
                          <td>{e.total ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {events.length === 0 && <div className="empty">No events registered yet.</div>}
              </section>
            ),
          },
          {
            id: 'profile',
            label: t('tab.profile', 'Update profile'),
            icon: '👤',
            render: () => (
              <form className="card" onSubmit={submit}>
                <h2>Update profile</h2>
                <p>Name, age and event entries are changed by your Admin.</p>
                <Banner>{error}</Banner>
                {saved && <Banner kind="ok">Profile updated.</Banner>}
                <div style={{ marginTop: error || saved ? 14 : 0 }}>
                  <div className="row two">
                    <Field label="Mobile number" inputMode="numeric" value={form.mobile} onChange={set('mobile')} error={errors.mobile} />
                    <Field label="Location" value={form.location} onChange={set('location')} error={errors.location} />
                  </div>
                  <Field label="Address" error={errors.address}>
                    <textarea value={form.address} onChange={set('address')} />
                  </Field>
                </div>
                <button disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
              </form>
            ),
          },
        ]}
      />
    </main>
  );
}
