import fs from 'node:fs';
import path from 'node:path';
import { dataDir, localDataDir as cacheDir, storageDriver, config } from '../config.js';

const COLLECTIONS = [
  'Academy',
  'Participants',
  'LoginMaster',
  'EventMaster',
  'Judges',
  'Scores',
  'BoutMaster',
  'ScoreCategory',
  'PositionMaster',
  'AgeCategory',
  'BoutEntries',
  'Medals',
  'Tournaments',
  'SystemLogs',
  'Backups',
];

function file(name) {
  return path.join(dataDir(), `${name}.json`);
}

function cacheFile(name) {
  return path.join(cacheDir(), `${name}.json`);
}

/** Atomic write: swap through a temp file so a crash can never leave half a document. */
function writeFileAtomic(target, text) {
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, target);
}

function mtime(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return -1;
  }
}

/**
 * Read-through cache.
 *
 * With the gdrive driver the Drive folder is the database and the local folder is
 * a cache of it, refreshed from Drive whenever the Drive copy is newer - which is
 * how a change synced down from another machine gets picked up. Every write lands
 * in Drive first and is then mirrored into the cache, so the cache is never newer
 * than Drive except by our own hand.
 *
 * Reads therefore hit local disk instead of the Drive mount, and still answer
 * while Drive is offline. Set `storage.gdrive.cache` to false to read Drive direct.
 */
function cacheActive() {
  // Not memoised: the super admin screen can repoint the database mid-run, and
  // config() is itself cached for a second, so this stays cheap.
  return (
    storageDriver() === 'gdrive' &&
    config().storage?.gdrive?.cache !== false &&
    path.resolve(cacheDir()) !== path.resolve(dataDir())
  );
}

/** The cache folder in use, or null when reads go straight to the database. */
export function cacheStatus() {
  return cacheActive() ? cacheDir() : null;
}

/** Copies the Drive copy down when it is newer than ours, or when we have none. */
function refreshCache(name) {
  const primary = file(name);
  const cached = cacheFile(name);
  const primaryAt = mtime(primary);
  if (primaryAt === -1) return;
  if (primaryAt <= mtime(cached)) return;

  fs.mkdirSync(cacheDir(), { recursive: true });
  writeFileAtomic(cached, fs.readFileSync(primary));
  // Keep the timestamps equal so the next read does not copy the same bytes again.
  fs.utimesSync(cached, new Date(), new Date(primaryAt));
}

function readRaw(name) {
  if (!cacheActive()) return parse(file(name));

  try {
    refreshCache(name);
  } catch (err) {
    // Drive unreachable mid-session: fall through and serve the cached copy.
    console.warn(`Cache refresh failed for ${name}: ${err.message}`);
  }
  return parse(fs.existsSync(cacheFile(name)) ? cacheFile(name) : file(name));
}

function parse(target) {
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Writes the database, then the cache. Drive first, so a failure there fails the
 * request instead of leaving an accepted write that only exists locally; the
 * cache copy is best-effort, since a stale cache is self-correcting on the next
 * read while a stale database is not.
 */
function writeRaw(name, rows) {
  const text = JSON.stringify(rows, null, 2);
  writeFileAtomic(file(name), text);
  if (!cacheActive()) return;

  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    writeFileAtomic(cacheFile(name), text);
    fs.utimesSync(cacheFile(name), new Date(), new Date(mtime(file(name))));
  } catch (err) {
    console.warn(`Cache write failed for ${name}: ${err.message}`);
  }
}

export function all(name) {
  return readRaw(name);
}

export function find(name, predicate) {
  return readRaw(name).find(predicate) ?? null;
}

export function filter(name, predicate) {
  return readRaw(name).filter(predicate);
}

export function insert(name, row) {
  const rows = readRaw(name);
  rows.push(row);
  writeRaw(name, rows);
  return row;
}

export function insertMany(name, newRows) {
  const rows = readRaw(name);
  rows.push(...newRows);
  writeRaw(name, rows);
  return newRows;
}

export function update(name, predicate, patch) {
  const rows = readRaw(name);
  const i = rows.findIndex(predicate);
  if (i === -1) return null;
  rows[i] = { ...rows[i], ...patch, updatedAt: new Date().toISOString() };
  writeRaw(name, rows);
  return rows[i];
}

export function remove(name, predicate) {
  const rows = readRaw(name);
  const kept = rows.filter((r, i) => !predicate(r, i));
  writeRaw(name, kept);
  return rows.length - kept.length;
}

/**
 * Sequential ID per entity: A001, P001, E001...
 * Scans existing rows rather than keeping a counter file, so restoring a JSON
 * snapshot can't desynchronise the sequence.
 */
