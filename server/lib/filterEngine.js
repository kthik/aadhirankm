import * as db from './store.js';

/*
 * The filter engine behind custom backup, restore and delete.
 *
 * A filter names a set of competition records. Selecting a tournament, academy
 * or participant has to pull in what hangs off it — an academy's participants,
 * their bout entries, their scores and medals — or a "backup this academy"
 * would produce rows that reference competitors the file does not contain.
 */

/** The key field of each collection, used to identify a row. */
export const KEYS = {
  Academy: 'academyId',
  Participants: 'participantId',
  Judges: 'judgeId',
  BoutMaster: 'boutId',
  BoutEntries: 'entryId',
  Scores: 'scoreId',
  Medals: 'medalId',
  EventMaster: 'eventId',
  AgeCategory: 'ageCategoryId',
  ScoreCategory: 'categoryId',
  PositionMaster: 'positionId',
  LoginMaster: 'uid',
  Tournaments: 'tournamentId',
  SystemLogs: 'logId',
};

/** Collections a filtered selection can touch, in dependency order. */
const SELECTABLE = [
  'Academy',
  'Participants',
  'Judges',
  'BoutMaster',
  'BoutEntries',
  'Scores',
  'Medals',
];

const dateOf = (row) => String(row.createdAt ?? '').slice(0, 10);

function withinDates(row, from, to) {
  if (!from && !to) return true;
  const d = dateOf(row);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

/**
 * Resolves a filter into the rows it selects.
 *
 * `filter` accepts any of tournamentId, academyId, participantId, from, to.
 * With none of them the selection is everything, which is the full-backup case.
 *
 * The `mode` matters, because backup and delete want different things from the
 * same filter. A backup of one competitor should carry their academy, bout and
 * judge so the file makes sense on its own; deleting that competitor must not
 * take their academy and judge with them. So:
 *
 *   mode 'backup'  - subject rows plus the context they reference (default)
 *   mode 'delete'  - only rows the filter actually owns
 *
 * Under 'delete', an academy is included only when the filter names an academy
 * or a tournament, and judges and bouts only when it names a tournament —
 * those are the cases where the filter genuinely owns them.
 */
export function select(filter = {}, mode = 'backup') {
  const { tournamentId, academyId, participantId, from, to } = filter;

  let participants = db.all('Participants');
  if (tournamentId) participants = participants.filter((p) => p.tournamentId === tournamentId);
  if (academyId) {
    participants = participants.filter((p) =>
      academyId === 'none' ? !p.academyId : p.academyId === academyId
    );
  }
  if (participantId) participants = participants.filter((p) => p.participantId === participantId);
  participants = participants.filter((p) => withinDates(p, from, to));

  const participantIds = new Set(participants.map((p) => p.participantId));

  // Entries, scores and medals follow the competitors they belong to, so a
  // filtered set never references someone it does not include.
  const entries = db.filter('BoutEntries', (e) => participantIds.has(e.participantId));
  const scores = db.filter('Scores', (s) => participantIds.has(s.participantId));
  const medals = db.filter('Medals', (m) => participantIds.has(m.participantId));

  const boutIds = new Set([...entries.map((e) => e.boutId), ...scores.map((s) => s.boutId)]);
  const narrowed = Boolean(tournamentId || academyId || participantId || from || to);
  const deleting = mode === 'delete';

  // Under delete, a bout or judge is only owned by a tournament-wide filter.
  const ownsStructure = !narrowed || Boolean(tournamentId);
  const ownsAcademy = !narrowed || Boolean(tournamentId || academyId);

  const bouts = db.filter('BoutMaster', (b) => {
    if (!narrowed) return true;
    if (deleting) return ownsStructure && (!tournamentId || b.tournamentId === tournamentId);
    return boutIds.has(b.boutId) || (tournamentId && b.tournamentId === tournamentId);
  });

  const judgeIds = new Set(bouts.map((b) => b.judgeId).filter(Boolean));
  const judges = db.filter('Judges', (j) => {
    if (!narrowed) return true;
    if (deleting) return ownsStructure && (!tournamentId || j.tournamentId === tournamentId);
    return judgeIds.has(j.judgeId) || (tournamentId && j.tournamentId === tournamentId);
  });

  const academyIds = new Set(participants.map((p) => p.academyId).filter(Boolean));
  const academies = db.filter('Academy', (a) => {
    if (!narrowed) return true;
    if (deleting) {
      if (!ownsAcademy) return false;
      if (academyId && academyId !== 'none') return a.academyId === academyId;
      return !tournamentId || a.tournamentId === tournamentId;
    }
    return academyIds.has(a.academyId) || (tournamentId && a.tournamentId === tournamentId);
  });

  return { Academy: academies, Participants: participants, Judges: judges, BoutMaster: bouts, BoutEntries: entries, Scores: scores, Medals: medals };
}

export function summarise(selection) {
  return SELECTABLE.map((name) => ({
    collection: name,
    selected: selection[name]?.length ?? 0,
    total: db.all(name).length,
  }));
}

/**
 * Deletes exactly the selected rows, plus the sign-ins belonging to any
 * academy or participant removed — leaving a login whose account is gone would
 * let someone sign in to nothing.
 */
export function deleteSelection(selection) {
  const removed = {};

  // Reverse dependency order: dependants first, owners last.
  for (const name of [...SELECTABLE].reverse()) {
    const key = KEYS[name];
    const ids = new Set((selection[name] ?? []).map((r) => r[key]));
    if (ids.size === 0) continue;
    removed[name] = db.remove(name, (r) => ids.has(r[key]));
  }

  const orphanUids = new Set([
    ...(selection.Academy ?? []).map((a) => a.academyId),
    ...(selection.Participants ?? []).map((p) => p.participantId),
    ...(selection.Judges ?? []).map((j) => j.judgeId),
  ]);
  if (orphanUids.size > 0) {
    removed.LoginMaster = db.remove('LoginMaster', (l) => orphanUids.has(l.uid));
  }

  return removed;
}

/**
 * Merges incoming rows, skipping any whose key already exists.
 *
 * The spec is explicit that duplicates are skipped rather than overwritten, so
 * a restore can be run twice, or run over a live competition, without silently
 * replacing work done since the backup was taken.
 */
export function mergeSkippingDuplicates(name, incoming) {
  const key = KEYS[name];
  if (!key) throw new Error(`No key defined for ${name}`);

  const existing = db.all(name);
  const seen = new Set(existing.map((r) => r[key]));

  const added = [];
  const skipped = [];

  for (const row of incoming) {
    const id = row[key];
    if (id == null || seen.has(id)) skipped.push(id ?? '(no id)');
    else {
      seen.add(id);
      added.push(row);
    }
  }

  if (added.length) db.replaceAll(name, [...existing, ...added]);
  return { added: added.length, skipped: skipped.length, skippedIds: skipped.slice(0, 20) };
}
