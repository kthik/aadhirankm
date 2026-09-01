import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Banner, Modal, Stat } from './ui.jsx';

/** Everyone whose age falls in one band, opened from the category name. */
export default function AgeCategoryDrawer({ ageCategoryId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/age-categories/${ageCategoryId}/participants`)
      .then((d) => !cancelled && setData(d))
      .catch((err) => setError(err.message));
    return () => { cancelled = true; };
  }, [ageCategoryId]);

  const band = data?.ageCategory;

  return (
    <Modal title={band?.name ?? 'Age category'} onClose={onClose}>
      <Banner>{error}</Banner>

      {band && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            {band.ageCategoryId} · ages {band.minAge}–{band.maxAge} · membership follows each
            competitor's age, so it updates itself.
          </p>

          <div className="grid cols-3" style={{ margin: '14px 0' }}>
            <Stat label="Competitors" value={data.stats.participants} />
            <Stat label="In a bout" value={data.stats.assigned} />
            <Stat label="Scored" value={data.stats.completed} />
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>UID</th>
                  <th>Name</th>
                  <th>Age</th>
                  <th>Academy</th>
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
                    <td>{p.academyName}</td>
                    <td style={{ whiteSpace: 'normal' }}>{p.eventNames.join(', ')}</td>
                    <td style={{ whiteSpace: 'normal' }}>{p.boutNames.join(', ') || '—'}</td>
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
          {data.participants.length === 0 && (
            <div className="empty">No competitors in this age band yet.</div>
          )}
        </>
      )}
    </Modal>
  );
}
