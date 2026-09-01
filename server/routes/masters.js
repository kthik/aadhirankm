import { Router } from 'express';
import * as db from '../lib/store.js';
import { validate } from '../lib/validate.js';
import { requireAuth } from '../lib/auth.js';
import { config, requireModule } from '../config.js';
import { boutIdsFor, entriesForBout } from '../lib/queue.js';
import { currentTournamentId } from '../lib/tournament.js';

const router = Router();

const staff = requireAuth('ADMIN', 'SUPER_ADMIN');

/* ------------------------------------------------------------------ age -- */

/**
 * Age categories are ranges rather than a field on the participant, so a
 * participant's category is derived from their age at read time. Editing a
 * range therefore re-categorises everyone automatically.
 */
router.get('/age-categories', requireAuth(), (_req, res) => {
  const ageCategories = db
    .all('AgeCategory')
    .sort((a, b) => a.minAge - b.minAge);
  res.json({ ageCategories });
});

/** Everyone whose age falls in this band, for the category drill-down. */
router.get('/age-categories/:id/participants', requireAuth(), (req, res) => {
  const band = db.find('AgeCategory', (c) => c.ageCategoryId === req.params.id);
  if (!band) return res.status(404).json({ error: 'Age category not found' });

  const events = db.all('EventMaster');
  const bouts = db.all('BoutMaster');
  const scores = db.all('Scores');
  const academies = db.all('Academy');

  const members = db
    .filter('Participants', (p) => p.age >= band.minAge && p.age <= band.maxAge)
    .map((p) => ({
      participantId: p.participantId,
      participantName: p.participantName,
      age: p.age,
      location: p.location,
      academyName: academies.find((a) => a.academyId === p.academyId)?.academyName ?? 'Individual',
      eventNames: p.events.map((id) => events.find((e) => e.eventId === id)?.name ?? id),
      boutNames: boutIdsFor(p.participantId).map(
        (id) => bouts.find((b) => b.boutId === id)?.boutName ?? id
      ),
      completed: scores.some((s) => s.participantId === p.participantId),
    }));

  res.json({
    ageCategory: band,
    participants: members,
    stats: {
      participants: members.length,
      assigned: members.filter((m) => m.boutNames.length > 0).length,
      completed: members.filter((m) => m.completed).length,
      eventEntries: members.reduce((n, m) => n + m.eventNames.length, 0),
    },
  });
});

router.post('/age-categories', staff, (req, res) => {
  const { ok, values, errors } = validate(req.body, {
    name: { required: true, min: 3, label: 'Category name' },
    minAge: { required: true, type: 'age', label: 'Minimum age' },
    maxAge: { required: true, type: 'age', label: 'Maximum age' },
  });
  if (!ok) return res.status(400).json({ errors });

  if (values.minAge > values.maxAge) {
    return res.status(400).json({ errors: { maxAge: 'Maximum age must not be below the minimum' } });
  }

  const overlap = db.find(
    'AgeCategory',
    (c) => c.active !== false && values.minAge <= c.maxAge && values.maxAge >= c.minAge
  );
  if (overlap) {
    return res.status(409).json({
      errors: { minAge: `Overlaps ${overlap.name} (${overlap.minAge}-${overlap.maxAge})` },
    });
  }

  const ageCategory = {
    ageCategoryId: db.nextId('AgeCategory', 'ageCategoryId', 'AGE_CATEGORY'),
    ...values,
    active: true,
    createdAt: new Date().toISOString(),
  };
  db.insert('AgeCategory', ageCategory);
  res.status(201).json({ ageCategory });
});

router.patch('/age-categories/:id', staff, (req, res) => {
  const patch = {};
  if (typeof req.body?.active === 'boolean') patch.active = req.body.active;
  if (typeof req.body?.name === 'string' && req.body.name.trim()) patch.name = req.body.name.trim();
  for (const f of ['minAge', 'maxAge']) {
    if (req.body?.[f] != null && Number.isInteger(Number(req.body[f]))) patch[f] = Number(req.body[f]);
  }
  const ageCategory = db.update('AgeCategory', (c) => c.ageCategoryId === req.params.id, patch);
  if (!ageCategory) return res.status(404).json({ error: 'Age category not found' });
  res.json({ ageCategory });
});

/* ---------------------------------------------------------------- score -- */

router.get('/score-categories', requireAuth(), (_req, res) => {
  const scoreCategories = db
    .all('ScoreCategory')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  res.json({ scoreCategories, maxCategories: config().scoring.maxCategories });
});

/** The scoring screen renders one input per active category, so the cap is enforced here. */
router.post('/score-categories', staff, (req, res) => {
  const { ok, values, errors } = validate(req.body, {
    categoryName: { required: true, min: 3, label: 'Category name' },
  });
  if (!ok) return res.status(400).json({ errors });

  const { maxCategories } = config().scoring;
  const active = db.filter('ScoreCategory', (c) => c.active !== false);
  if (active.length >= maxCategories) {
    return res.status(409).json({
      error: `Scoring is limited to ${maxCategories} categories. Deactivate one before adding another.`,
    });
  }
  if (active.some((c) => c.categoryName.toLowerCase() === values.categoryName.toLowerCase())) {
    return res.status(409).json({ errors: { categoryName: 'That category already exists' } });
  }

  const scoreCategory = {
    categoryId: db.nextId('ScoreCategory', 'categoryId', 'SCORE_CATEGORY'),
    ...values,
    order: db.all('ScoreCategory').reduce((n, c) => Math.max(n, c.order ?? 0), 0) + 1,
    active: true,
    createdAt: new Date().toISOString(),
  };
  db.insert('ScoreCategory', scoreCategory);
  res.status(201).json({ scoreCategory });
});

