import { Router } from 'express';
import * as db from '../lib/store.js';
import { validate } from '../lib/validate.js';
import {
  hashPassword, verifyPassword, signSession, requireAuth, usesDefaultPassword,
} from '../lib/auth.js';
import { config } from '../config.js';

const router = Router();

const COOKIE = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 1000 * 60 * 60 * 8,
};

/** Shapes the session-safe view of an account for the client. */
function profileFor(login) {
  if (login.role === 'ACADEMY') {
    return db.find('Academy', (a) => a.academyId === login.refId);
  }
  if (['INDIVIDUAL', 'ACADEMY_PARTICIPANT'].includes(login.role)) {
    return db.find('Participants', (p) => p.participantId === login.refId);
  }
  if (login.role === 'JUDGE') {
    return db.find('Judges', (j) => j.judgeId === login.refId);
  }
  return null;
}

function sessionBody(login) {
  return {
    uid: login.uid,
    role: login.role,
    refId: login.refId,
    name: login.name,
    mustChangePassword: usesDefaultPassword(login.uid),
    profile: profileFor(login),
  };
}

router.post('/login', (req, res) => {
  const { ok, values, errors } = validate(req.body, {
    uid: { required: true, label: 'UID' },
    password: { required: true, label: 'Password' },
  });
  if (!ok) return res.status(400).json({ errors });

  const login = db.find('LoginMaster', (l) => l.uid.toUpperCase() === values.uid.toUpperCase());
  if (!login || !verifyPassword(values.password, login.password)) {
    return res.status(401).json({ error: 'Invalid UID or password' });
  }
  if (login.active === false) {
    return res.status(403).json({ error: 'This account has been deactivated. Contact your Admin.' });
  }

  const user = sessionBody(login);
  db.update('LoginMaster', (l) => l.uid === login.uid, { lastLoginAt: new Date().toISOString() });
  res.cookie('veeran_session', signSession({ uid: user.uid, role: user.role, refId: user.refId, name: user.name }), COOKIE);
  res.json({ user, home: config().roles[user.role]?.home ?? '/' });
});

router.post('/logout', (req, res) => {
  res.clearCookie('veeran_session', { ...COOKIE, maxAge: undefined });
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  const login = db.find('LoginMaster', (l) => l.uid === req.user.uid);
  if (!login) return res.status(401).json({ error: 'Account no longer exists' });
  res.json({ user: sessionBody(login) });
});

router.post('/change-password', requireAuth(), (req, res) => {
  const { ok, values, errors } = validate(req.body, {
    currentPassword: { required: true, label: 'Current password' },
    newPassword: { required: true, type: 'password', label: 'New password' },
  });
  if (!ok) return res.status(400).json({ errors });

  const login = db.find('LoginMaster', (l) => l.uid === req.user.uid);
  if (!verifyPassword(values.currentPassword, login.password)) {
    return res.status(400).json({ errors: { currentPassword: 'Current password is incorrect' } });
  }
  if (values.currentPassword === values.newPassword) {
    return res.status(400).json({ errors: { newPassword: 'New password must differ from the current one' } });
  }
  db.update('LoginMaster', (l) => l.uid === login.uid, { password: hashPassword(values.newPassword) });
  res.json({ ok: true });
});

/**
 * Forgot UID. Requires all three identifying fields to match so the endpoint
 * can't be used to enumerate academies from a name alone.
 */
router.post('/forgot-uid', (req, res) => {
  const { ok, values, errors } = validate(req.body, {
    academyName: { required: true, label: 'Academy name' },
    coachName: { required: true, label: 'Coach name' },
    phone: { required: true, type: 'phone', label: 'Phone number' },
  });
  if (!ok) return res.status(400).json({ errors });

  const norm = (s) => String(s).trim().toLowerCase();
  const academy = db.find(
    'Academy',
    (a) =>
      norm(a.academyName) === norm(values.academyName) &&
      norm(a.coachName) === norm(values.coachName) &&
      a.phone === values.phone
  );

  if (!academy) {
    return res.status(404).json({
      error: 'No matching academy found. Please contact your Admin to recover your UID.',
    });
  }
  const login = db.find('LoginMaster', (l) => l.refId === academy.academyId && l.role === 'ACADEMY');
  res.json({ uid: login?.uid ?? academy.academyId, academyName: academy.academyName });
});

export default router;
