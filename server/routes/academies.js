import { Router } from 'express';
import * as db from '../lib/store.js';
import { validate } from '../lib/validate.js';
import { hashPassword, requireAuth, verifyPassword } from '../lib/auth.js';
import { config, requireModule } from '../config.js';
import { boutIdsFor } from '../lib/queue.js';
import { currentTournamentId, inScope, scopeFor } from '../lib/tournament.js';

const router = Router();

const ACADEMY_RULES = {
  academyName: { required: true, min: 3, label: 'Academy name' },
  coachName: { required: true, min: 3, label: 'Coach name' },
  phone: { required: true, type: 'phone', label: 'Phone number' },
  address: { required: true, min: 5, label: 'Address' },
  location: { required: true, label: 'Location' },
};

/**
 * Public academy sign-up. Creates the Academy row and its LoginMaster entry in
 * one step and hands back the generated UID + default password for the popup.
 */
router.post('/', requireModule('academyRegistration'), (req, res) => {
  const { ok, values, errors } = validate(req.body, ACADEMY_RULES);
  if (!ok) return res.status(400).json({ errors });

  const duplicate = db.find(
    'Academy',
    (a) =>
      a.phone === values.phone &&
      a.academyName.trim().toLowerCase() === values.academyName.toLowerCase()
  );
  if (duplicate) {
    return res.status(409).json({
      errors: { academyName: 'An academy with this name and phone number is already registered' },
    });
  }

  const academyId = db.nextId('Academy', 'academyId', 'ACADEMY');
  const academy = {
    academyId,
    ...values,
    tournamentId: currentTournamentId(),
    active: true,
    createdAt: new Date().toISOString(),
  };
  db.insert('Academy', academy);

  const defaultPassword = config().app.defaultPassword;
  db.insert('LoginMaster', {
    uid: academyId,
    password: hashPassword(defaultPassword),
    role: 'ACADEMY',
    refId: academyId,
    name: values.academyName,
    active: true,
    createdAt: academy.createdAt,
  });

  res.status(201).json({ academy, credentials: { uid: academyId, password: defaultPassword } });
});

router.get('/me', requireAuth('ACADEMY'), (req, res) => {
  const academy = db.find('Academy', (a) => a.academyId === req.user.refId);
  const roster = db.filter('Participants', (p) => p.academyId === req.user.refId);

  const events = db.all('EventMaster');
  const bouts = db.all('BoutMaster');
  const positions = db.all('PositionMaster');
  const ages = db.all('AgeCategory');
  const scores = db.all('Scores');
  const medals = db.all('Medals');

  const participants = roster.map((p) => {
    const sheets = scores.filter((s) => s.participantId === p.participantId);
    const band = ages.find(
      (c) => c.active !== false && p.age >= c.minAge && p.age <= c.maxAge
    );
    return {
      ...p,
      boutIds: boutIdsFor(p.participantId),
      boutNames: boutIdsFor(p.participantId).map(
        (id) => bouts.find((b) => b.boutId === id)?.boutName ?? id
      ),
      eventNames: p.events.map((id) => events.find((e) => e.eventId === id)?.name ?? id),
      ageCategoryName: band?.name ?? null,
      completed: sheets.length > 0,
      results: sheets.map((s) => ({
        boutName: bouts.find((b) => b.boutId === s.boutId)?.boutName ?? s.boutId,
        positionName: positions.find((x) => x.positionId === s.positionId)?.positionName ?? null,
        total: s.total,
      })),
      medals: medals.filter((m) => m.participantId === p.participantId).length,
    };
  });

  const ranking = new Set(positions.filter((x) => x.ranking).map((x) => x.positionName));
  const podium = participants.flatMap((p) =>
    p.results.filter((r) => ranking.has(r.positionName)).map((r) => ({ ...r, name: p.participantName }))
  );
  const totals = participants.flatMap((p) => p.results.map((r) => r.total));

  // Entries per event, so the academy sees where its squad is concentrated.
  const byEvent = events
    .filter((e) => e.active)
    .map((e) => {
      const entrants = participants.filter((p) => p.events.includes(e.eventId));
      return {
        eventId: e.eventId,
        name: e.name,
        entered: entrants.length,
        completed: entrants.filter((p) => p.completed).length,
      };
    })
    .filter((e) => e.entered > 0);

  res.json({
    academy,
    participants,
    byEvent,
    stats: {
      participants: participants.length,
      eventEntries: participants.reduce((n, p) => n + p.events.length, 0),
      assigned: participants.filter((p) => p.boutIds.length > 0).length,
      completed: participants.filter((p) => p.completed).length,
      medals: podium.length,
      averageScore:
        totals.length === 0
          ? null
          : Math.round((totals.reduce((a, b) => a + b, 0) / totals.length) * 10) / 10,
    },
    podium,
  });
});

