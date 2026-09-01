import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { SplitRows, SeriesLegend, TrendChart } from './charts.jsx';
import Collapsible from './Collapsible.jsx';
import { Banner, Field, Stat } from './ui.jsx';

/*
 * The Super Admin infographic.
 *
 * One filter bar drives everything below it: the overall figures, the
 * breakdowns, the per-tournament cards and the progress trend all come from a
 * single /dashboard/overview call, so no two panels can disagree about what is
 * being shown. Filters live in the query string on the server side, which keeps
 * the "custom filter" the same object for every panel.
 */

const SERIES = [
  { label: 'Scored', color: 'var(--series-1)' },
  { label: 'Waiting', color: 'var(--series-2)' },
];

const TREND_SERIES = [
  { label: 'Registered (cumulative)', color: 'var(--series-2)' },
  { label: 'Scored (cumulative)', color: 'var(--series-1)' },
];

const EMPTY = {
  tournamentId: '',
  eventId: '',
  ageCategoryId: '',
  academyId: '',
  from: '',
  to: '',
};

function pctText(n) {
  return `${n}%`;
}

/** Headline figures. Kept to six so the row stays readable on a phone. */
function Totals({ t }) {
  return (
    <div className="grid cols-3">
      <Stat label="Competitors" value={t.participants} />
      <Stat label="Scored" value={`${t.completed} · ${pctText(t.completedPct)}`} />
      <Stat label="Waiting" value={t.waiting} />
      <Stat label="Event entries" value={t.entries} />
      <Stat label="Average score" value={t.averageScore ?? '—'} />
      <Stat label="Bouts in play" value={t.bouts} />
    </div>
  );
}

/** One tournament's block: its own totals, progress and per-event split. */
function TournamentCard({ t }) {
  return (
    <section className="card tcard">
      <div className="tcard-head">
        <div>
          <h3>{t.name}</h3>
          <div className="meta">
            <span>{t.tournamentId}</span>
            {t.startDate && (
              <span>
                {t.startDate}
                {t.endDate ? ` → ${t.endDate}` : ''}
              </span>
            )}
          </div>
        </div>
        <span className={`tag${t.active ? ' on' : ''}`}>{t.active ? 'Active' : 'Closed'}</span>
      </div>

      <div className="tcard-figures">
        <div>
          <b>{t.totals.participants}</b> competitors
        </div>
        <div>
          <b>{t.totals.academies}</b> academies
        </div>
        <div>
          <b>{t.totals.entries}</b> entries
        </div>
        <div>
          <b>{t.totals.sheets}</b> sheets filed
        </div>
        <div>
          <b>{t.totals.averageScore ?? '—'}</b> average
        </div>
        <div>
          <b>{t.totals.medals}</b> podium places
        </div>
      </div>

      <div className="tcard-progress">
        <span className="pct">{pctText(t.totals.completedPct)}</span>
        <SplitRows
          rows={[
            {
              id: t.tournamentId,
              label: 'Scored so far',
              participants: t.totals.participants,
              completed: t.totals.completed,
              waiting: t.totals.waiting,
              completedPct: t.totals.completedPct,
            },
          ]}
        />
      </div>

      <h4>By event</h4>
      <SplitRows rows={t.events} emptyText="No competitors match the filters in this tournament." />
    </section>
  );
}

