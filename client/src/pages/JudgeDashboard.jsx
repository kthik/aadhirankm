import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { useT } from '../lib/i18n.jsx';
import ScoreSheet from '../components/ScoreSheet.jsx';
import Tabs from '../components/Tabs.jsx';
import { ProgressBar, SeriesLegend } from '../components/charts.jsx';
import { Banner, Stat } from '../components/ui.jsx';

/** One bout's running order. A judge holding several bouts gets one tab each. */
function BoutPanel({ section, meta, onScore, t }) {
  const { bout, participants, progress } = section;

  return (
    <section className="card">
      <div className="event-card head">
        <h2>{bout.boutName}</h2>
        <span className="tag">{bout.eventName ?? t('common.all', 'All events')}</span>
      </div>

      <div className="grid cols-3" style={{ margin: '14px 0' }}>
        <Stat label={t('stat.scored', 'Scored')} value={`${progress.completed} / ${progress.total}`} />
        <Stat label={t('stat.stillToJudge', 'Still to judge')} value={progress.pending} />
        <Stat label={t('stat.podiumClosed', 'Podium closed')} value={`${progress.podiumClosed} · ${progress.podiumClosedPct}%`} />
      </div>

      <SeriesLegend
        items={[
          { label: t('status.scored', 'Scored'), color: 'var(--series-1)' },
          { label: t('status.waiting', 'Waiting'), color: 'var(--series-2)' },
        ]}
      />
      <div style={{ margin: '10px 0 18px' }}>
        <ProgressBar completed={progress.completed} waiting={progress.pending} />
      </div>

      <p>
        Competitors entered in more than one event go first, so they have time to prepare for
        their next event. A row marked <b>In other performance</b> is competing elsewhere and
        cannot be scored until that bout releases them.
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>{t('th.uid', 'Registration ID')}</th>
              <th>{t('th.name', 'Name')}</th>
              <th>{t('th.event', 'Event')}</th>
              <th>{t('th.status', 'Status')}</th>
              <th>{t('th.position', 'Position')}</th>
              <th>{t('th.total', 'Total')}</th>
            </tr>
          </thead>
          <tbody>
            {participants.map((p) => {
              const locked = p.status === 'blocked';
              const open = () => !locked && meta && onScore(p, bout);
              const why = locked ? `Competing in ${p.blockedBy}` : undefined;
              return (
                <tr key={p.participantId} data-locked={locked}>
                  <td>{p.queueNo}</td>
                  <td>
                    <button type="button" className="link" disabled={locked || !meta} title={why} onClick={open}>
                      {p.participantId}
                    </button>
                  </td>
                  <td>
                    <button type="button" className="link" disabled={locked || !meta} title={why} onClick={open}>
                      {p.participantName}
                    </button>
                    {p.eventCount > 1 && (
                      <span className="tag" style={{ marginLeft: 8 }}>{p.eventCount} events</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'normal' }}>{p.events.join(', ')}</td>
                  <td>
                    {p.status === 'scored' && <span className="tag on">{t('status.scored', 'Scored')}</span>}
                    {p.status === 'ready' && <span className="tag">{t('status.ready', 'Ready')}</span>}
                    {locked && (
                      <span className="tag locked" title={why}>
                        {t('status.inOtherPerformance', 'In other performance')}
                      </span>
                    )}
                  </td>
                  <td>{p.positionName ?? '—'}</td>
                  <td>{p.total ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {participants.length === 0 && (
        <div className="empty">No participants assigned to this bout yet.</div>
      )}
    </section>
  );
}

export default function JudgeDashboard() {
  const { user } = useSession();
  const t = useT();
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState(null);
  const [scoring, setScoring] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    setData(await api.get('/judges/me'));
  }

  useEffect(() => {
    Promise.all([load(), api.get('/scores/meta').then(setMeta)]).catch((err) =>
      setError(err.message)
    );
  }, []);

  const sections = data?.bouts ?? [];
  const totals = data?.totals;

  return (
    <main className="page">
      <div className="page-head">
        <h1>{data?.judge?.judgeName ?? 'Judge'}</h1>
        <p>
          {sections.length > 0
            ? `${sections.length} bout${sections.length === 1 ? '' : 's'} assigned`
            : 'No bout assigned yet'}
          {data?.judge?.academyName ? ` · ${data.judge.academyName}` : ''}
        </p>
      </div>

      <Banner>{error}</Banner>

      {user?.mustChangePassword && (
        <Banner kind="warn">
          {t('common.defaultPasswordWarning', 'You are still using the default password. Reset it under the settings gear.')}
        </Banner>
      )}

      {data && sections.length === 0 && !error && (
        <Banner kind="warn">
          No bout has been assigned to you, or yours was reassigned to another judge. Contact
          your Admin.
        </Banner>
      )}

      {totals && sections.length > 0 && (
        <div className="grid cols-3" style={{ margin: '16px 0' }}>
          <Stat label={t('stat.assigned', 'Participants assigned')} value={totals.total} />
          <Stat label={t('status.completed', 'Performances completed')} value={`${totals.completed} · ${totals.completedPct}%`} />
          <Stat label={t('stat.inOther', 'In other performance')} value={totals.blocked} />
        </div>
      )}

      {sections.length > 0 && (
        <Tabs
          tabs={sections.map((section) => ({
            id: section.bout.boutId,
            label: section.bout.eventName ?? section.bout.boutName,
            icon: '🎯',
            badge: section.progress.pending,
            render: () => (
              <BoutPanel
                section={section}
                meta={meta}
                t={t}
                onScore={(p, bout) => setScoring({ participant: p, bout })}
              />
            ),
          }))}
        />
      )}

      {scoring && meta && (
        <ScoreSheet
          participant={scoring.participant}
          bout={scoring.bout}
          meta={meta}
          onClose={() => setScoring(null)}
          onSaved={async () => {
            setScoring(null);
            await load();
          }}
        />
      )}
    </main>
  );
}