router.patch('/score-categories/:id', staff, (req, res) => {
  const patch = {};
  if (typeof req.body?.active === 'boolean') {
    const { maxCategories } = config().scoring;
    const active = db.filter('ScoreCategory', (c) => c.active !== false).length;
    if (req.body.active && active >= maxCategories) {
      return res.status(409).json({ error: `Scoring is limited to ${maxCategories} categories.` });
    }
    patch.active = req.body.active;
  }
  if (typeof req.body?.categoryName === 'string' && req.body.categoryName.trim()) {
    patch.categoryName = req.body.categoryName.trim();
  }
  const scoreCategory = db.update('ScoreCategory', (c) => c.categoryId === req.params.id, patch);
  if (!scoreCategory) return res.status(404).json({ error: 'Score category not found' });
  res.json({ scoreCategory });
});

/* ----------------------------------------------------------------- bout -- */

router.get('/bouts', staff, requireModule('judging'), (_req, res) => {
  const judges = db.all('Judges');
  const events = db.all('EventMaster');
  const ages = db.all('AgeCategory');

  const bouts = db.all('BoutMaster').map((b) => ({
    ...b,
    eventName: events.find((e) => e.eventId === b.eventId)?.name ?? null,
    ageCategoryName: ages.find((a) => a.ageCategoryId === b.ageCategoryId)?.name ?? null,
    assignedTo: (() => {
      const j = judges.find((x) => x.judgeId === b.judgeId && x.active !== false);
      return j ? { judgeId: j.judgeId, judgeName: j.judgeName } : null;
    })(),
    participantCount: entriesForBout(b.boutId).length,
  }));
  res.json({ bouts });
});

/**
 * Creates a bout. Event and age category are optional filters that drive the
 * eligible-participants list below; a bout with neither simply accepts anyone.
 */
router.post('/bouts', staff, requireModule('judging'), (req, res) => {
  const { ok, values, errors } = validate(req.body, {
    boutName: { required: true, min: 3, label: 'Bout name' },
    eventId: { required: false, label: 'Event' },
    ageCategoryId: { required: false, label: 'Age category' },
  });
  if (!ok) return res.status(400).json({ errors });

  if (values.eventId && !db.find('EventMaster', (e) => e.eventId === values.eventId)) {
    return res.status(400).json({ errors: { eventId: 'Unknown event' } });
  }
  if (values.ageCategoryId && !db.find('AgeCategory', (c) => c.ageCategoryId === values.ageCategoryId)) {
    return res.status(400).json({ errors: { ageCategoryId: 'Unknown age category' } });
  }

  const bout = {
    boutId: db.nextId('BoutMaster', 'boutId', 'BOUT'),
    tournamentId: currentTournamentId(),
    boutName: values.boutName,
    eventId: values.eventId,
    ageCategoryId: values.ageCategoryId,
    status: 'open',
    judgeId: null,
    createdAt: new Date().toISOString(),
  };
  db.insert('BoutMaster', bout);
  res.status(201).json({ bout });
});

router.patch('/bouts/:id', staff, requireModule('judging'), (req, res) => {
  const patch = {};
  if (typeof req.body?.boutName === 'string' && req.body.boutName.trim()) {
    patch.boutName = req.body.boutName.trim();
  }
  if (['open', 'in_progress', 'closed'].includes(req.body?.status)) patch.status = req.body.status;
  for (const f of ['eventId', 'ageCategoryId']) {
    if (f in (req.body ?? {})) patch[f] = req.body[f] || null;
  }
  const bout = db.update('BoutMaster', (b) => b.boutId === req.params.id, patch);
  if (!bout) return res.status(404).json({ error: 'Bout not found' });
  res.json({ bout });
});

/**
 * Participants who match this bout's event and age range and are not already
 * in another bout - the categorisation step before assignment.
 */
router.get('/bouts/:id/eligible', staff, requireModule('judging'), (req, res) => {
  const bout = db.find('BoutMaster', (b) => b.boutId === req.params.id);
  if (!bout) return res.status(404).json({ error: 'Bout not found' });

  const age = bout.ageCategoryId
    ? db.find('AgeCategory', (c) => c.ageCategoryId === bout.ageCategoryId)
    : null;

  // Being in another bout no longer excludes anyone: a participant entered in
  // several events belongs in a bout for each. Only this bout's own entrants
  // are filtered out, since they are already in.
  const eligible = db.filter('Participants', (p) => {
    if (boutIdsFor(p.participantId).includes(bout.boutId)) return false;
    if (bout.eventId && !p.events.includes(bout.eventId)) return false;
    if (age && (p.age < age.minAge || p.age > age.maxAge)) return false;
    return true;
  });

  res.json({ bout, eligible });
});

export default router;
