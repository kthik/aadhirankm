import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Field } from './ui.jsx';

/*
 * "Which tournament are you registering for?" for the public sign-up forms.
 *
 * The list comes from the Tournaments table, holding only the ones open for
 * entries: active, dated, and not finished - so the current and future
 * competitions, never a closed one. Picking one shows its dates, location and
 * venue address, so a registrant can tell two competitions apart before
 * committing.
 *
 * Loads on its own rather than being fed by the pages, since both registration
 * forms need exactly the same list and neither has a session yet. With the
 * tournaments module switched off the endpoint 404s and the field disappears:
 * the server then files the entry under the current tournament as it did before.
 */

/** dd Mon, for the option labels - the detail panel carries the full dates. */
function shortDate(d) {
  if (!d) return 'dates TBA';
  return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** dd Mon yyyy, or a range when the tournament runs over several days. */
function whenText(t) {
  const fmt = (d) =>
    new Date(`${d}T00:00:00`).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

  if (!t.startDate) return 'Dates to be announced';
  if (!t.endDate || t.endDate === t.startDate) return fmt(t.startDate);
  return `${fmt(t.startDate)} → ${fmt(t.endDate)}`;
}

export default function TournamentPicker({ value, onChange, error }) {
  const [tournaments, setTournaments] = useState(null);

  useEffect(() => {
    api
      .get('/tournaments/open')
      .then((d) => setTournaments(d.tournaments))
      .catch(() => setTournaments([]));
  }, []);

  // Nothing to choose: module off, or no tournament taking entries.
  if (tournaments === null || tournaments.length === 0) return null;

  const selected = tournaments.find((t) => t.tournamentId === value) ?? null;

  return (
    <>
      <Field label="Registering for" error={error}>
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose a tournament…</option>
          {tournaments.map((t) => (
            <option key={t.tournamentId} value={t.tournamentId}>
              {t.name} · {t.phase === 'upcoming' ? 'starts' : 'on now, from'} {shortDate(t.startDate)}
            </option>
          ))}
        </select>
      </Field>

      {selected && (
        <div className="tourn-detail">
          <div>
            <span className="k">Dates</span>
            <span className="v">
              {whenText(selected)}
              {selected.phase === 'current' && <span className="tag on">Under way</span>}
            </span>
          </div>
          <div>
            <span className="k">Location</span>
            <span className="v">{selected.location || 'To be announced'}</span>
          </div>
          <div>
            <span className="k">Venue address</span>
            <span className="v">{selected.address || 'To be announced'}</span>
          </div>
          {selected.description && (
            <div>
              <span className="k">About</span>
              <span className="v">{selected.description}</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
