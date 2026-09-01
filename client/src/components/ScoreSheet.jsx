import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Banner, Field, Modal } from './ui.jsx';

/**
 * The detailed scoring screen, opened from a participant name on the judge
 * dashboard. Categories and positions come from the server so adding a
 * category to Score Category Table needs no client change.
 */
export default function ScoreSheet({ participant, bout, meta, onClose, onSaved }) {
  const { categories, positions, range } = meta;
  const [scores, setScores] = useState(() =>
    Object.fromEntries(categories.map((c) => [c.categoryId, '']))
  );
  const [positionId, setPositionId] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Pre-fill from any sheet this judge already submitted, so submit doubles as revise.
  useEffect(() => {
    let cancelled = false;
    api
      .get(`/scores/participant/${participant.participantId}?boutId=${bout.boutId}`)
      .then(({ score }) => {
        if (cancelled || !score) return setLoaded(true);
        setScores(
          Object.fromEntries(
            categories.map((c) => [c.categoryId, String(score.scores?.[c.categoryId] ?? '')])
          )
        );
        setPositionId(score.positionId ?? '');
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => { cancelled = true; };
  }, [participant.participantId, bout.boutId, categories]);

  const total = Object.values(scores).reduce((sum, v) => sum + (Number(v) || 0), 0);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    try {
      await api.post('/scores', {
        participantId: participant.participantId,
        boutId: bout.boutId,
        positionId,
        scores,
      });
      await onSaved();
    } catch (err) {
      setErrors(err.errors);
      if (!Object.keys(err.errors ?? {}).length) setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={participant.participantName} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        {participant.participantId} · {bout.boutName} · {bout.eventName ?? participant.events.join(', ')}
      </p>

      <Banner>{error}</Banner>

      <form onSubmit={submit} style={{ marginTop: error ? 14 : 0 }}>
        {categories.map((c) => (
          <Field
            key={c.categoryId}
            label={`${c.categoryName} (${range.minScore}–${range.maxScore})`}
            type="number"
            inputMode="decimal"
            min={range.minScore}
            max={range.maxScore}
            step="0.5"
            value={scores[c.categoryId]}
            onChange={(e) => setScores({ ...scores, [c.categoryId]: e.target.value })}
            error={errors[c.categoryId]}
          />
        ))}

        <Field label="Position" error={errors.positionId}>
          <select value={positionId} onChange={(e) => setPositionId(e.target.value)}>
            <option value="">Select a position…</option>
            {positions.map((p) => (
              <option key={p.positionId} value={p.positionId}>
                {p.positionName}
              </option>
            ))}
          </select>
        </Field>

        {errors.scores && <div className="error-text">{errors.scores}</div>}

        <div className="cred">
          <div>
            <div className="k">Total</div>
            <div className="v">{total}</div>
          </div>
          <span className="muted" style={{ fontSize: 13 }}>
            {participant.scored ? 'Revising a submitted sheet' : 'Not yet submitted'}
          </span>
        </div>

        <div className="actions">
          <button disabled={busy || !loaded}>
            {busy ? 'Submitting…' : participant.scored ? 'Update scores' : 'Submit scores'}
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
