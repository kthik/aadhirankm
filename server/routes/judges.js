import { Router } from 'express';
import * as db from '../lib/store.js';
import { validate } from '../lib/validate.js';
import { hashPassword, requireAuth } from '../lib/auth.js';
import { config, requireModule } from '../config.js';
import { entriesForBout, rosterFor } from '../lib/queue.js';
import { currentTournamentId, inScope, scopeFor } from '../lib/tournament.js';

const router = Router();

const JUDGE_RULES = {
  judgeName: { required: true, min: 3, label: 'Judge name' },
  academyName: { required: true, min: 3, label: 'Academy name' },
  location: { required: true, label: 'Location' },
  address: { required: true, min: 5, label: 'Address' },
  mobile: { required: true, type: 'phone', label: 'Mobile number' },
};

// Judging is admin-owned throughout; every route below is module-gated.
router.use(requireModule('judging'));

const staff = requireAuth('ADMIN', 'SUPER_ADMIN');

/** Accepts the boutIds list, or a single boutId from an older caller. */
function requestedBouts(body) {
  if (Array.isArray(body?.boutIds)) return [...new Set(body.boutIds.filter(Boolean))];
  return body?.boutId ? [body.boutId] : [];
}

/**
 * A bout still belongs to exactly one judge, even though a judge may hold
 * several. Returns the requested bouts that someone else already holds, so the
 * caller can raise the confirmation alert.
 */
function conflictsFor(boutIds, exceptJudgeId = null) {
  return boutIds
    .map((boutId) => {
      const bout = db.find('BoutMaster', (b) => b.boutId === boutId);
      if (!bout?.judgeId || bout.judgeId === exceptJudgeId) return null;
      const holder = db.find('Judges', (j) => j.judgeId === bout.judgeId && j.active !== false);
      return holder
        ? { boutId, boutName: bout.boutName, judgeId: holder.judgeId, judgeName: holder.judgeName }
        : null;
    })
    .filter(Boolean);
}

/**
 * Sets the exact set of bouts a judge holds: releases the ones they are giving
 * up, takes the rest off whoever held them, and never leaves a bout held twice.
 */
function claimBouts(judgeId, boutIds) {
  const previous = db.find('Judges', (j) => j.judgeId === judgeId)?.boutIds ?? [];

  for (const boutId of previous.filter((id) => !boutIds.includes(id))) {
    db.update('BoutMaster', (b) => b.boutId === boutId && b.judgeId === judgeId, { judgeId: null });
  }

  for (const boutId of boutIds) {
    const bout = db.find('BoutMaster', (b) => b.boutId === boutId);
    if (bout?.judgeId && bout.judgeId !== judgeId) {
      const holder = db.find('Judges', (j) => j.judgeId === bout.judgeId);
      if (holder) {
        db.update('Judges', (j) => j.judgeId === holder.judgeId, {
          boutIds: (holder.boutIds ?? []).filter((id) => id !== boutId),
        });
      }
    }
    db.update('BoutMaster', (b) => b.boutId === boutId, { judgeId });
  }

  db.update('Judges', (j) => j.judgeId === judgeId, { boutIds });
}

/**
 * A bout is finished once every competitor in it has been scored. An empty
 * bout is not finished — nobody has performed in it.
 */
function boutIsComplete(boutId, scores = db.all('Scores')) {
  const entries = entriesForBout(boutId);
  if (entries.length === 0) return false;
  return entries.every((e) =>
    scores.some((s) => s.boutId === boutId && s.participantId === e.participantId)
  );
}

/**
 * Hands a judge's unfinished bouts back to the pool when they leave.
 *
 * Bouts they already finished keep their name on them — that is the record of
 * who scored those results. Anything still in progress or not started becomes
 * unassigned so an admin can give it to someone else.
 */
