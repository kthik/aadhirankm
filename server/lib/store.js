import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, config } from '../config.js';

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
  return path.join(DATA_DIR, `${name}.json`);
}

function readRaw(name) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Serialises writes per collection and swaps through a temp file, so a crash
 * mid-write can never leave a half-written JSON document behind.
 */
function writeRaw(name, rows) {
  const target = file(name);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
  fs.renameSync(tmp, target);
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

export function ensureSeed(seeds) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const name of COLLECTIONS) {
    if (!fs.existsSync(file(name))) {
      writeRaw(name, seeds[name] ?? []);
      continue;
    }
    if (seeds[name]?.length && readRaw(name).length === 0) writeRaw(name, seeds[name]);
  }
}
