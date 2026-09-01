import * as db from './store.js';
import { currentTournamentId } from './tournament.js';

/*
 * Bout entries and performance order.
 *
 * A participant registered for several events sits in one bout per event, so
 * the participant-to-bout link is a row in BoutEntries rather than a field on
 * the participant. Everything below is derived from those rows plus the filed
 * scores - no status is stored, so nothing can go stale.
 */

/** True once any judge has filed a sheet for this participant in this bout. */
function isScored(participantId, boutId, scores) {
  return scores.some((s) => s.participantId === participantId && s.boutId === boutId);
}

export function entriesForBout(boutId) {
  return db.filter('BoutEntries', (e) => e.boutId === boutId);
}

export function entriesForParticipant(participantId) {
  return db.filter('BoutEntries', (e) => e.participantId === participantId);
}

export function boutIdsFor(participantId) {
  return entriesForParticipant(participantId).map((e) => e.boutId);
}

/**
 * A competitor may only sit in one bout per event: two bouts for the same event
 * would mean being judged twice for it. Returns the clashing bout, or null.
 * Bouts with no event set are unconstrained, since they are not event-specific.
 */
export function eventClashFor(participantId, boutId) {
  const bout = db.find('BoutMaster', (b) => b.boutId === boutId);
  if (!bout?.eventId) return null;

  const clash = entriesForParticipant(participantId)
    .filter((e) => e.boutId !== boutId)
    .map((e) => db.find('BoutMaster', (b) => b.boutId === e.boutId))
    .find((b) => b?.eventId === bout.eventId);

  return clash ?? null;
}

/** Appends to the end of the bout's queue; re-adding an existing entry is a no-op. */
export function addEntry(boutId, participantId) {
  const existing = db.find(
    'BoutEntries',
    (e) => e.boutId === boutId && e.participantId === participantId
  );
  if (existing) return existing;

  const queueNo = entriesForBout(boutId).reduce((n, e) => Math.max(n, e.queueNo ?? 0), 0) + 1;
  return db.insert('BoutEntries', {
    entryId: `${boutId}-${participantId}`,
    tournamentId: db.find('BoutMaster', (b) => b.boutId === boutId)?.tournamentId ?? null,
    boutId,
    participantId,
    queueNo,
    createdAt: new Date().toISOString(),
  });
}

export function removeEntry(boutId, participantId) {
  return db.remove('BoutEntries', (e) => e.boutId === boutId && e.participantId === participantId);
}

/**
 * Of a competitor's unscored entries, the one they perform next.
 *
 * Decided by their own queue number, lowest first, with the lower bout id
 * breaking a tie. Both inputs are fixed at assignment time, so a competitor
 * cannot flip between "ready" and "in other performance" because somebody
 * else in either bout happened to be scored - the judge sees a stable row.
 */
export function activeBoutFor(participantId, scores = db.all('Scores')) {
  const pending = entriesForParticipant(participantId).filter(
    (e) => !isScored(participantId, e.boutId, scores)
  );
  if (pending.length === 0) return null;

  return pending
    .slice()
    .sort((a, b) => (a.queueNo ?? 0) - (b.queueNo ?? 0) || a.boutId.localeCompare(b.boutId))[0]
    .boutId;
}

/**
 * How a participant reads on one judge's list:
 *   scored  - this judge is done with them
 *   blocked - performing in another bout right now; not clickable
 *   ready   - clear to perform and be scored
 */
export function statusFor(participantId, boutId, scores = db.all('Scores')) {
  if (isScored(participantId, boutId, scores)) return 'scored';
  return activeBoutFor(participantId, scores) === boutId ? 'ready' : 'blocked';
}

/**
 * The judge's running order for a bout.
 *
 * Participants entered in more events go first so they have time to prepare
 * for their next event; within the same number of events the queue number
 * decides. Scored entries drop to the bottom - the judge's work is there.
 */
export function rosterFor(bout) {
  const scores = db.all('Scores');
  const participants = db.all('Participants');
  const events = db.all('EventMaster');
  const positions = db.all('PositionMaster');

  const rows = entriesForBout(bout.boutId)
    .map((entry) => {
      const p = participants.find((x) => x.participantId === entry.participantId);
      if (!p) return null;

      const sheet = scores.find(
        (s) => s.participantId === p.participantId && s.boutId === bout.boutId
      );
      const status = statusFor(p.participantId, bout.boutId, scores);
      const otherBout = status === 'blocked' ? activeBoutFor(p.participantId, scores) : null;
      const eventCount = entriesForParticipant(p.participantId).length;

      // A judge scores one event, so only the bout's own event is shown. A bout
      // with no event set falls back to everything the participant entered.
      const shownEvents = (bout.eventId ? [bout.eventId] : p.events)
        .map((id) => events.find((e) => e.eventId === id)?.name ?? id);

      return {
        participantId: p.participantId,
        participantName: p.participantName,
        academyId: p.academyId,
        age: p.age,
        queueNo: entry.queueNo,
        eventCount,
        events: shownEvents,
        boutId: bout.boutId,
        status,
        blockedBy: otherBout
          ? db.find('BoutMaster', (b) => b.boutId === otherBout)?.boutName ?? otherBout
          : null,
        scored: status === 'scored',
        positionId: sheet?.positionId ?? null,
        positionName: sheet
          ? positions.find((x) => x.positionId === sheet.positionId)?.positionName ?? null
          : null,
        total: sheet?.total ?? null,
      };
    })
    .filter(Boolean);

  return rows.sort(
    (a, b) =>
      Number(a.scored) - Number(b.scored) ||
      b.eventCount - a.eventCount ||
      a.queueNo - b.queueNo ||
      a.participantId.localeCompare(b.participantId)
  );
}

/**
 * One-time migration from a judge's single `boutId` to the `boutIds` list, so a
 * judge can hold several bouts. Idempotent: a judge already migrated is skipped.
 */
export function migrateJudgeBouts() {
  let moved = 0;
  for (const j of db.all('Judges')) {
    if (Array.isArray(j.boutIds)) continue;
    db.update('Judges', (x) => x.judgeId === j.judgeId, {
      boutIds: j.boutId ? [j.boutId] : [],
      boutId: undefined,
    });
    moved += 1;
  }
  return moved;
}

/**
 * One-time migration from the single `participant.boutId` field to BoutEntries.
 * Runs on boot and is idempotent: an entry that already exists is left alone.
 */
export function migrateLegacyBoutIds() {
  let moved = 0;
  for (const p of db.all('Participants')) {
    if (!p.boutId) continue;
    const existing = db.find(
      'BoutEntries',
      (e) => e.boutId === p.boutId && e.participantId === p.participantId
    );
    if (!existing) {
      addEntry(p.boutId, p.participantId);
      moved += 1;
    }
    // Clear the old field so nothing can read a stale second copy of the link.
    db.update('Participants', (x) => x.participantId === p.participantId, { boutId: null });
  }
  return moved;
}
