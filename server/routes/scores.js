import { Router } from 'express';
import * as db from '../lib/store.js';
import { requireAuth } from '../lib/auth.js';
import { config, requireModule } from '../config.js';
import { statusFor } from '../lib/queue.js';
import { currentTournamentId } from '../lib/tournament.js';

const router = Router();

router.use(requireModule('scoring'));

/** Categories and positions for the scoring screen, capped per config. */
router.get('/meta', requireAuth('JUDGE', 'ADMIN', 'SUPER_ADMIN'), (_req, res) => {
  const { maxCategories, minScore, maxScore } = config().scoring;
  const categories = db
    .filter('ScoreCategory', (c) => c.active !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .slice(0, maxCategories);
  const positions = db.all('PositionMaster').sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  res.json({ categories, positions, range: { minScore, maxScore } });
});

/** The judge's own score sheet for one participant, or null if not yet scored. */
router.get('/participant/:participantId', requireAuth('JUDGE'), (req, res) => {
  const boutId = req.query.boutId;
  const score = db.find(
    'Scores',
    (s) =>
      s.judgeId === req.user.refId &&
      s.participantId === req.params.participantId &&
      (!boutId || s.boutId === boutId)
  );
  res.json({ score: score ?? null });
});

/**
 * Records (or revises) one judge's scores for one participant.
 *
 * Guarded three ways: the participant must sit in the judge's own assigned
 * bout, every category must be a known active one within the configured range,
 * and the position must exist in Position Master. Re-submitting updates the
 * judge's existing sheet rather than adding a second one.
 */
router.post('/', requireAuth('JUDGE'), (req, res) => {
  const { maxCategories, minScore, maxScore } = config().scoring;

  const judge = db.find('Judges', (j) => j.judgeId === req.user.refId);
  const held = judge?.boutIds ?? [];
  if (held.length === 0) {
    return res.status(403).json({ error: 'You have no bout assigned yet' });
  }

  const participantId = String(req.body?.participantId ?? '').trim();
  const participant = db.find('Participants', (p) => p.participantId === participantId);
  if (!participant) return res.status(404).json({ error: 'Participant not found' });
  // The bout is named by the request when a judge holds more than one.
  const boutId = String(req.body?.boutId ?? '').trim() || held[0];
  if (!held.includes(boutId)) {
    return res.status(403).json({ error: 'That bout is not assigned to you' });
  }

  const entry = db.find(
    'BoutEntries',
    (e) => e.boutId === boutId && e.participantId === participantId
  );
  if (!entry) {
    return res.status(403).json({ error: 'That participant is not in that bout' });
  }

  // The UI disables a blocked row; this stops a stale page from scoring anyway.
  if (statusFor(participantId, boutId) === 'blocked') {
    return res.status(409).json({
      error: `${participant.participantName} is in another performance. You can score them once that bout has finished with them.`,
    });
  }

  const positionId = String(req.body?.positionId ?? '').trim();
  const position = db.find('PositionMaster', (p) => p.positionId === positionId);
  if (!position) return res.status(400).json({ errors: { positionId: 'Select a position' } });

  const allowed = db
    .filter('ScoreCategory', (c) => c.active !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .slice(0, maxCategories);

  const submitted = req.body?.scores ?? {};
  const errors = {};
  const scores = {};

  for (const category of allowed) {
    const raw = submitted[category.categoryId];
    const n = Number(raw);
    if (raw === '' || raw == null || Number.isNaN(n)) {
      errors[category.categoryId] = `${category.categoryName} is required`;
    } else if (n < minScore || n > maxScore) {
      errors[category.categoryId] = `${category.categoryName} must be between ${minScore} and ${maxScore}`;
    } else {
      scores[category.categoryId] = n;
    }
  }

  const unknown = Object.keys(submitted).filter(
    (id) => !allowed.some((c) => c.categoryId === id)
  );
  if (unknown.length) errors.scores = `Unknown score category: ${unknown.join(', ')}`;

  if (Object.keys(errors).length) return res.status(400).json({ errors });

  const total = Object.values(scores).reduce((sum, n) => sum + n, 0);
  const now = new Date().toISOString();
  // Keyed by bout as well as judge: one judge may score the same competitor in
  // two different bouts, and those are separate sheets.
  const existing = db.find(
    'Scores',
    (s) => s.judgeId === judge.judgeId && s.participantId === participantId && s.boutId === boutId
  );

  const record = existing
    ? db.update(
        'Scores',
        (s) => s.judgeId === judge.judgeId && s.participantId === participantId && s.boutId === boutId,
        { scores, positionId, total }
      )
    : db.insert('Scores', {
        scoreId: db.nextId('Scores', 'scoreId', 'SCORE'),
        tournamentId: db.find('BoutMaster', (b) => b.boutId === boutId)?.tournamentId ?? currentTournamentId(),
        judgeId: judge.judgeId,
        boutId,
        participantId,
        scores,
        positionId,
        total,
        createdAt: now,
      });

  res.status(existing ? 200 : 201).json({ score: record, revised: Boolean(existing) });
});

export default router;
