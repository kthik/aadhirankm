import * as db from './store.js';

/**
 * Append-only record of administrative actions.
 *
 * Only actions worth answering "who did that?" about are logged — creating or
 * deleting accounts, resetting passwords, switching tournaments, backups and
 * restores. Routine reads are not logged, and no secret is ever written here:
 * a password reset records that it happened, never the password.
 */
export function log(req, action, detail = {}) {
  return db.insert('SystemLogs', {
    logId: `L${String(db.all('SystemLogs').length + 1).padStart(6, '0')}`,
    at: new Date().toISOString(),
    actor: req?.user?.uid ?? 'system',
    actorRole: req?.user?.role ?? 'SYSTEM',
    action,
    detail,
  });
}

/** Newest first, optionally narrowed by action prefix or actor. */
export function recent({ limit = 200, action, actor } = {}) {
  return db
    .all('SystemLogs')
    .filter((l) => (!action || l.action.startsWith(action)) && (!actor || l.actor === actor))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}