export default function SuperAdminOverview() {
  const [filters, setFilters] = useState(EMPTY);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
    return params.toString();
  }, [filters]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await api.get(`/dashboard/overview${query ? `?${query}` : ''}`));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });
  const active = Object.values(filters).filter(Boolean).length;
  const options = data?.options ?? { tournaments: [], events: [], ageCategories: [], academies: [] };

  return (
    <>
      <Banner>{error}</Banner>

      <section className="card">
        <h2>Custom filter</h2>
        <p>
          Every figure, breakdown and tournament card below is drawn from the competitors these
          filters select
          {data ? ` — ${data.matched} of ${data.ofTotal} right now.` : '.'}
        </p>

        <div className="filters">
          <Field label="Tournament">
            <select value={filters.tournamentId} onChange={set('tournamentId')}>
              <option value="">All tournaments</option>
              {options.tournaments.map((t) => (
                <option key={t.tournamentId} value={t.tournamentId}>
                  {t.name}
                  {t.active ? '' : ' (closed)'}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Event">
            <select value={filters.eventId} onChange={set('eventId')}>
              <option value="">All events</option>
              {options.events.map((e) => (
                <option key={e.eventId} value={e.eventId}>{e.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Age category">
            <select value={filters.ageCategoryId} onChange={set('ageCategoryId')}>
              <option value="">All ages</option>
              {options.ageCategories.map((a) => (
                <option key={a.ageCategoryId} value={a.ageCategoryId}>{a.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Academy">
            <select value={filters.academyId} onChange={set('academyId')}>
              <option value="">All academies</option>
              <option value="none">Individual entrants</option>
              {options.academies.map((a) => (
                <option key={a.academyId} value={a.academyId}>{a.academyName}</option>
              ))}
            </select>
          </Field>
          <Field label="Registered from" type="date" value={filters.from} onChange={set('from')} />
          <Field label="Registered to" type="date" value={filters.to} onChange={set('to')} />
        </div>

        <div className="actions">
          <button type="button" className="ghost" onClick={() => setFilters(EMPTY)} disabled={active === 0}>
            Clear {active > 0 ? `${active} filter(s)` : 'filters'}
          </button>
          <button type="button" className="ghost" onClick={load} disabled={busy}>
            {busy ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </section>

      {data && (
        <>
          <Collapsible
            title="Overall"
            description="Everything the filters select, across every tournament."
            defaultOpen
          >
            <Totals t={data.overall} />

            <div className="grid cols-2" style={{ marginTop: 14 }}>
              <section className="card">
                <h2>Scoring progress by event</h2>
                <SeriesLegend items={SERIES} />
                <SplitRows rows={data.breakdown.events} />
              </section>
              <section className="card">
                <h2>By age category</h2>
                <SeriesLegend items={SERIES} />
                <SplitRows rows={data.breakdown.ageCategories} />
              </section>
            </div>

            <section className="card" style={{ marginTop: 14 }}>
              <h2>By academy</h2>
              <SeriesLegend items={SERIES} />
              <SplitRows rows={data.breakdown.academies} />
            </section>
          </Collapsible>

          <Collapsible
            title="Overall progress"
            description="Registrations against sheets filed, day by day and cumulative."
            defaultOpen
          >
            <section className="card">
              <div className="progress-head">
                <div>
                  <div className="big">{pctText(data.overall.completedPct)}</div>
                  <div className="muted">
                    {data.overall.completed} of {data.overall.participants} competitors scored
                    {data.overall.unassigned > 0 && ` · ${data.overall.unassigned} not yet in a bout`}
                  </div>
                </div>
                <div className="progress-figures">
                  <div>
                    <b>{data.overall.sheets}</b> sheets
                  </div>
                  <div>
                    <b>{data.overall.topScore ?? '—'}</b> top score
                  </div>
                  <div>
                    <b>{data.overall.medals}</b> podium places
                  </div>
                </div>
              </div>
              <SeriesLegend items={TREND_SERIES} />
              <TrendChart points={data.timeline} emptyText="No registrations in this window." />
            </section>
          </Collapsible>

          <Collapsible
            title="Tournament by tournament"
            description="The same figures, per tournament, under the same filters."
            badge={data.tournaments.length}
            defaultOpen
          >
            {data.tournaments.length === 0 ? (
              <div className="empty">No tournaments yet.</div>
            ) : (
              <div className="grid cols-2">
                {data.tournaments.map((t) => (
                  <TournamentCard key={t.tournamentId} t={t} />
                ))}
              </div>
            )}
          </Collapsible>
        </>
      )}
    </>
  );
}