function releaseUnfinishedBouts(judge) {
  const scores = db.all('Scores');
  const held = judge.boutIds ?? [];
  const released = [];
  const kept = [];

  for (const boutId of held) {
    if (boutIsComplete(boutId, scores)) {
      kept.push(boutId);
    } else {
      db.update('BoutMaster', (b) => b.boutId === boutId && b.judgeId === judge.judgeId, {
        judgeId: null,
      });
      released.push(db.find('BoutMaster', (b) => b.boutId === boutId)?.boutName ?? boutId);
    }
  }

  db.update('Judges', (j) => j.judgeId === judge.judgeId, { boutIds: kept });
  return { released, kept };
}

function decorateJudge(j, bouts) {
  const held = (j.boutIds ?? []).map((id) => bouts.find((b) => b.boutId === id)).filter(Boolean);
  return {
    ...j,
    boutIds: j.boutIds ?? [],
    boutNames: held.map((b) => b.boutName),
    active: j.active !== false,
    participantCount: held.reduce((n, b) => n + entriesForBout(b.boutId).length, 0),
    sheetCount: db.filter('Scores', (s) => s.judgeId === j.judgeId).length,
  };
}

/** Bouts with the judge currently holding each one, for the assignment picker. */
router.get('/bouts', staff, (req, res) => {
  const scope = scopeFor(req.user);
  const judges = db.all('Judges');
  const events = db.all('EventMaster');
  const bouts = db.filter('BoutMaster', (b) => inScope(b, scope)).map((b) => {
    const judge = judges.find((j) => j.judgeId === b.judgeId && j.active !== false);
    return {
      ...b,
      eventName: events.find((e) => e.eventId === b.eventId)?.name ?? null,
      assignedTo: judge ? { judgeId: judge.judgeId, judgeName: judge.judgeName } : null,
      participantCount: entriesForBout(b.boutId).length,
    };
  });
  res.json({ bouts });
});

router.get('/', staff, (req, res) => {
  const scope = scopeFor(req.user);
  const bouts = db.all('BoutMaster');
  res.json({
    judges: db.filter('Judges', (j) => inScope(j, scope)).map((j) => decorateJudge(j, bouts)),
  });
});

/**
 * The judge dashboard payload: one section per bout they hold, each with its
 * own running order and progress, since a bout is scored one event at a time.
 */
router.get('/me', requireAuth('JUDGE'), (req, res) => {
  const judge = db.find('Judges', (j) => j.judgeId === req.user.refId);
  if (!judge) return res.status(404).json({ error: 'Judge record not found' });

  const positions = db.all('PositionMaster');
  const ranked = new Set(positions.filter((p) => p.ranking).map((p) => p.positionId));

  const bouts = (judge.boutIds ?? [])
    .map((id) => db.find('BoutMaster', (b) => b.boutId === id))
    .filter(Boolean)
    .map((bout) => {
      const event = bout.eventId ? db.find('EventMaster', (e) => e.eventId === bout.eventId) : null;
      const participants = rosterFor(bout);

      const total = participants.length;
      const completed = participants.filter((p) => p.scored).length;
      const closed = participants.filter((p) => ranked.has(p.positionId)).length;
      const pct = (n) => (total === 0 ? 0 : Math.round((n / total) * 100));

      return {
        bout: { ...bout, eventName: event?.name ?? null },
        participants,
        progress: {
          total,
          completed,
          pending: total - completed,
          blocked: participants.filter((p) => p.status === 'blocked').length,
          completedPct: pct(completed),
          podiumClosed: closed,
          podiumClosedPct: pct(closed),
        },
      };
    });

  const totals = bouts.reduce(
    (acc, b) => ({
      total: acc.total + b.progress.total,
      completed: acc.completed + b.progress.completed,
      blocked: acc.blocked + b.progress.blocked,
    }),
    { total: 0, completed: 0, blocked: 0 }
  );

  res.json({
    judge: { ...judge, boutIds: judge.boutIds ?? [] },
    bouts,
    totals: {
      ...totals,
      completedPct: totals.total === 0 ? 0 : Math.round((totals.completed / totals.total) * 100),
    },
  });
});

