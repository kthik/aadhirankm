import crypto from 'node:crypto';
import { find } from './store.js';
import { config } from '../config.js';

const SESSION_TTL_MS = 1000 * 60 * 60 * 8;

/** scrypt with a per-record salt; stored as "salt:hash" so no secret lives in config. */
export function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(plain, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(plain, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

const SECRET =
  process.env.VEERAN_SECRET ||
  crypto.createHash('sha256').update('veeran-dev-secret').digest('hex');

export function signSession(payload) {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Date.now() + SESSION_TTL_MS })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function readSession(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  return payload.exp > Date.now() ? payload : null;
}

export function attachUser(req, _res, next) {
  req.user = readSession(req.cookies?.veeran_session);
  next();
}

export function requireAuth(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in' });
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Not allowed for your role' });
    }
    next();
  };
}

/** True when the account still has the factory password and should be nudged to change it. */
export function usesDefaultPassword(uid) {
  const login = find('LoginMaster', (l) => l.uid === uid);
  return login ? verifyPassword(config().app.defaultPassword, login.password) : false;
}
