import { Router } from 'express';
import * as db from '../lib/store.js';
import { requireAuth } from '../lib/auth.js';
import { requireModule } from '../config.js';
import { boutIdsFor, entriesForBout } from '../lib/queue.js';
import { inScope, scopeFor } from '../lib/tournament.js';

const router = Router();

router.use(requireAuth('ADMIN', 'SUPER_ADMIN'), requireModule('analytics'));

const pct = (n, total) => (total === 0 ? 0 : Math.round((n / total) * 100));
const mean = (nums) =>
  nums.length === 0 ? null : Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;

/**
 * One read of every collection the analytics endpoints join across, narrowed to
 * the tournaments this user may see. Super Admin and an unrestricted admin get
 * everything; a scoped admin sees only their own tournaments.
 */
function snapshot(req) {
  const scope = scopeFor(req?.user);
  return {
    participants: db.filter('Participants', (p) => inScope(p, scope)),
    events: db.all('EventMaster'),
    bouts: db.filter('BoutMaster', (b) => inScope(b, scope)),
    judges: db.filter('Judges', (j) => inScope(j, scope)),
    scores: db.filter('Scores', (s) => inScope(s, scope)),
    positions: db.all('PositionMaster'),
    ages: db.all('AgeCategory'),
  };
}

/** Age categories are ranges, so a participant's band is derived, never stored. */
function ageBandOf(participant, ages) {
  return ages.find((c) => c.active !== false && participant.age >= c.minAge && participant.age <= c.maxAge) ?? null;
}

/**
 * A participant counts as complete once any judge has filed a sheet for them.
 * Returns the sheet as well, since callers want the position and total too.
 */
function sheetFor(participantId, scores) {
  return scores.find((s) => s.participantId === participantId) ?? null;
}

function decorate(p, snap) {
  const sheet = sheetFor(p.participantId, snap.scores);
  const band = ageBandOf(p, snap.ages);
  const position = sheet ? snap.positions.find((x) => x.positionId === sheet.positionId) : null;
  return {
    participantId: p.participantId,
    participantName: p.participantName,
    academyId: p.academyId,
    age: p.age,
    ageCategoryId: band?.ageCategoryId ?? null,
    ageCategoryName: band?.name ?? null,
    location: p.location,
    events: p.events,
    boutIds: boutIdsFor(p.participantId),
    boutId: boutIdsFor(p.participantId)[0] ?? null,
    judgeId: sheet?.judgeId ?? null,
    completed: Boolean(sheet),
    positionId: sheet?.positionId ?? null,
    positionName: position?.positionName ?? null,
    total: sheet?.total ?? null,
  };
}

/* -------------------------------------------------------------- summary -- */

router.get('/summary', (req, res) => {
  const snap = snapshot(req);
  const rows = snap.participants.map((p) => decorate(p, snap));
  const completed = rows.filter((r) => r.completed).length;

  res.json({
    totals: {
      participants: rows.length,
      events: snap.events.filter((e) => e.active).length,
      bouts: snap.bouts.length,
      judges: snap.judges.filter((j) => j.active !== false).length,
      judgesWithBout: snap.judges.filter((j) => j.active !== false && (j.boutIds ?? []).length > 0).length,
      assigned: rows.filter((r) => r.boutIds.length > 0).length,
    },
    completion: {
      completed,
      waiting: rows.length - completed,
      pct: pct(completed, rows.length),
    },
    averageScore: mean(rows.filter((r) => r.total != null).map((r) => r.total)),
  });
});

/* --------------------------------------------------------------- events -- */

router.get('/events', (req, res) => {
  const snap = snapshot(req);
  const rows = snap.participants.map((p) => decorate(p, snap));

  const events = snap.events.map((e) => {
    const entrants = rows.filter((r) => r.events.includes(e.eventId));
    const done = entrants.filter((r) => r.completed);
    const scored = done.filter((r) => r.total != null);
    const podium = done
      .filter((r) => ['1', '2', '3'].includes(r.positionName))
      .sort((a, b) => Number(a.positionName) - Number(b.positionName))
      .map((r) => ({
        participantId: r.participantId,
        participantName: r.participantName,
        positionName: r.positionName,
        total: r.total,
      }));

    return {
      eventId: e.eventId,
      name: e.name,
      category: e.category,
      active: e.active,
      participants: entrants.length,
      completed: done.length,
      waiting: entrants.length - done.length,
      completedPct: pct(done.length, entrants.length),
      averageScore: mean(scored.map((r) => r.total)),
      topPerformers: podium.slice(0, 3),
    };
  });

  res.json({ events });
});