/** Full detail for the admin's judge drawer. */
router.get('/:judgeId', staff, (req, res) => {
  const judge = db.find('Judges', (j) => j.judgeId === req.params.judgeId);
  if (!judge) return res.status(404).json({ error: 'Judge not found' });

  const bouts = db.all('BoutMaster');
  const events = db.all('EventMaster');
  const positions = db.all('PositionMaster');
  const participants = db.all('Participants');

  const sheets = db
    .filter('Scores', (s) => s.judgeId === judge.judgeId)
    .map((s) => ({
      scoreId: s.scoreId,
      participantId: s.participantId,
      participantName:
        participants.find((p) => p.participantId === s.participantId)?.participantName ?? s.participantId,
      boutName: bouts.find((b) => b.boutId === s.boutId)?.boutName ?? s.boutId,
      total: s.total,
      positionName: positions.find((x) => x.positionId === s.positionId)?.positionName ?? null,
      createdAt: s.createdAt,
    }));

  res.json({
    judge: decorateJudge(judge, bouts),
    bouts: (judge.boutIds ?? []).map((id) => {
      const b = bouts.find((x) => x.boutId === id);
      return b
        ? {
            ...b,
            eventName: events.find((e) => e.eventId === b.eventId)?.name ?? null,
            participantCount: entriesForBout(b.boutId).length,
          }
        : { boutId: id, boutName: id };
    }),
    sheets,
  });
});

/**
 * Creates a judge and assigns their bouts.
 *
 * Any requested bout already held by someone else is refused with 409 and
 * `requiresConfirmation` for the admin's alert; re-posting with
 * `confirmReassign: true` releases the previous holders and reassigns.
 */
router.post('/', staff, (req, res) => {
  const { ok, values, errors } = validate(req.body, JUDGE_RULES);
  const boutIds = requestedBouts(req.body);

  if (boutIds.length === 0) errors.boutIds = 'Assign at least one bout';
  const unknown = boutIds.filter((id) => !db.find('BoutMaster', (b) => b.boutId === id));
  if (unknown.length) errors.boutIds = `Unknown bout(s): ${unknown.join(', ')}`;

  if (!ok || Object.keys(errors).length) return res.status(400).json({ errors });

  const conflicts = conflictsFor(boutIds);
  if (conflicts.length && req.body?.confirmReassign !== true) {
    return res.status(409).json({
      error: `${conflicts.map((c) => `${c.boutName} is held by ${c.judgeName}`).join('; ')}. Confirm to reassign.`,
      requiresConfirmation: true,
      conflicts,
    });
  }

  const judgeId = db.nextId('Judges', 'judgeId', 'JUDGE');
  const createdAt = new Date().toISOString();
  db.insert('Judges', {
    judgeId,
    ...values,
    tournamentId: currentTournamentId(),
    boutIds: [],
    active: true,
    createdAt,
  });
  claimBouts(judgeId, boutIds);

  const defaultPassword = config().app.defaultPassword;
  db.insert('LoginMaster', {
    uid: judgeId,
    password: hashPassword(defaultPassword),
    role: 'JUDGE',
    refId: judgeId,
    name: values.judgeName,
    active: true,
    createdAt,
  });

  res.status(201).json({
    judge: decorateJudge(db.find('Judges', (j) => j.judgeId === judgeId), db.all('BoutMaster')),
    conflicts,
    credentials: { uid: judgeId, password: defaultPassword },
  });
});

