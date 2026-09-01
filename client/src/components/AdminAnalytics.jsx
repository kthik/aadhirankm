import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useT } from '../lib/i18n.jsx';
import ParticipantDrawer from './ParticipantDrawer.jsx';
import { BarChart, Heatmap, ProgressBar, SeriesLegend } from './charts.jsx';
import Collapsible from './Collapsible.jsx';
import AgeCategoryDrawer from './AgeCategoryDrawer.jsx';
import Champions from './Champions.jsx';
import { Banner, Field, Stat } from './ui.jsx';

const SERIES = [
  { label: 'Completed', color: 'var(--series-1)' },
  { label: 'Waiting', color: 'var(--series-2)' },
];

const EMPTY_FILTERS = {
  eventId: '',
  ageCategoryId: '',
  boutId: '',
  judgeId: '',
  completion: '',
  q: '',
};

/** Quotes a CSV cell only when it needs it, so the file stays readable. */
function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(rows, columns, filename) {
  const body = [
    columns.map((c) => csvCell(c.header)).join(','),
    ...rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(',')),
  ].join('\r\n');

  // A BOM keeps Excel from mangling names with non-ASCII characters.
  const blob = new Blob([`﻿${body}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Supplies the Admin dashboard's analytics tabs: overview infographic, the
 * filtered list view with CSV export, and category/bout setup.
 *
 * A hook rather than a component so the panels share one fetch of the summary,
 * event, bout and judge rollups, and one refresh path after any edit.
 */
export default function useAdminAnalytics({ enabled = true, events }) {
  const t = useT();
  const [summary, setSummary] = useState(null);
  const [eventRows, setEventRows] = useState([]);
  const [boutRows, setBoutRows] = useState([]);
  const [judgeRows, setJudgeRows] = useState([]);
  const [ages, setAges] = useState([]);
  const [scoreCats, setScoreCats] = useState([]);
  const [error, setError] = useState('');

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [list, setList] = useState([]);
  const [drilldown, setDrilldown] = useState(null);
  const [ageDrilldown, setAgeDrilldown] = useState(null);

  const load = useCallback(async () => {
    const [s, e, b, j, a, sc] = await Promise.all([
      api.get('/dashboard/summary'),
      api.get('/dashboard/events'),
      api.get('/dashboard/bouts'),
      api.get('/dashboard/judges'),
      api.get('/age-categories'),
      api.get('/score-categories'),
    ]);
    setSummary(s);
    setEventRows(e.events);
    setBoutRows(b.bouts);
    setJudgeRows(j.judges);
    setAges(a.ageCategories);
    setScoreCats(sc.scoreCategories);
  }, []);

  useEffect(() => {
    if (enabled) load().catch((err) => setError(err.message));
  }, [enabled, load]);

  // The list view re-queries the server on every filter change, so the export
  // always matches exactly what is on screen.
  const query = useMemo(() => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
    return params.toString();
  }, [filters]);

  const loadList = useCallback(async () => {
    const { participants } = await api.get(`/dashboard/participants${query ? `?${query}` : ''}`);
    setList(participants);
  }, [query]);

  useEffect(() => {
    if (enabled) loadList().catch((err) => setError(err.message));
  }, [enabled, loadList]);

  const refreshAll = useCallback(
    () => Promise.all([load(), loadList()]).then(() => undefined),
    [load, loadList]
  );

  const setFilter = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });

  /**
   * One row per event a competitor entered, sharing their registration ID, with
   * the bout that covers that event. An event filter narrows to that event's
   * rows rather than showing every event of anyone who entered it.
   */
  const rows = useMemo(
    () =>
      list.flatMap((p) =>
        (filters.eventId ? p.events.filter((id) => id === filters.eventId) : p.events).map(
          (eventId) => {
            const bout = boutRows.find(
              (b) => (p.boutIds ?? []).includes(b.boutId) && b.eventId === eventId
            );
            return {
              ...p,
              eventId,
              boutId: bout?.boutId ?? null,
              boutName: bout?.boutName ?? null,
            };
          }
        )
      ),
    [list, boutRows, filters.eventId]
  );
  const eventName = (id) => events.find((e) => e.eventId === id)?.name ?? id;
  const boutName = (id) => boutRows.find((b) => b.boutId === id)?.boutName ?? id;

  /* ------------------------------------------------------------ overview -- */

  const overviewTab = () => (
    <>
      <div className="grid cols-3">
        <Stat label={t('stat.participants', 'Participants')} value={summary?.totals.participants ?? '—'} />
        <Stat label={t('stat.events', 'Events')} value={summary?.totals.events ?? '—'} />
        <Stat label={t('stat.bouts', 'Bouts')} value={summary?.totals.bouts ?? '—'} />
      </div>
      <div className="grid cols-3">
        <Stat
          label={t('stat.judgesActive', 'Judges active')}
          value={summary ? `${summary.totals.judgesWithBout} / ${summary.totals.judges}` : '—'}
        />
        <Stat label={t('stat.completion', 'Overall completion')} value={summary ? `${summary.completion.pct}%` : '—'} />
        <Stat label={t('stat.averageScore', 'Average score')} value={summary?.averageScore ?? '—'} />
      </div>

      <section className="card">
        <h2>Event progress</h2>
        <p>Entries per event, how many have been scored, and who is on the podium.</p>
        <SeriesLegend items={SERIES} />
        <div className="grid cols-2" style={{ marginTop: 14 }}>
          {eventRows.map((e) => (
            <div key={e.eventId} className="card event-card">
              <div className="head">
                <h3>{e.name}</h3>
                <span className="tag">{e.category}</span>
              </div>
              <ProgressBar completed={e.completed} waiting={e.waiting} />
              <div className="meta">
                <span><b>{e.participants}</b> entered</span>
                <span><b>{e.completed}</b> scored</span>
                <span><b>{e.waiting}</b> waiting</span>
                <span>avg <b>{e.averageScore ?? '—'}</b></span>
              </div>
              {e.topPerformers.length > 0 && (
                <div className="podium">
                  {e.topPerformers.map((t) => (
                    <span key={t.participantId} className="tag on">
                      #{t.positionName} {t.participantName} · {t.total}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        {eventRows.length === 0 && <div className="empty">No events yet.</div>}
      </section>

      <section className="card">
        <h2>Bout grid</h2>
        <p>Shade and number both show the share of the bout that has been scored. Click a bout to filter the list view.</p>
        <Heatmap
          cells={boutRows}
          onSelect={(c) => setFilters({ ...EMPTY_FILTERS, boutId: c.boutId })}
        />
      </section>

      <section className="card">
        <h2>Judges</h2>
        <p>Participants judged per judge.</p>
        <BarChart
          valueLabel="judged"
          emptyText="No judges registered yet."
          rows={judgeRows.map((j) => ({
            label: j.judgeName,
            value: j.judged,
            detail: [
              `${j.judged} of ${j.assigned} judged (${j.completionPct}%)`,
              `Average score ${j.averageScore ?? '—'}`,
              j.boutName ?? 'No bout assigned',
            ],
          }))}
        />
      </section>
    </>
  );

  /* ----------------------------------------------------------- list view -- */

  const listTab = () => (
    <section className="card">
      <h2>Filtered list</h2>
      <p>
        {rows.length} entr{rows.length === 1 ? 'y' : 'ies'} across {list.length} competitor
        {list.length === 1 ? '' : 's'}. A competitor entered in several events gets a row per
        event, all under the same registration ID.
      </p>

      <div className="filters">
        <Field label="Search">
          <input value={filters.q} onChange={setFilter('q')} placeholder="Name or UID" />
        </Field>
        <Field label="Event">
          <select value={filters.eventId} onChange={setFilter('eventId')}>
            <option value="">All events</option>
            {events.map((e) => (
              <option key={e.eventId} value={e.eventId}>{e.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Age group">
          <select value={filters.ageCategoryId} onChange={setFilter('ageCategoryId')}>
            <option value="">All ages</option>
            {ages.map((a) => (
              <option key={a.ageCategoryId} value={a.ageCategoryId}>
                {a.name} ({a.minAge}–{a.maxAge})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bout">
          <select value={filters.boutId} onChange={setFilter('boutId')}>
            <option value="">All bouts</option>
            <option value="none">Unassigned</option>
            {boutRows.map((b) => (
              <option key={b.boutId} value={b.boutId}>{b.boutName}</option>
            ))}
          </select>
        </Field>
        <Field label="Judge">
          <select value={filters.judgeId} onChange={setFilter('judgeId')}>
            <option value="">All judges</option>
            {judgeRows.map((j) => (
              <option key={j.judgeId} value={j.judgeId}>{j.judgeName}</option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select value={filters.completion} onChange={setFilter('completion')}>
            <option value="">Any status</option>
            <option value="completed">Completed</option>
            <option value="waiting">Waiting</option>
          </select>
        </Field>
      </div>

      <div className="actions" style={{ margin: '14px 0' }}>
        <button
          type="button"
          onClick={() =>
            downloadCsv(
              rows,
              [
                { header: 'UID', value: (r) => r.participantId },
                { header: 'Name', value: (r) => r.participantName },
                { header: 'Academy', value: (r) => r.academyId ?? 'Individual' },
                { header: 'Age', value: (r) => r.age },
                { header: 'Age group', value: (r) => r.ageCategoryName ?? '' },
                { header: 'Location', value: (r) => r.location },
                { header: 'Event', value: (r) => eventName(r.eventId) },
                { header: 'Bout', value: (r) => r.boutName ?? '' },
                { header: 'Status', value: (r) => (r.completed ? 'Completed' : 'Waiting') },
                { header: 'Position', value: (r) => r.positionName ?? '' },
                { header: 'Total', value: (r) => r.total ?? '' },
              ],
              `veeran-participants-${new Date().toISOString().slice(0, 10)}.csv`
            )
          }
          disabled={rows.length === 0}
        >
          Export CSV
        </button>
        <button type="button" className="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>
          Clear filters
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>UID</th>
              <th>Name</th>
              <th>Age group</th>
              <th>Event</th>
              <th>Bout</th>
              <th>Status</th>
              <th>Position</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.participantId}-${r.eventId}`}>
                <td>{r.participantId}</td>
                <td>
                  <button type="button" className="link" onClick={() => setDrilldown(r.participantId)}>
                    {r.participantName}
                  </button>
                </td>
                <td>{r.ageCategoryName ?? '—'}</td>
                <td style={{ whiteSpace: 'normal' }}>{eventName(r.eventId)}</td>
                <td style={{ whiteSpace: 'normal' }}>{r.boutName ?? '—'}</td>
                <td>
                  <span className={`tag${r.completed ? ' on' : ''}`}>
                    {r.completed ? 'Completed' : 'Waiting'}
                  </span>
                </td>
                <td>{r.positionName ?? '—'}</td>
                <td>{r.total ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <div className="empty">No entries match these filters.</div>}
    </section>
  );

  /* --------------------------------------------------------------- setup -- */

  const setupTab = () => (
    <CategorySetup
      ages={ages}
      scoreCats={scoreCats}
      events={events}
      onChanged={refreshAll}
    />
  );

  return {
    error,
    refreshAll,
    drawer: (
      <>
        {drilldown && (
          <ParticipantDrawer
            participantId={drilldown}
            events={events}
            onClose={() => setDrilldown(null)}
            onSaved={refreshAll}
          />
        )}
        {ageDrilldown && (
          <AgeCategoryDrawer ageCategoryId={ageDrilldown} onClose={() => setAgeDrilldown(null)} />
        )}
      </>
    ),
    tabs: [
      { id: 'overview', label: t('tab.overview', 'Overview'), icon: '📊', render: overviewTab },
      { id: 'list', label: t('tab.listView', 'List view'), icon: '🗂', badge: rows.length, render: listTab },
      { id: 'setup', label: t('tab.categories', 'Categories'), icon: '🏷', render: setupTab },
      { id: 'champions', label: t('tab.champions', 'Champions'), icon: '🏅', render: () => <Champions /> },
    ],
  };
}