export function nextId(collection, key, role) {
  const prefix = config().idPrefixes[role] ?? role[0];
  const max = readRaw(collection)
    .map((r) => String(r[key] ?? ''))
    .filter((id) => id.startsWith(prefix))
    .reduce((acc, id) => Math.max(acc, Number(id.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

/**
 * Creates any missing collection file and fills reference data that is still
 * empty. Seeding an empty collection (rather than only a missing one) matters
 * when a watching dev server creates the file before its seed is written, and
 * is a no-op for collections that have no seed. Rows already on disk are never
 * touched.
 */
/** Replaces a whole collection. Used by restore, which swaps tables wholesale. */
export function replaceAll(name, rows) {
  if (!COLLECTIONS.includes(name)) throw new Error(`Unknown collection: ${name}`);
  if (!Array.isArray(rows)) throw new Error(`${name} must be a list of rows`);
  writeRaw(name, rows);
  return rows.length;
}

/** Every collection, for the rollback path around a failed restore. */
export function snapshotAll() {
  return Object.fromEntries(COLLECTIONS.map((name) => [name, readRaw(name)]));
}

export function restoreAll(snapshot) {
  for (const [name, rows] of Object.entries(snapshot)) writeRaw(name, rows);
}

/**
 * First boot after flipping storage.driver to gdrive: copies the local
 * collections into the still-empty Drive folder, so switching stores keeps the
 * existing tournament rather than seeding a blank one. Only ever runs into a
 * folder that holds no collection file yet, so it cannot overwrite live data,
 * and never copies back the other way - flipping to local leaves the local
 * files exactly as they were.
 */
function adoptLocalData() {
  const target = dataDir();
  const source = cacheDir();
  if (path.resolve(target) === path.resolve(source)) return 0;
  if (COLLECTIONS.some((name) => fs.existsSync(file(name)))) return 0;

  let copied = 0;
  for (const name of COLLECTIONS) {
    const from = path.join(source, `${name}.json`);
    if (!fs.existsSync(from)) continue;
    fs.copyFileSync(from, path.join(target, `${name}.json`));
    copied += 1;
  }
  if (copied) console.log(`Adopted ${copied} collection(s) from ${source}`);
  return copied;
}

/* ------------------------------------------- moving the database around -- */

/** Reads one collection from an arbitrary folder, for inspecting a destination. */
function readFrom(dir, name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * What a folder holds, without making it the active database. The super admin
 * screen shows this before a switch, and the switch itself refuses to move to a
 * populated folder that has no super admin - signing in there would be
 * impossible, which is the one way this feature could lose someone their data.
 */
export function inspect(dir) {
  const counts = {};
  let rows = 0;
  let files = 0;

  for (const name of COLLECTIONS) {
    const parsed = readFrom(dir, name);
    if (parsed === null) continue;
    files += 1;
    counts[name] = Array.isArray(parsed) ? parsed.length : 0;
    rows += counts[name];
  }

  const logins = readFrom(dir, 'LoginMaster') ?? [];
  return {
    dir,
    exists: fs.existsSync(dir),
    files,
    rows,
    counts,
    empty: files === 0 || rows === 0,
    superAdmins: logins.filter((l) => l.role === 'SUPER_ADMIN' && l.active !== false).length,
  };
}

/**
 * Copies every collection from the live database into `target`.
 *
 * Writes through a temp file per collection like every other write here, and
 * refuses a target that already holds rows unless overwrite is asked for, so
 * "copy my data across" can never quietly flatten a database that was already
 * in use at the destination.
 */
export function copyTo(target, { overwrite = false } = {}) {
  const source = dataDir();
  if (path.resolve(target) === path.resolve(source)) {
    throw new Error('Source and destination are the same folder.');
  }

  const at = inspect(target);
  if (!at.empty && !overwrite) {
    throw new Error(
      `${target} already holds ${at.rows} row(s). Copying would overwrite them.`
    );
  }

  fs.mkdirSync(target, { recursive: true });
  const copied = {};
  for (const name of COLLECTIONS) {
    const rows = readRaw(name);
    writeFileAtomic(path.join(target, `${name}.json`), JSON.stringify(rows, null, 2));
    copied[name] = rows.length;
  }
  return copied;
}

export function ensureSeed(seeds) {
  fs.mkdirSync(dataDir(), { recursive: true });
  adoptLocalData();
  for (const name of COLLECTIONS) {
    if (!fs.existsSync(file(name))) {
      writeRaw(name, seeds[name] ?? []);
      continue;
    }
    if (seeds[name]?.length && readRaw(name).length === 0) writeRaw(name, seeds[name]);
  }
}
