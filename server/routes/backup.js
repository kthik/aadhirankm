import { Router } from 'express';
import * as XLSX from 'xlsx';
import * as db from '../lib/store.js';
import { requireAuth } from '../lib/auth.js';
import { requireModule } from '../config.js';
import { log } from '../lib/audit.js';
import { deleteSelection, mergeSkippingDuplicates, select, summarise } from '../lib/filterEngine.js';

const router = Router();

/**
 * Backup and restore.
 *
 * Admin keeps the everyday full backup; the filtered variants, the delete
 * options and the restore are Super Admin only, because each of those can
 * remove live competition data.
 */
router.use(requireAuth('ADMIN', 'SUPER_ADMIN'), requireModule('backupRestore'));

const superOnly = (req, res, next) =>
  req.user.role === 'SUPER_ADMIN'
    ? next()
    : res.status(403).json({ error: 'Only a Super Admin may do that' });

/** Sheet name -> collection. Sheet names are capped at 31 chars by the format. */
const SHEETS = {
  Tournaments: 'Tournaments',
  Academy: 'Academy',
  Participants: 'Participants',
  Events: 'EventMaster',
  Judges: 'Judges',
  Bouts: 'BoutMaster',
  BoutEntries: 'BoutEntries',
  Scores: 'Scores',
  Medals: 'Medals',
  AgeCategory: 'AgeCategory',
  ScoreCategory: 'ScoreCategory',
  PositionMaster: 'PositionMaster',
  Logins: 'LoginMaster',
};

/** Reference data that always travels with a backup, whatever the filter. */
const REFERENCE = ['Tournaments', 'EventMaster', 'AgeCategory', 'ScoreCategory', 'PositionMaster'];

/**
 * Excel cells are flat, so arrays and objects are round-tripped as JSON text.
 * `events`, `boutIds` and a score sheet's per-category map take this path.
 */
function encodeCell(value) {
  if (value == null) return '';
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value);
  return value;
}

/**
 * Only these come back as numbers. Everything else that looks numeric — a
 * mobile number, a UID, a pin code — stays text, because turning "9812435667"
 * into a number is lossy and turning "007" into 7 is worse.
 */
const NUMERIC_FIELDS = new Set(['age', 'total', 'queueNo', 'order', 'minAge', 'maxAge']);

