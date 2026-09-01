import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DEFAULT_CONFIG_PATH = path.join(ROOT, 'config', 'app.config.json');
export const DEFAULT_DATA_DIR = path.join(__dirname, 'data');

/** Expands `~`, `%VAR%`/`$VAR` and relative paths against the repo root. */
function resolvePath(value) {
  let p = String(value).trim();
  p = p.replace(/%([^%]+)%/g, (m, name) => process.env[name] ?? m);
  p = p.replace(/\$\{?([A-Za-z_]\w*)\}?/g, (m, name) => process.env[name] ?? m);
  if (/^~([/\\]|$)/.test(p)) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(ROOT, p);
}

/**
 * Google Drive location. `storage.gdrive.dataDir` is a path *inside* the locally
 * synced Drive folder, so the JSON database syncs across machines. The Drive root
 * is auto-detected, or set explicitly with `storage.gdrive.driveRoot` /
 * VEERAN_GDRIVE_DIR when it is mounted somewhere unusual.
 */
function gdriveRoot(configured) {
  const candidates = [
    process.env.VEERAN_GDRIVE_DIR,
    configured,
    path.join(os.homedir(), 'Google Drive', 'My Drive'),
    path.join(os.homedir(), 'Google Drive'),
    path.join(os.homedir(), 'My Drive'),
    // Drive for desktop mounts a virtual drive on Windows (G: by default).
    ...'GHIJKLMNOP'.split('').map((d) => path.join(`${d}:${path.sep}`, 'My Drive')),
  ].filter(Boolean);

  const found = candidates.map(resolvePath).find((dir) => {
    try {
      return fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
  if (!found) {
    throw new Error(
      `storage.driver is "gdrive", but no synced Google Drive folder was found.
Install Google Drive for desktop and sign in, or set storage.gdrive.driveRoot
(or VEERAN_GDRIVE_DIR) to the synced folder.
To run on local files instead, set storage.driver to "local" in config/app.config.json.`
    );
  }
  return found;
}

export const DRIVERS = ['local', 'gdrive'];

/**
 * Which store the server runs against: `storage.driver` in app.config.json,
 * overridable with VEERAN_DB_DRIVER for a one-off run.
 */
export function storageDriver() {
  const driver = (process.env.VEERAN_DB_DRIVER || config().storage?.driver || 'local')
    .trim()
    .toLowerCase();
  if (!DRIVERS.includes(driver)) {
    throw new Error(
      `Unknown storage.driver "${driver}". Use one of: ${DRIVERS.join(', ')}.`
    );
  }
  return driver;
}

/** Config file location: env wins, then the repo default. */
export const CONFIG_PATH = process.env.VEERAN_CONFIG_PATH
  ? resolvePath(process.env.VEERAN_CONFIG_PATH)
  : DEFAULT_CONFIG_PATH;

let cached = null;
let cachedAt = 0;

/** Reads app.config.json, re-reading at most once a second so edits apply without a restart. */
export function config() {
  const now = Date.now();
  if (!cached || now - cachedAt > 1000) {
    cached = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    cachedAt = now;
  }
  return cached;
}

let dataDirCache = null;

/** The local driver's folder, regardless of which driver is active. */
export function localDataDir() {
  const configured = config().storage?.local?.dataDir;
  return configured ? resolvePath(configured) : DEFAULT_DATA_DIR;
}

/**
 * Where the JSON collections live, decided by the active driver:
 *   local  - `storage.local.dataDir`, relative to the repo root (default server/data)
 *   gdrive - `storage.gdrive.dataDir` inside the synced Drive folder
 * VEERAN_DATA_DIR short-circuits both. Paths accept `~`, `%VAR%`/`$VAR`, and
 * absolute or repo-relative forms. Resolved once per process: flipping the driver
 * takes a restart, since a live swap would split writes across two databases.
 */
export function dataDir() {
  if (dataDirCache) return dataDirCache;

  if (process.env.VEERAN_DATA_DIR) {
    dataDirCache = resolvePath(process.env.VEERAN_DATA_DIR);
    return dataDirCache;
  }

  const storage = config().storage ?? {};
  if (storageDriver() === 'gdrive') {
    const sub = storage.gdrive?.dataDir || 'Veeran/data';
    dataDirCache = path.resolve(gdriveRoot(storage.gdrive?.driveRoot), sub);
  } else {
    dataDirCache = localDataDir();
  }
  return dataDirCache;
}

/* ------------------------------------------------ storage configuration -- */

/**
 * Resolves an arbitrary storage spec without touching the live one, so the
 * admin screen can validate a destination before anything is written.
 * Returns the driver, the folder it lands on, and the cache folder in play.
 * Throws with a readable message when the spec cannot be honoured.
 */
export function resolveStorage(spec = {}) {
  const merged = { ...(config().storage ?? {}), ...spec };
  const driver = String(merged.driver ?? 'local').trim().toLowerCase();
  if (!DRIVERS.includes(driver)) {
    throw new Error(`Unknown driver "${driver}". Use one of: ${DRIVERS.join(', ')}.`);
  }

  const local = merged.local?.dataDir ? resolvePath(merged.local.dataDir) : DEFAULT_DATA_DIR;
  if (driver === 'local') return { driver, dir: local, cacheDir: null };

  const root = gdriveRoot(merged.gdrive?.driveRoot);
  const dir = path.resolve(root, merged.gdrive?.dataDir || 'Veeran/data');
  const cached = merged.gdrive?.cache !== false && path.resolve(dir) !== path.resolve(local);
  return { driver, dir, driveRoot: root, cacheDir: cached ? local : null };
}

/**
 * Writes a storage patch into app.config.json and drops the resolved-path cache,
 * so the running server switches database without a restart. Every other config
 * key is left untouched, and the file keeps its formatting.
 */
export function saveStorage(patch) {
  const current = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  current.storage = {
    ...(current.storage ?? {}),
    ...patch,
    local: { ...(current.storage?.local ?? {}), ...(patch.local ?? {}) },
    gdrive: { ...(current.storage?.gdrive ?? {}), ...(patch.gdrive ?? {}) },
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 2) + os.EOL);
  resetStorageCache();
  return current.storage;
}

/** Drops the resolved-path cache; the next read re-resolves from config. */
export function resetStorageCache() {
  dataDirCache = null;
  cached = null;
  cachedAt = 0;
}

export function moduleEnabled(name) {
  return config().modules?.[name] === true;
}

/** Route guard: 404s a whole feature when its module is switched off in config. */
export function requireModule(name) {
  return (req, res, next) =>
    moduleEnabled(name) ? next() : res.status(404).json({ error: `Module "${name}" is disabled` });
}