router.get('/', requireAuth('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const scope = scopeFor(req.user);
  const academies = db.filter('Academy', (a) => inScope(a, scope)).map((a) => ({
    ...a,
    participantCount: db.filter('Participants', (p) => p.academyId === a.academyId).length,
  }));
  res.json({ academies });
});

/** Full detail for the admin's academy drawer. */
router.get('/:academyId', requireAuth('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const academy = db.find('Academy', (a) => a.academyId === req.params.academyId);
  if (!academy) return res.status(404).json({ error: 'Academy not found' });

  const events = db.all('EventMaster');
  const scores = db.all('Scores');
  const participants = db
    .filter('Participants', (p) => p.academyId === academy.academyId)
    .map((p) => ({
      ...p,
      eventNames: p.events.map((id) => events.find((e) => e.eventId === id)?.name ?? id),
      completed: scores.some((s) => s.participantId === p.participantId),
    }));

  // The sign-in record, minus the hash: an admin needs the UID to read it back
  // to a coach on the phone, and needs to see whether it is still the default.
  const login = db.find('LoginMaster', (l) => l.refId === academy.academyId && l.role === 'ACADEMY');
  const account = login
    ? {
        uid: login.uid,
        active: login.active !== false,
        lastLoginAt: login.lastLoginAt ?? null,
        usesDefaultPassword: verifyPassword(config().app.defaultPassword, login.password),
      }
    : null;

  const entered = participants.reduce((n, p) => n + p.events.length, 0);
  res.json({
    academy,
    account,
    participants,
    stats: {
      participants: participants.length,
      eventEntries: entered,
      completed: participants.filter((p) => p.completed).length,
    },
  });
});

/**
 * Admin password reset for an academy.
 *
 * Sends back the password that was set so the admin can read it out to the
 * coach. Passing no password resets to the configured default, which is the
 * usual case: a coach rings up locked out and the admin puts them back to
 * `pass@123` for them to change on the way in.
 *
 * The admin never sees the old password — it is only ever stored hashed.
 */
router.post('/:academyId/reset-password', requireAuth('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const academy = db.find('Academy', (a) => a.academyId === req.params.academyId);
  if (!academy) return res.status(404).json({ error: 'Academy not found' });

  const login = db.find('LoginMaster', (l) => l.refId === academy.academyId && l.role === 'ACADEMY');
  if (!login) return res.status(404).json({ error: 'That academy has no sign-in record' });

  const asked = typeof req.body?.newPassword === 'string' && req.body.newPassword.trim() !== '';
  let password = config().app.defaultPassword;

  if (asked) {
    const { ok, values, errors } = validate(req.body, {
      newPassword: { required: true, type: 'password', label: 'New password' },
    });
    if (!ok) return res.status(400).json({ errors });
    password = values.newPassword;
  }

  db.update('LoginMaster', (l) => l.uid === login.uid, { password: hashPassword(password) });

  res.json({
    uid: login.uid,
    password,
    resetToDefault: !asked,
  });
});

export default router;