/** Create and deactivate age categories and score categories. */
function CategorySetup({ ages, scoreCats, events, onChanged }) {
  const [age, setAge] = useState({ name: '', minAge: '', maxAge: '' });
  const [cat, setCat] = useState('');
  const [event, setEvent] = useState({ name: '', category: '', description: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  async function run(fn) {
    setError('');
    setErrors({});
    setMsg('');
    try {
      setMsg(await fn());
      await onChanged();
    } catch (err) {
      setErrors(err.errors ?? {});
      if (!Object.keys(err.errors ?? {}).length) setError(err.message);
    }
  }

  return (
    <>
      <Banner>{error}</Banner>
      {msg && <Banner kind="ok">{msg}</Banner>}

      <Collapsible
        title="Event categories"
        description="Events available across the competition. Deactivated events disappear from every registration form."
        badge={events.length}
        defaultOpen
      >
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const { event: created } = await api.post('/events', event);
              setEvent({ name: '', category: '', description: '' });
              return `Event "${created.name}" created as ${created.eventId}.`;
            });
          }}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Code</th><th>Event</th><th>Category</th><th>Status</th><th /></tr>
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
                      <button
                        type="button"
                        className="ghost"
                        onClick={() =>
                          run(async () => {
                            await api.patch(`/events/${e.eventId}`, { active: !e.active });
                            return `${e.name} ${e.active ? 'deactivated' : 'activated'}.`;
                          })
                        }
                      >
                        {e.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {events.length === 0 && <div className="empty">No events yet.</div>}

          <div className="row two" style={{ marginTop: 14 }}>
            <Field label="Event name" value={event.name} onChange={(e) => setEvent({ ...event, name: e.target.value })} error={errors.name} />
            <Field label="Category" value={event.category} onChange={(e) => setEvent({ ...event, category: e.target.value })} error={errors.category} placeholder="Solo, Pair, Weapon…" />
          </div>
          <Field label="Description" error={errors.description}>
            <textarea value={event.description} onChange={(e) => setEvent({ ...event, description: e.target.value })} />
          </Field>
          <button>Create event</button>
        </form>
      </Collapsible>

      <Collapsible
        title="Age categories"
        description="Ranges must not overlap. A participant's group follows their age, so editing a range re-categorises everyone."
        badge={ages.length}
        defaultOpen
      >
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await api.post('/age-categories', {
              name: age.name,
              minAge: Number(age.minAge),
              maxAge: Number(age.maxAge),
            });
            setAge({ name: '', minAge: '', maxAge: '' });
            return `Age category "${age.name}" created.`;
          });
        }}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>ID</th><th>Name</th><th>Range</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {ages.map((a) => (
                <tr key={a.ageCategoryId}>
                  <td>{a.ageCategoryId}</td>
                  <td>
                    <button type="button" className="link" onClick={() => setAgeDrilldown(a.ageCategoryId)}>
                      {a.name}
                    </button>
                  </td>
                  <td>{a.minAge}–{a.maxAge}</td>
                  <td>
                    <span className={`tag${a.active !== false ? ' on' : ''}`}>
                      {a.active !== false ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() =>
                        run(async () => {
                          await api.patch(`/age-categories/${a.ageCategoryId}`, { active: a.active === false });
                          return `${a.name} ${a.active === false ? 'activated' : 'deactivated'}.`;
                        })
                      }
                    >
                      {a.active === false ? 'Activate' : 'Deactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="row two" style={{ marginTop: 14 }}>
          <Field label="Name" value={age.name} onChange={(e) => setAge({ ...age, name: e.target.value })} error={errors.name} />
          <div className="row two">
            <Field label="Min age" inputMode="numeric" value={age.minAge} onChange={(e) => setAge({ ...age, minAge: e.target.value })} error={errors.minAge} />
            <Field label="Max age" inputMode="numeric" value={age.maxAge} onChange={(e) => setAge({ ...age, maxAge: e.target.value })} error={errors.maxAge} />
          </div>
        </div>
        <button>Add age category</button>
      </form>
      </Collapsible>

      <Collapsible
        title="Score categories"
        description="The scoring screen renders one input per active category, capped at five."
        badge={scoreCats.filter((c) => c.active !== false).length}
      >
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await api.post('/score-categories', { categoryName: cat });
            setCat('');
            return `Score category "${cat}" created.`;
          });
        }}
      >
        <div className="chips">
          {scoreCats.map((c) => (
            <button
              key={c.categoryId}
              type="button"
              className="chip"
              data-on={c.active !== false}
              onClick={() =>
                run(async () => {
                  await api.patch(`/score-categories/${c.categoryId}`, { active: c.active === false });
                  return `${c.categoryName} ${c.active === false ? 'activated' : 'deactivated'}.`;
                })
              }
            >
              {c.categoryName}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 14 }}>
          <Field label="New category" value={cat} onChange={(e) => setCat(e.target.value)} error={errors.categoryName} />
        </div>
        <button>Add score category</button>
      </form>
      </Collapsible>

    </>
  );
}
