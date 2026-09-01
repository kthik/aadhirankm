import { Router } from 'express';
import * as db from '../lib/store.js';
import { requireAuth, verifyPassword } from '../lib/auth.js';
import { log } from '../lib/audit.js';
import {
  DRIVERS,
  config,
  dataDir,
  resolveStorage,
  saveStorage,
  storageDriver,
} from '../config.js';

/*
 * Database location, owned by the Super Admin.
 *
 * Repointing the database is the most destructive thing this app can do from a
 * screen, so the flow is deliberately in three steps: resolve the destination
 * and report what is already there (preview), then apply with an explicit
 * decision about copying the current data across, gated on the super admin's
 * own password.
 *
 * The rule that protects the data: after the switch, the destination must
 * contain an active Super Admin login. Either the copy carries the current one
 * across, or the folder already had one. Switching to a populated folder with no
 * super admin would leave nobody able to sign in and administer it, and
 * switching to an empty one without copying would strand the current database at
 * a path nobody is looking at.
 */

const router = Router();

router.use(requireAuth('SUPER_ADMIN'));

/** The spec the client may set; anything else in storage config is left alone. */
function specFrom(body = {}) {
  const spec = {};
  if (body.driver != null) spec.driver = String(body.driver).trim().toLowerCase();
  if (body.local) spec.local = { dataDir: String(body.local.dataDir ?? '').trim() };
  if (body.gdrive) {
    spec.gdrive = {
      dataDir: String(body.gdrive.dataDir ?? '').trim(),
      driveRoot: String(body.gdrive.driveRoot ?? '').trim(),
      account: String(body.gdrive.account ?? '').trim(),
      cache: body.gdrive.cache !== false,
    };
  }
  return spec;
}

function currentState() {
  const storage = config().storage ?? {};
  return {
    drivers: DRIVERS,
    driver: storageDriver(),
    envOverride: {
      driver: process.env.VEERAN_DB_DRIVER ?? null,
      dataDir: process.env.VEERAN_DATA_DIR ?? null,
      driveRoot: process.env.VEERAN_GDRIVE_DIR ?? null,
    },
    local: { dataDir: storage.local?.dataDir ?? '' },
    gdrive: {
      dataDir: storage.gdrive?.dataDir ?? 'Veeran/data',
      driveRoot: storage.gdrive?.driveRoot ?? '',
      account: storage.gdrive?.account ?? '',
      cache: storage.gdrive?.cache !== false,
    },
    active: { dir: dataDir(), cacheDir: db.cacheStatus() },
    contents: db.inspect(dataDir()),
  };
}

/** Where the database is now, and what it holds. */
router.get('/', (req, res) => {
  res.json(currentState());
});

/**
 * Dry run: resolve a proposed spec and report the destination's contents, so the
 * screen can say what will happen before anything is written.
 */
router.post('/preview', (req, res) => {
  let resolved;
  try {
    resolved = resolveStorage(specFrom(req.body));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const target = db.inspect(resolved.dir);
  const same = resolved.dir === dataDir();

  res.json({
    resolved,
    target,
    same,
    // Copying is offered whenever the destination is somewhere else; it is
    // *required* when that folder has no super admin of its own.
    copyOffered: !same,
    copyRequired: !same && target.superAdmins === 0,
    overwriteNeeded: !same && !target.empty,
  });
});

/**
 * Applies a new location.
 *
 * Body: the spec, plus `password` (the acting super admin's own), `copyData`
 * (their answer to the copy prompt) and `overwrite` (only when the destination
 * already holds rows).
 */
router.put('/', (req, res) => {
  const { password, copyData, overwrite } = req.body ?? {};

  const login = db.find('LoginMaster', (l) => l.uid === req.user.uid);
  if (!login || !verifyPassword(String(password ?? ''), login.password)) {
    return res.status(401).json({
      error: 'Enter your own Super Admin password to change the database location.',
      errors: { password: 'Password does not match.' },
    });
  }

  let resolved;
  try {
    resolved = resolveStorage(specFrom(req.body));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const from = dataDir();
  const target = db.inspect(resolved.dir);
  const same = resolved.dir === from;

  if (same) {
    const storage = saveStorage(specFrom(req.body));
    log(req, 'storage.update', { dir: resolved.dir, moved: false });
    return res.json({ moved: false, storage, ...currentState() });
  }

  // The guard: after this switch somebody must still be able to sign in as
  // Super Admin at the destination, or the database is effectively lost.
  if (!copyData && target.superAdmins === 0) {
    return res.status(409).json({
      error:
        `${resolved.dir} has no Super Admin login, so switching to it without copying would ` +
        'leave nobody able to sign in - and the current database would stay behind at ' +
        `${from}. Copy the data across, or point at a folder that already has a Super Admin.`,
      code: 'NO_SUPER_ADMIN_AT_TARGET',
      target,
    });
  }

  let copied = null;
  if (copyData) {
    try {
      copied = db.copyTo(resolved.dir, { overwrite: Boolean(overwrite) });
    } catch (err) {
      return res.status(409).json({ error: err.message, code: 'COPY_BLOCKED', target });
    }
  }

  const storage = saveStorage(specFrom(req.body));

  // Read back through the live store: proves the new location is actually
  // serving before the response claims the switch worked.
  const now = db.inspect(dataDir());
  if (now.superAdmins === 0) {
    return res.status(500).json({
      error: `Switched to ${dataDir()} but it has no Super Admin login. Nothing was deleted - ` +
        `the previous database is still at ${from}.`,
    });
  }

  log(req, 'storage.update', {
    from,
    to: dataDir(),
    driver: resolved.driver,
    copied: copied ? Object.values(copied).reduce((a, b) => a + b, 0) : 0,
    copiedData: Boolean(copyData),
  });

  res.json({
    moved: true,
    copied,
    warning: copyData
      ? null
      : `Data was not copied. The database that was at ${from} is still there, untouched, and ` +
        'is no longer being read or written by the app.',
    storage,
    ...currentState(),
  });
});

export default router;