router.get('/events/:id', (req, res) => {
  const snap = snapshot(req);
  const event = snap.events.find((e) => e.eventId === req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const entrants = snap.participants
    .map((p) => decorate(p, snap))
    .filter((r) => r.events.includes(event.eventId));

  res.json({ event, participants: entrants });
});

/* ---------------------------------------------------------------- bouts -- */

/** Bout status is derived from its sheets, so the grid never goes stale. */
router.get('/bouts', (req, res) => {
  const snap = snapshot(req);
  const rows = snap.participants.map((p) => decorate(p, snap));

  const bouts = snap.bouts.map((b) => {
    const inBout = rows.filter((r) => r.boutIds.includes(b.boutId));
    const done = inBout.filter((r) => r.completed).length;
    const judge = snap.judges.find((j) => j.judgeId === b.judgeId && j.active !== false);
    const state =
      inBout.length === 0 ? 'empty' : done === inBout.length ? 'completed' : done > 0 ? 'in_progress' : 'waiting';

    return {
      boutId: b.boutId,
      boutName: b.boutName,
      eventId: b.eventId ?? null,
      eventName: snap.events.find((e) => e.eventId === b.eventId)?.name ?? null,
      ageCategoryName: snap.ages.find((a) => a.ageCategoryId === b.ageCategoryId)?.name ?? null,
      judge: judge ? { judgeId: judge.judgeId, judgeName: judge.judgeName } : null,
      participants: inBout.length,
      completed: done,
      completedPct: pct(done, inBout.length),
      state,
    };
  });

  res.json({ bouts });
});

router.get('/bouts/:id', (req, res) => {
  const snap = snapshot(req);
  const bout = snap.bouts.find((b) => b.boutId === req.params.id);
  if (!bout) return res.status(404).json({ error: 'Bout not found' });

  const inBout = snap.participants
    .map((p) => decorate(p, snap))
    .filter((r) => r.boutIds.includes(bout.boutId));
  res.json({ bout, participants: inBout });
});

/* --------------------------------------------------------------- judges -- */

router.get('/judges', (req, res) => {
  const snap = snapshot(req);

  const judges = snap.judges
    .filter((j) => j.active !== false)
    .map((j) => {
      const sheets = snap.scores.filter((s) => s.judgeId === j.judgeId);
      const held = j.boutIds ?? [];
      const assigned = held.reduce((n, id) => n + entriesForBout(id).length, 0);
      return {
        judgeId: j.judgeId,
        judgeName: j.judgeName,
        boutIds: held,
        boutName:
          held.map((id) => snap.bouts.find((b) => b.boutId === id)?.boutName ?? id).join(', ') || null,
        assigned,
        judged: sheets.length,
        completionPct: pct(sheets.length, assigned),
        averageScore: mean(sheets.map((s) => s.total)),
      };
    });

  res.json({ judges });
});

router.get('/judges/:id', (req, res) => {
  const snap = snapshot(req);
  const judge = snap.judges.find((j) => j.judgeId === req.params.id);
  if (!judge) return res.status(404).json({ error: 'Judge not found' });

  const sheets = snap.scores
    .filter((s) => s.judgeId === judge.judgeId)
    .map((s) => ({
      ...s,
      participantName:
        snap.participants.find((p) => p.participantId === s.participantId)?.participantName ?? s.participantId,
      positionName: snap.positions.find((x) => x.positionId === s.positionId)?.positionName ?? null,
    }));

  res.json({ judge, sheets });
});

/* --------------------------------------------------- filtered list view -- */

/**
 * The filtered list behind the admin's list view and its CSV export. Every
 * filter is optional and they combine; `completion` accepts completed|waiting.
 */
router.get('/participants', (req, res) => {
  const snap = snapshot(req);
  const { eventId, ageCategoryId, boutId, judgeId, completion, q } = req.query;

  let rows = snap.participants.map((p) => decorate(p, snap));

  if (eventId) rows = rows.filter((r) => r.events.includes(eventId));
  if (ageCategoryId) rows = rows.filter((r) => r.ageCategoryId === ageCategoryId);
  if (boutId) {
    rows = rows.filter((r) =>
      boutId === 'none' ? r.boutIds.length === 0 : r.boutIds.includes(boutId)
    );
  }
  if (judgeId) rows = rows.filter((r) => r.judgeId === judgeId);
  if (completion === 'completed') rows = rows.filter((r) => r.completed);
  if (completion === 'waiting') rows = rows.filter((r) => !r.completed);
  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter(
      (r) =>
        r.participantName.toLowerCase().includes(needle) ||
        r.participantId.toLowerCase().includes(needle)
    );
  }

  res.json({ participants: rows, count: rows.length });
});

/** Drill-down: every sheet filed on this participant, by any judge. */
router.get('/participants/:id', (req, res) => {
  const snap = snapshot(req);
  const participant = snap.participants.find((p) => p.participantId === req.params.id);
  if (!participant) return res.status(404).json({ error: 'Participant not found' });

  const history = snap.scores
    .filter((s) => s.participantId === participant.participantId)
    .map((s) => ({
      scoreId: s.scoreId,
      boutId: s.boutId,
      boutName: snap.bouts.find((b) => b.boutId === s.boutId)?.boutName ?? s.boutId,
      judgeId: s.judgeId,
      judgeName: snap.judges.find((j) => j.judgeId === s.judgeId)?.judgeName ?? s.judgeId,
      scores: s.scores,
      total: s.total,
      positionName: snap.positions.find((x) => x.positionId === s.positionId)?.positionName ?? null,
      createdAt: s.createdAt,
    }));

  res.json({
    participant: { ...participant, ...decorate(participant, snap) },
    events: participant.events.map((id) => snap.events.find((e) => e.eventId === id) ?? { eventId: id }),
    categories: db.filter('ScoreCategory', (c) => c.active !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    history,
  });
});

export default router;
