import * as db from './store.js';
import { config } from '../config.js';

/*
 * Tournaments, and the tournament tag every competition record carries.
 *
 * Everything a competition owns — academies, participants, judges, bouts,
 * entries, scores, medals — belongs to exactly one tournament. That tag is what
 * lets an admin be restricted to their own tournaments and what lets a backup
 * be taken for one tournament rather than the whole system.
 */

/** Collections whose rows belong to a tournament. */
export const SCOPED = [
  'Academy',
  'Participants',
  'Judges',
  'BoutMaster',
  'BoutEntries',
  'Scores',
  'Medals',
];

const today = () => new Date().toISOString().slice(0, 10);

/**
 * A tournament is live when it is switched on and today is on or before its end
 * date. The end date is inclusive: a tournament ending today is still running.
 */
export function isRunning(tournament, on = today()) {
  if (!tournament || tournament.status !== 'active') return false;
  return !tournament.endDate || on <= tournament.endDate;
}

/**
 * Switches off any tournament whose end date has passed.
 *
 * Runs on boot and on a timer, and is also safe to call ad hoc — it only ever
 * writes to tournaments that are still marked active past their end date, so
 * calling it repeatedly costs nothing.
 */
export function autoDeactivateExpired(on = today()) {
  if (config().tournaments?.autoDeactivateAfterEndDate === false) return [];

  const expired = db.filter(
    'Tournaments',
    (t) => t.status === 'active' && t.endDate && on > t.endDate
  );

  for (const t of expired) {
    db.update('Tournaments', (x) => x.tournamentId === t.tournamentId, {
      status: 'inactive',
      deactivatedAt: new Date().toISOString(),
      deactivatedBy: 'system:auto',
    });
  }
  return expired.map((t) => t.tournamentId);
}

/** The tournament new records are filed under: the running one, most recent first. */
export function currentTournamentId() {
  const running = db
    .filter('Tournaments', (t) => isRunning(t))
    .sort((a, b) => String(b.startDate ?? '').localeCompare(String(a.startDate ?? '')));
  if (running.length > 0) return running[0].tournamentId;

  const all = db.all('Tournaments');
  return all.length > 0 ? all[all.length - 1].tournamentId : null;
}

/**
 * Which tournaments a request may see: `null` means everything.
 *
 * Super Admin always gets null — the spec is explicit that they override
 * tournament-specific restrictions. An admin with no tournaments listed is
 * unrestricted too, which keeps every admin working as before until someone
 * deliberately narrows them.
 */
export function scopeFor(user) {
  if (!user || user.role === 'SUPER_ADMIN') return null;

  const login = db.find('LoginMaster', (l) => l.uid === user.uid);
  const ids = login?.tournamentIds;
  return Array.isArray(ids) && ids.length > 0 ? ids : null;
}

/** True when a row is visible under the given scope. */
export function inScope(row, scope) {
  if (!scope) return true;
  // A row from before tournaments existed has no tag; it stays visible rather
  // than disappearing from a restricted admin's dashboard.
  return !row?.tournamentId || scope.includes(row.tournamentId);
}

/**
 * Seeds a first tournament if none exists and tags any untagged rows with it,
 * so enabling tournaments on a running competition does not orphan its data.
 * Idempotent: rows that already carry a tag are left alone.
 */
export function ensureTournament() {
  let list = db.all('Tournaments');

  if (list.length === 0) {
    const now = new Date();
    const year = now.getFullYear();
    db.insert('Tournaments', {
      tournamentId: db.nextId('Tournaments', 'tournamentId', 'TOURNAMENT'),
      name: `Silambam Open ${year}`,
      description: 'Created automatically for data that predates tournaments.',
      location: '',
      startDate: now.toISOString().slice(0, 10),
      endDate: '',
      status: 'active',
      createdAt: now.toISOString(),
    });
    list = db.all('Tournaments');
  }

  const fallback = list[0].tournamentId;
  let tagged = 0;

  for (const name of SCOPED) {
    for (const row of db.all(name)) {
      if (row.tournamentId) continue;
      const key = Object.keys(row)[0];
      db.update(name, (r) => r[key] === row[key], { tournamentId: fallback });
      tagged += 1;
    }
  }

  return { tournamentId: fallback, tagged };
}
