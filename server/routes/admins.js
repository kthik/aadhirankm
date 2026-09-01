import { Router } from 'express';
import * as db from '../lib/store.js';
import { validate } from '../lib/validate.js';
import { hashPassword, requireAuth, verifyPassword } from '../lib/auth.js';
import { config, requireModule } from '../config.js';
import { log } from '../lib/audit.js';

const router = Router();

router.use(requireAuth('SUPER_ADMIN'), requireModule('adminManagement'));

const RULES = {
  name: { required: true, min: 3, label: 'Admin name' },
  email: { required: true, label: 'Email' },
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Never returns the hash; an admin's password is only ever set, never read. */
function shape(login) {
  return {
    uid: login.uid,
    name: login.name,
    email: login.email ?? null,
    active: login.active !== false,
    tournamentIds: login.tournamentIds ?? [],
    lastLoginAt: login.lastLoginAt ?? null,
    createdAt: login.createdAt,
    usesDefaultPassword: verifyPassword(config().app.defaultPassword, login.password),
  };
}

router.get('/', (_req, res) => {
  const tournaments = db.all('Tournaments');
  const admins = db
    .filter('LoginMaster', (l) => l.role === 'ADMIN')
    .map((l) => ({
      ...shape(l),
      tournamentNames: (l.tournamentIds ?? []).map(
        (id) => tournaments.find((t) => t.tournamentId === id)?.name ?? id
      ),
    }));
  res.json({ admins });
});

/**
 * Creates an Admin account.
 *
 * `tournamentIds` narrows them to those tournaments; leaving it empty means
 * unrestricted, which is how every admin behaved before tournaments existed.
 * Super Admin is never restricted either way.
 */
router.post('/', (req, res) => {
  const { ok, values, errors } = validate(req.body, RULES);
  if (values.email && !EMAIL.test(values.email)) errors.email = 'Enter a valid email address';

  const tournamentIds = Array.isArray(req.body?.tournamentIds)
    ? [...new Set(req.body.tournamentIds.filter(Boolean))]
    : [];
  const unknown = tournamentIds.filter((id) => !db.find('Tournaments', (t) => t.tournamentId === id));
  if (unknown.length) errors.tournamentIds = `Unknown tournament(s): ${unknown.join(', ')}`;

  if (db.find('LoginMaster', (l) => l.role === 'ADMIN' && l.email === values.email)) {
    errors.email = 'An admin with that email already exists';
  }

  if (!ok || Object.keys(errors).length) return res.status(400).json({ errors });

  const asked = typeof req.body?.password === 'string' && req.body.password.trim() !== '';
  let password = config().app.defaultPassword;
  if (asked) {
    const check = validate(req.body, {
      password: { required: true, type: 'password', label: 'Password' },
    });
    if (!check.ok) return res.status(400).json({ errors: check.errors });
    password = check.values.password;
  }

  const uid = db.nextId('LoginMaster', 'uid', 'ADMIN');
  const login = {
    uid,
    password: hashPassword(password),
    role: 'ADMIN',
    refId: uid,
    name: values.name,
    email: values.email,
    tournamentIds,
    active: true,
    createdAt: new Date().toISOString(),
  };
  db.insert('LoginMaster', login);
  log(req, 'admin.create', { uid, email: values.email, tournamentIds });

  res.status(201).json({ admin: shape(login), credentials: { uid, password } });
});

router.put('/:uid', (req, res) => {
  const login = db.find('LoginMaster', (l) => l.uid === req.params.uid && l.role === 'ADMIN');
  if (!login) return res.status(404).json({ error: 'Admin not found' });

  const merged = {
    name: login.name,
    email: login.email ?? '',
    ...Object.fromEntries(
      Object.entries(req.body ?? {}).filter(([k, v]) => k in RULES && v !== '' && v != null)
    ),
  };
  const { ok, values, errors } = validate(merged, RULES);
  if (values.email && !EMAIL.test(values.email)) errors.email = 'Enter a valid email address';

  const patch = { ...values };

  if (Array.isArray(req.body?.tournamentIds)) {
    const ids = [...new Set(req.body.tournamentIds.filter(Boolean))];
    const unknown = ids.filter((id) => !db.find('Tournaments', (t) => t.tournamentId === id));
    if (unknown.length) errors.tournamentIds = `Unknown tournament(s): ${unknown.join(', ')}`;
    patch.tournamentIds = ids;
  }
  if (typeof req.body?.active === 'boolean') patch.active = req.body.active;

  if (!ok || Object.keys(errors).length) return res.status(400).json({ errors });

  const updated = db.update('LoginMaster', (l) => l.uid === login.uid, patch);
  log(req, 'admin.update', { uid: login.uid, tournamentIds: patch.tournamentIds });
  res.json({ admin: shape(updated) });
});

/** Resets an Admin password; returns it once so it can be handed over. */
router.post('/:uid/reset-password', (req, res) => {
  const login = db.find('LoginMaster', (l) => l.uid === req.params.uid && l.role === 'ADMIN');
  if (!login) return res.status(404).json({ error: 'Admin not found' });

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
  log(req, 'admin.resetPassword', { uid: login.uid, toDefault: !asked });

  res.json({ uid: login.uid, password, resetToDefault: !asked });
});

/** Deletes an Admin. The last active one is protected against lockout. */
router.delete('/:uid', (req, res) => {
  const login = db.find('LoginMaster', (l) => l.uid === req.params.uid && l.role === 'ADMIN');
  if (!login) return res.status(404).json({ error: 'Admin not found' });

  const remaining = db.filter(
    'LoginMaster',
    (l) => l.role === 'ADMIN' && l.active !== false && l.uid !== login.uid
  );
  if (remaining.length === 0 && req.query.force !== 'true') {
    return res.status(409).json({
      error: 'That is the last active Admin. Deleting it leaves the tournament with no admin — confirm to proceed.',
      requiresConfirmation: true,
    });
  }

  db.remove('LoginMaster', (l) => l.uid === login.uid);
  log(req, 'admin.delete', { uid: login.uid });
  res.json({ deleted: login.uid });
});

export default router;