/** Admin edit: judge details and the exact set of bouts they hold. */
router.put('/:judgeId', staff, (req, res) => {
  const judge = db.find('Judges', (j) => j.judgeId === req.params.judgeId);
  if (!judge) return res.status(404).json({ error: 'Judge not found' });

  const merged = {
    ...Object.fromEntries(Object.entries(judge).filter(([k]) => k in JUDGE_RULES)),
    ...Object.fromEntries(
      Object.entries(req.body ?? {}).filter(([k, v]) => k in JUDGE_RULES && v !== '' && v != null)
    ),
  };
  const { ok, values, errors } = validate(merged, JUDGE_RULES);
  if (!ok) return res.status(400).json({ errors });

  const asked = 'boutIds' in (req.body ?? {}) || 'boutId' in (req.body ?? {});
  const boutIds = asked ? requestedBouts(req.body) : judge.boutIds ?? [];

  const unknown = boutIds.filter((id) => !db.find('BoutMaster', (b) => b.boutId === id));
  if (unknown.length) {
    return res.status(400).json({ errors: { boutIds: `Unknown bout(s): ${unknown.join(', ')}` } });
  }

  const conflicts = conflictsFor(boutIds, judge.judgeId);
  if (conflicts.length && req.body?.confirmReassign !== true) {
    return res.status(409).json({
      error: `${conflicts.map((c) => `${c.boutName} is held by ${c.judgeName}`).join('; ')}. Confirm to reassign.`,
      requiresConfirmation: true,
      conflicts,
    });
  }

  db.update('Judges', (j) => j.judgeId === judge.judgeId, values);
  claimBouts(judge.judgeId, boutIds);
  db.update('LoginMaster', (l) => l.uid === judge.judgeId, { name: values.judgeName });

  res.json({
    judge: decorateJudge(db.find('Judges', (j) => j.judgeId === judge.judgeId), db.all('BoutMaster')),
    conflicts,
  });
});

/**
 * Deactivates or reactivates a judge. Deactivating blocks their sign-in and
 * releases their unfinished bouts; reactivating restores the sign-in but not
 * the bouts, since those may already belong to someone else.
 */
router.patch('/:judgeId', staff, (req, res) => {
  const judge = db.find('Judges', (j) => j.judgeId === req.params.judgeId);
  if (!judge) return res.status(404).json({ error: 'Judge not found' });

  if (typeof req.body?.active !== 'boolean') {
    return res.status(400).json({ error: 'Pass active: true or false' });
  }

  const active = req.body.active;
  let released = [];

  if (!active) {
    ({ released } = releaseUnfinishedBouts(judge));
  }

  db.update('Judges', (j) => j.judgeId === judge.judgeId, { active });
  db.update('LoginMaster', (l) => l.uid === judge.judgeId, { active });

  res.json({
    judge: decorateJudge(db.find('Judges', (j) => j.judgeId === judge.judgeId), db.all('BoutMaster')),
    released,
  });
});

/**
 * Deletes a judge and their sign-in, releasing unfinished bouts first.
 *
 * Sheets they already filed are left alone: deleting the judge must not delete
 * competitors' results. A finished bout keeps their id so the record still says
 * who scored it, which is why the judge row itself is only removed once its
 * unfinished work is handed back.
 */
router.delete('/:judgeId', staff, (req, res) => {
  const judge = db.find('Judges', (j) => j.judgeId === req.params.judgeId);
  if (!judge) return res.status(404).json({ error: 'Judge not found' });

  const { released, kept } = releaseUnfinishedBouts(judge);

  if (kept.length > 0 && req.query.force !== 'true') {
    return res.status(409).json({
      error: `${judge.judgeName} has finished ${kept.length} bout(s); those results stay on record under their name. Confirm to delete the judge anyway.`,
      requiresConfirmation: true,
      released,
      keptBouts: kept.map((id) => db.find('BoutMaster', (b) => b.boutId === id)?.boutName ?? id),
    });
  }

  db.remove('Judges', (j) => j.judgeId === judge.judgeId);
  db.remove('LoginMaster', (l) => l.uid === judge.judgeId);

  res.json({ deleted: judge.judgeId, released });
});

export default router;
