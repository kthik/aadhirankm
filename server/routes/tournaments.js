import { Router } from 'express';
import * as db from '../lib/store.js';
import { validate } from '../lib/validate.js';
import { requireAuth } from '../lib/auth.js';
import { requireModule } from '../config.js';
import { log } from '../lib/audit.js';
import { SCOPED, autoDeactivateExpired, isRunning, scopeFor } from '../lib/tournament.js';

const router = Router();

router.use(requireModule('tournaments'));

const superOnly = requireAuth('SUPER_ADMIN');

const RULES = {
  name: { required: true, min: 3, label: 'Tournament name' },
  description: { required: false, label: 'Description', default: '' },
  location: { required: false, label: 'Location', default: '' },
  startDate: { required: true, label: 'Start date' },
  endDate: { required: false, label: 'End date', default: '' },
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkDates(values) {
  const errors = {};
  if (!DATE.test(values.startDate)) errors.startDate = 'Use a YYYY-MM-DD date';
  if (values.endDate && !DATE.test(values.endDate)) errors.endDate = 'Use a YYYY-MM-DD date';
  if (!errors.startDate && !errors.endDate && values.endDate && values.endDate < values.startDate) {
    errors.endDate = 'End date must not be before the start date';
  }
  return errors;
}

/** Row counts per tournament, so the list shows what each one holds. */
function withCounts(t) {
  const counts = Object.fromEntries(
    SCOPED.map((name) => [name, db.filter(name, (r) => r.tournamentId === t.tournamentId).length])
  );
  return {
    ...t,
    running: isRunning(t),
    counts,
    records: Object.values(counts).reduce((a, b) => a + b, 0),
  };
}

/**
 * Everyone signed in can read the tournament list — the dashboards label data
 * with it — but only Super Admin may change one.
 */
router.get('/', requireAuth(), (req, res) => {
  autoDeactivateExpired();

  const scope = scopeFor(req.user);
  const tournaments = db
    .all('Tournaments')
    .filter((t) => !scope || scope.includes(t.tournamentId))
    .map(withCounts)
    .sort((a, b) => String(b.startDate ?? '').localeCompare(String(a.startDate ?? '')));

  res.json({ tournaments, scoped: Boolean(scope) });
});

router.post('/', superOnly, (req, res) => {
  const { ok, values, errors } = validate(req.body, RULES);
  const dateErrors = checkDates(values);
  if (!ok || Object.keys(dateErrors).length) {
    return res.status(400).json({ errors: { ...errors, ...dateErrors } });
  }

  const tournament = {
    tournamentId: db.nextId('Tournaments', 'tournamentId', 'TOURNAMENT'),
    ...values,
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  db.insert('Tournaments', tournament);
  log(req, 'tournament.create', { tournamentId: tournament.tournamentId, name: tournament.name });

  res.status(201).json({ tournament: withCounts(tournament) });
});

router.put('/:tournamentId', superOnly, (req, res) => {
  const existing = db.find('Tournaments', (t) => t.tournamentId === req.params.tournamentId);
  if (!existing) return res.status(404).json({ error: 'Tournament not found' });

  const merged = {
    ...Object.fromEntries(Object.entries(existing).filter(([k]) => k in RULES)),
    ...Object.fromEntries(
      Object.entries(req.body ?? {}).filter(([k, v]) => k in RULES && v != null)
    ),
  };
  const { ok, values, errors } = validate(merged, RULES);
  const dateErrors = checkDates(values);
  if (!ok || Object.keys(dateErrors).length) {
    return res.status(400).json({ errors: { ...errors, ...dateErrors } });
  }

  const tournament = db.update('Tournaments', (t) => t.tournamentId === existing.tournamentId, values);
  log(req, 'tournament.update', { tournamentId: existing.tournamentId });
  res.json({ tournament: withCounts(tournament) });
});

/**
 * Manual on/off. Switching one on past its end date is refused rather than
 * silently undone by the auto-deactivation pass on the next boot.
 */
router.patch('/:tournamentId/status', superOnly, (req, res) => {
  const tournament = db.find('Tournaments', (t) => t.tournamentId === req.params.tournamentId);
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

  const status = req.body?.status;
  if (status !== 'active' && status !== 'inactive') {
    return res.status(400).json({ error: 'Status must be active or inactive' });
  }

  const on = new Date().toISOString().slice(0, 10);
  if (status === 'active' && tournament.endDate && on > tournament.endDate) {
    return res.status(409).json({
      error: `${tournament.name} ended on ${tournament.endDate}. Extend the end date before reactivating it, or it will switch off again automatically.`,
    });
  }

  const updated = db.update('Tournaments', (t) => t.tournamentId === tournament.tournamentId, {
    status,
    deactivatedAt: status === 'inactive' ? new Date().toISOString() : null,
    deactivatedBy: status === 'inactive' ? req.user.uid : null,
  });
  log(req, `tournament.${status === 'active' ? 'activate' : 'deactivate'}`, {
    tournamentId: tournament.tournamentId,
  });

  res.json({ tournament: withCounts(updated) });
});

/** Runs the expiry sweep on demand, for the dashboard's "check now" action. */
router.post('/auto-deactivate', superOnly, (req, res) => {
  const deactivated = autoDeactivateExpired();
  if (deactivated.length) log(req, 'tournament.autoDeactivate', { deactivated });
  res.json({ deactivated });
});

export default router;
