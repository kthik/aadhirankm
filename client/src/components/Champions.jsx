import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Banner, Modal, Stat } from './ui.jsx';

const MEDAL_ICON = { Gold: '🥇', Silver: '🥈', Bronze: '🥉' };

/**
 * Medal winners grouped by bout, with the issue action.
 *
 * Issuing is one-way and confirmed first: handing over a medal is a physical
 * act, so the record should not be a checkbox an admin can flip back and forth.
 * Once issued the box is checked, disabled, and stamped with who issued it.
 */
export default function Champions() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () => api.get('/champions').then(setData),
    []
  );

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  async function issue() {
    setBusy(true);
    setError('');
    try {
      await api.post('/champions/issue', {
        boutId: confirm.boutId,
        participantId: confirm.winner.participantId,
      });
      setConfirm(null);
      await load();
    } catch (err) {
      setError(err.message);
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  const totals = data?.totals;

  return (
    <>
      {totals && (
        <>
          <div className="grid cols-3">
            <Stat label="Medals earned" value={totals.medals} />
            <Stat label="Issued" value={`${totals.issued} · ${totals.medals ? Math.round((totals.issued / totals.medals) * 100) : 0}%`} />
            <Stat label="Awaiting handover" value={totals.pending} />
          </div>
          <div className="grid cols-3">
            <Stat label="🥇 Gold" value={totals.gold} />
            <Stat label="🥈 Silver" value={totals.silver} />
            <Stat label="🥉 Bronze" value={totals.bronze} />
          </div>
        </>
      )}

      <Banner>{error}</Banner>

      {(data?.groups ?? []).map((g) => (
        <section className="card" key={g.boutId}>
          <div className="event-card head">
            <h2>{g.boutName}</h2>
            <span className="tag">{g.eventName ?? 'All events'}</span>
          </div>
          <p>
            {g.issued} of {g.winners.length} medal{g.winners.length === 1 ? '' : 's'} handed over.
          </p>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Place</th>
                  <th>Medal</th>
                  <th>UID</th>
                  <th>Name</th>
                  <th>Total</th>
                  <th>Judge</th>
                  <th>Issued</th>
                </tr>
              </thead>
              <tbody>
                {g.winners.map((w) => (
                  <tr key={w.participantId}>
                    <td>{w.place}</td>
                    <td>
                      <span className="tag on">
                        {MEDAL_ICON[w.medal] ?? ''} {w.medal}
                      </span>
                    </td>
                    <td>{w.participantId}</td>
                    <td>{w.participantName}</td>
                    <td><b>{w.total}</b></td>
                    <td>{w.judgeName}</td>
                    <td>
                      <label className="issue-box" title={w.issued ? `Issued ${new Date(w.issuedAt).toLocaleString()}` : 'Mark this medal as handed over'}>
                        <input
                          type="checkbox"
                          checked={w.issued}
                          disabled={w.issued}
                          onChange={() => setConfirm({ boutId: g.boutId, boutName: g.boutName, winner: w })}
                        />
                        {w.issued ? 'Issued' : 'Mark issued'}
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {data && data.groups.length === 0 && (
        <section className="card">
          <h2>Champions</h2>
          <p>No medal positions have been awarded yet. Winners appear here as judges submit scores.</p>
        </section>
      )}

      {confirm && (
        <Modal title="Confirm medal issued" onClose={() => setConfirm(null)}>
          <p className="muted" style={{ marginTop: 0 }}>
            Record the {confirm.winner.medal.toLowerCase()} medal for{' '}
            <b>{confirm.winner.participantName}</b> ({confirm.winner.participantId}) in{' '}
            {confirm.boutName} as handed over?
          </p>
          <Banner kind="warn">This cannot be undone from the dashboard.</Banner>
          <div className="actions" style={{ marginTop: 14 }}>
            <button disabled={busy} onClick={issue}>
              {busy ? 'Recording…' : 'Confirm issued'}
            </button>
            <button type="button" className="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