function decodeCell(key, value) {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if (t === '') return null;
  if (t.startsWith('[') || t.startsWith('{')) {
    try {
      return JSON.parse(t);
    } catch {
      return value;
    }
  }
  // Excel writes booleans back as TRUE/FALSE.
  if (/^true$/i.test(t)) return true;
  if (/^false$/i.test(t)) return false;
  if (NUMERIC_FIELDS.has(key) && /^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return value;
}

function sheetFromRows(rows) {
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const body = rows.map((r) => Object.fromEntries(headers.map((h) => [h, encodeCell(r[h])])));
  const sheet = XLSX.utils.json_to_sheet(body, { header: headers });
  sheet['!cols'] = headers.map((h) => ({ wch: Math.min(Math.max(h.length + 4, 12), 40) }));
  return sheet;
}

/** Reads the filter off a query string or a JSON body, whichever is in use. */
function filterFrom(source = {}) {
  const pick = (k) => (source[k] === '' || source[k] == null ? undefined : String(source[k]));
  return {
    tournamentId: pick('tournamentId'),
    academyId: pick('academyId'),
    participantId: pick('participantId'),
    from: pick('from'),
    to: pick('to'),
  };
}

const isNarrowed = (f) => Object.values(f).some(Boolean);

/**
 * Builds the workbook for a filter. Filtered backups still carry the reference
 * tables, so the file can be restored into an empty system and still make
 * sense — a participant row is meaningless without its events.
 */
function buildWorkbook(filter) {
  const selection = select(filter);
  const book = XLSX.utils.book_new();
  const narrowed = isNarrowed(filter);

  for (const [sheetName, collection] of Object.entries(SHEETS)) {
    let rows;
    if (selection[collection]) {
      rows = selection[collection];
    } else if (REFERENCE.includes(collection)) {
      rows = db.all(collection);
    } else if (collection === 'LoginMaster') {
      // Only the sign-ins for accounts in the selection, plus the staff logins
      // so a restored file is never left without a way in.
      const uids = new Set([
        ...(selection.Academy ?? []).map((a) => a.academyId),
        ...(selection.Participants ?? []).map((p) => p.participantId),
        ...(selection.Judges ?? []).map((j) => j.judgeId),
      ]);
      rows = narrowed
        ? db.filter(
            'LoginMaster',
            (l) => uids.has(l.uid) || ['ADMIN', 'SUPER_ADMIN'].includes(l.role)
          )
        : db.all(collection);
    } else {
      rows = db.all(collection);
    }

    XLSX.utils.book_append_sheet(book, sheetFromRows(rows.length ? rows : [{}]), sheetName);
  }

  return { book, selection };
}

/** What a filter currently selects, for the backup wizard's preview step. */
router.get('/preview', (req, res) => {
  const filter = filterFrom(req.query);
  res.json({ filter, narrowed: isNarrowed(filter), summary: summarise(select(filter)) });
});

/**
 * Downloads a backup. A plain call is the full backup; adding any filter
 * narrows it. Deleting what was backed up is a separate, explicit call — a
 * download that also wipes data on the way out is too easy to fire by accident.
 */
router.get('/export', (req, res) => {
  const filter = filterFrom(req.query);
  if (isNarrowed(filter) && req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Only a Super Admin may take a filtered backup' });
  }

  const { book, selection } = buildWorkbook(filter);
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const scope = filter.tournamentId ?? (isNarrowed(filter) ? 'filtered' : 'full');

  db.insert('Backups', {
    backupId: db.nextId('Backups', 'backupId', 'BACKUP'),
    scope,
    filter,
    counts: summarise(selection),
    bytes: buffer.length,
    createdAt: new Date().toISOString(),
    createdBy: req.user.uid,
    deletedAfterBackup: false,
  });
  log(req, 'backup.export', { scope, filter, bytes: buffer.length });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="veeran-${scope}-${stamp}.xlsx"`);
  res.send(buffer);
});

router.get('/history', (_req, res) => {
  const backups = db
    .all('Backups')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50);
  res.json({ backups });
});

/**
 * Deletes the records a filter selects — the post-backup step. Refuses without
 * an explicit confirm, and reports exactly what it would remove first, so an
 * accidental call cannot take the competition with it.
 */
router.post('/delete', superOnly, (req, res) => {
  const filter = filterFrom(req.body ?? {});
  // 'delete' mode so a filter never removes the context it merely referenced.
  const selection = select(filter, 'delete');
  const summary = summarise(selection);
  const total = summary.reduce((n, s) => n + s.selected, 0);

  if (req.body?.confirm !== true) {
    return res.status(409).json({
      error: `This deletes ${total} record(s). Confirm to proceed.`,
      requiresConfirmation: true,
      summary,
      total,
    });
  }
  if (total === 0) return res.status(400).json({ error: 'That filter selects nothing to delete' });

  const removed = deleteSelection(selection);
  log(req, 'backup.delete', { filter, total, removed });

  if (req.body?.backupId) {
    db.update('Backups', (b) => b.backupId === req.body.backupId, { deletedAfterBackup: true });
  }

  res.json({ removed, total });
});

function parseWorkbook(base64) {
  if (typeof base64 !== 'string' || base64.length === 0) {
    return { error: 'No backup file was uploaded' };
  }

  let book;
  try {
    book = XLSX.read(Buffer.from(base64, 'base64'), { type: 'buffer' });
  } catch {
    return { error: 'That file could not be read as an Excel workbook' };
  }

  const tables = {};
  for (const [sheetName, collection] of Object.entries(SHEETS)) {
    const sheet = book.Sheets[sheetName];
    if (!sheet) continue;
    tables[collection] = XLSX.utils
      .sheet_to_json(sheet, { defval: '', raw: false })
      .map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, decodeCell(k, v)])))
      .filter((row) => Object.values(row).some((v) => v !== null));
  }

  if (Object.keys(tables).length === 0) {
    return { error: `No recognised sheets found. Expected: ${Object.keys(SHEETS).join(', ')}` };
  }
  return { tables };
}

/** Applies the restore filter to the workbook's own rows. */
function narrowTables(tables, filter) {
  if (!isNarrowed(filter)) return tables;

  const { tournamentId, academyId, participantId, from, to } = filter;
  const inDates = (r) => {
    const d = String(r.createdAt ?? '').slice(0, 10);
    if (!from && !to) return true;
    if (!d) return false;
    return (!from || d >= from) && (!to || d <= to);
  };

  const participants = (tables.Participants ?? []).filter(
    (p) =>
      (!tournamentId || p.tournamentId === tournamentId) &&
      (!academyId || (academyId === 'none' ? !p.academyId : p.academyId === academyId)) &&
      (!participantId || p.participantId === participantId) &&
      inDates(p)
  );
  const ids = new Set(participants.map((p) => p.participantId));
  const academyIds = new Set(participants.map((p) => p.academyId).filter(Boolean));

  return {
    ...tables,
    Participants: participants,
    BoutEntries: (tables.BoutEntries ?? []).filter((e) => ids.has(e.participantId)),
    Scores: (tables.Scores ?? []).filter((s) => ids.has(s.participantId)),
    Medals: (tables.Medals ?? []).filter((m) => ids.has(m.participantId)),
    Academy: (tables.Academy ?? []).filter(
      (a) => academyIds.has(a.academyId) || (tournamentId && a.tournamentId === tournamentId)
    ),
  };
}

const KEY_OF = {
  Tournaments: 'tournamentId',
  Academy: 'academyId',
  Participants: 'participantId',
  EventMaster: 'eventId',
  Judges: 'judgeId',
  BoutMaster: 'boutId',
  BoutEntries: 'entryId',
  Scores: 'scoreId',
  Medals: 'medalId',
  AgeCategory: 'ageCategoryId',
  ScoreCategory: 'categoryId',
  PositionMaster: 'positionId',
  LoginMaster: 'uid',
};

/** Dry run: what a restore would add and what it would skip as already present. */
router.post('/preview-restore', superOnly, (req, res) => {
  const parsed = parseWorkbook(req.body?.fileBase64);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const tables = narrowTables(parsed.tables, filterFrom(req.body?.filter ?? {}));
  const summary = Object.entries(tables).map(([collection, rows]) => {
    const key = KEY_OF[collection];
    const existing = new Set(db.all(collection).map((r) => r[key]));
    const duplicates = rows.filter((r) => existing.has(r[key])).length;
    return {
      collection,
      incoming: rows.length,
      duplicates,
      willAdd: rows.length - duplicates,
      current: db.all(collection).length,
    };
  });

  res.json({ summary });
});

/**
 * Restores a workbook.
 *
 * Rows whose key already exists are skipped, never overwritten, so a restore
 * is safe to run twice and cannot silently replace work done since the backup
 * was taken. `deleteBefore` clears the selected records first, which is how you
 * get a true replace; without it the restore is purely additive.
 */
router.post('/restore', superOnly, (req, res) => {
  const parsed = parseWorkbook(req.body?.fileBase64);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const filter = filterFrom(req.body?.filter ?? {});
  const tables = narrowTables(parsed.tables, filter);

  if (req.body?.confirm !== true) {
    return res.status(409).json({ error: 'Confirm to run the restore.', requiresConfirmation: true });
  }
  if (!isNarrowed(filter) && 'LoginMaster' in tables && tables.LoginMaster.length === 0) {
    return res.status(400).json({
      error: 'That backup has no logins. Restoring it would lock everyone out of the system.',
    });
  }

  const before = db.snapshotAll();
  try {
    const deleted =
      req.body?.deleteBefore === true ? deleteSelection(select(filter, 'delete')) : null;

    const result = {};
    for (const [collection, rows] of Object.entries(tables)) {
      if (rows.length === 0) continue;
      result[collection] = mergeSkippingDuplicates(collection, rows);
    }

    log(req, 'backup.restore', { filter, deleteBefore: Boolean(req.body?.deleteBefore), result });
    res.json({ restored: true, deleted, result });
  } catch (err) {
    // Put everything back rather than leave the competition half-restored.
    db.restoreAll(before);
    log(req, 'backup.restoreFailed', { message: err.message });
    res.status(500).json({ error: `Restore failed and was rolled back: ${err.message}` });
  }
});

export default router;
