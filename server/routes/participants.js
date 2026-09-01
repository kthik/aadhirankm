import { Router } from 'express';
import * as db from '../lib/store.js';
import { validate } from '../lib/validate.js';
import { hashPassword, requireAuth } from '../lib/auth.js';
import { config, requireModule } from '../config.js';
import { addEntry, boutIdsFor, eventClashFor, removeEntry } from '../lib/queue.js';
import { currentTournamentId, inScope, scopeFor } from '../lib/tournament.js';

const router = Router();

const PARTICIPANT_RULES = {
  participantName: { required: true, min: 3, label: 'Participant name' },
  fatherName: { required: true, min: 3, label: "Father's name" },
  age: { required: true, type: 'age', label: 'Age' },
  mobile: { required: true, type: 'phone', label: 'Mobile number' },
  address: { required: true, min: 5, label: 'Address' },
  location: { required: true, label: 'Location' },
  events: { required: true, type: 'array', label: 'Events participating' },
};

/** Rejects event codes that are not active in EventMaster. */
function checkEvents(codes) {
  const active = new Set(db.filter('EventMaster', (e) => e.active).map((e) => e.eventId));
  const unknown = codes.filter((c) => !active.has(c));
  return unknown.length ? `Unknown or inactive event(s): ${unknown.join(', ')}` : null;
}

/**
 * Spreadsheet cells hold whatever the coach typed, so accept an event code
 * ("E001"), its full name, or several of either separated by comma/semicolon.
 */
function resolveEvents(cell) {
  if (Array.isArray(cell)) return cell.map(String).map((s) => s.trim()).filter(Boolean);
  const active = db.filter('EventMaster', (e) => e.active);
  const byName = new Map(active.map((e) => [e.name.trim().toLowerCase(), e.eventId]));
  return String(cell ?? '')
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((token) => byName.get(token.toLowerCase()) ?? token.toUpperCase());
}

function createParticipant(values, academyId) {
  const participantId = db.nextId('Participants', 'participantId', 'INDIVIDUAL');
  const participant = {
    participantId,
    academyId,
    ...values,
    tournamentId: currentTournamentId(),
    active: true,
    createdAt: new Date().toISOString(),
  };
  db.insert('Participants', participant);

  const defaultPassword = config().app.defaultPassword;
  db.insert('LoginMaster', {
    uid: participantId,
    password: hashPassword(defaultPassword),
    role: academyId ? 'ACADEMY_PARTICIPANT' : 'INDIVIDUAL',
    refId: participantId,
    name: values.participantName,
    active: true,
    createdAt: participant.createdAt,
  });

  return { participant, credentials: { uid: participantId, password: defaultPassword } };
}

/** Public individual registration: academyId stays null per spec. */
router.post('/individual', requireModule('individualRegistration'), (req, res) => {
  const { ok, values, errors } = validate(req.body, PARTICIPANT_RULES);
  if (!ok) return res.status(400).json({ errors });

  const eventError = checkEvents(values.events);
  if (eventError) return res.status(400).json({ errors: { events: eventError } });

  res.status(201).json(createParticipant(values, null));
});

/**
 * Academy-side direct registration. Mobile/address/location fall back to the
 * academy's own details when the form leaves them blank.
 */
router.post('/academy', requireAuth('ACADEMY'), (req, res) => {
  const academy = db.find('Academy', (a) => a.academyId === req.user.refId);
  if (!academy) return res.status(404).json({ error: 'Academy not found' });

  const merged = {
    mobile: academy.phone,
    address: academy.address,
    location: academy.location,
    ...Object.fromEntries(Object.entries(req.body ?? {}).filter(([, v]) => v !== '' && v != null)),
  };

  const { ok, values, errors } = validate(merged, PARTICIPANT_RULES);
  if (!ok) return res.status(400).json({ errors });

  const eventError = checkEvents(values.events);
  if (eventError) return res.status(400).json({ errors: { events: eventError } });

  res.status(201).json(createParticipant(values, academy.academyId));
});

const COLUMN_TO_FIELD = {
  'participant name': 'participantName',
  "father's name": 'fatherName',
  'fathers name': 'fatherName',
  age: 'age',
  mobile: 'mobile',
  'mobile number': 'mobile',
  address: 'address',
  location: 'location',
  'events participating': 'events',
  events: 'events',
};

/** Maps one spreadsheet row onto participant fields, tolerating header casing. */
function rowToFields(row) {
  const out = {};
  for (const [header, cell] of Object.entries(row ?? {})) {
    const field = COLUMN_TO_FIELD[String(header).trim().toLowerCase()];
    if (field) out[field] = typeof cell === 'string' ? cell.trim() : cell;
  }
  return out;
}

/**
 * Bulk import for an academy. Validates every row first and imports nothing
 * unless all rows pass, so a coach never ends up with a half-loaded roster;
 * rejected rows come back with their spreadsheet row number and field errors.
 */
router.post('/bulk', requireAuth('ACADEMY'), requireModule('bulkUpload'), (req, res) => {
  const academy = db.find('Academy', (a) => a.academyId === req.user.refId);
  if (!academy) return res.status(404).json({ error: 'Academy not found' });

  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows) return res.status(400).json({ error: 'Expected a "rows" array from the upload' });
  if (rows.length === 0) return res.status(400).json({ error: 'The uploaded file has no data rows' });
  if (rows.length > 500) {
    return res.status(400).json({ error: 'Please upload at most 500 rows at a time' });
  }

  const existing = db.filter('Participants', (p) => p.academyId === academy.academyId);
  const seen = new Set(
    existing.map((p) => `${p.participantName.toLowerCase()}|${p.mobile}`)
  );

  const accepted = [];
  const rejected = [];

  rows.forEach((raw, i) => {
    // Row 1 is the header, so the first data row reads as row 2 in the spreadsheet.
    const rowNumber = i + 2;
    const fields = rowToFields(raw);
    const merged = {
      mobile: academy.phone,
      address: academy.address,
      location: academy.location,
      ...Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== '' && v != null)
      ),
      events: resolveEvents(fields.events),
    };

    const { ok, values, errors } = validate(merged, PARTICIPANT_RULES);
    if (!ok) return rejected.push({ row: rowNumber, name: fields.participantName ?? '', errors });

    const eventError = checkEvents(values.events);
    if (eventError) {
      return rejected.push({ row: rowNumber, name: values.participantName, errors: { events: eventError } });
    }

    const key = `${values.participantName.toLowerCase()}|${values.mobile}`;
    if (seen.has(key)) {
      return rejected.push({
        row: rowNumber,
        name: values.participantName,
        errors: { participantName: 'Already registered under this academy' },
      });
    }
    seen.add(key);
    accepted.push(values);
  });

  if (rejected.length) {
    return res.status(400).json({
      error: `${rejected.length} of ${rows.length} rows could not be imported. Nothing was saved — fix these rows and upload again.`,
      rejected,
      importedCount: 0,
    });
  }

  const created = accepted.map((values) => createParticipant(values, academy.academyId));
  res.status(201).json({
    importedCount: created.length,
    rejected: [],
    participants: created.map((c) => ({
      ...c.participant,
      defaultPassword: c.credentials.password,
    })),
  });
});

router.get('/me', requireAuth('INDIVIDUAL', 'ACADEMY_PARTICIPANT'), (req, res) => {
  const participant = db.find('Participants', (p) => p.participantId === req.user.refId);
  if (!participant) return res.status(404).json({ error: 'Participant record not found' });

  const allEvents = db.all('EventMaster');
  const bouts = db.all('BoutMaster');
  const positions = db.all('PositionMaster');
  const judges = db.all('Judges');
  const ages = db.all('AgeCategory');
  const categories = db
    .filter('ScoreCategory', (c) => c.active !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const sheets = db.filter('Scores', (s) => s.participantId === participant.participantId);
  const myBouts = boutIdsFor(participant.participantId)
    .map((id) => bouts.find((b) => b.boutId === id))
    .filter(Boolean);

  // One row per event entered: its bout, and the result if it has been judged.
  //
  // A bout scoped to an event owns that event's row. An unscoped bout covers
  // every event its entrants are in, so its name shows on each of those rows,
  // but its single score is attached to only the first of them — the same sheet
  // repeated down the column would read as several results.
  const claimed = new Set();

  const events = participant.events.map((eventId) => {
    const event = allEvents.find((e) => e.eventId === eventId);
    const scoped = myBouts.find((b) => b.eventId === eventId);
    const bout = scoped ?? myBouts.find((b) => !b.eventId) ?? null;

    const sheet = bout && !claimed.has(bout.boutId)
      ? sheets.find((x) => x.boutId === bout.boutId) ?? null
      : null;
    if (sheet) claimed.add(bout.boutId);

    return {
      eventId,
      name: event?.name ?? eventId,
      category: event?.category ?? null,
      boutName: bout?.boutName ?? null,
      judgeName: sheet ? judges.find((j) => j.judgeId === sheet.judgeId)?.judgeName ?? null : null,
      positionName: sheet
        ? positions.find((x) => x.positionId === sheet.positionId)?.positionName ?? null
        : null,
      total: sheet?.total ?? null,
      scores: sheet?.scores ?? null,
    };
  });

  // Counted from the filed sheets rather than the rows above, so an unscoped
  // bout spanning two events still counts as the one result it is.
  const rankingIds = new Set(positions.filter((x) => x.ranking).map((x) => x.positionId));
  const band = ages.find(
    (c) => c.active !== false && participant.age >= c.minAge && participant.age <= c.maxAge
  );
  const medalSheets = sheets.filter((x) => rankingIds.has(x.positionId));
  const bestPosition = medalSheets
    .map((x) => positions.find((y) => y.positionId === x.positionId)?.positionName)
    .filter(Boolean)
    .sort((a, b) => Number(a) - Number(b))[0] ?? null;

  res.json({
    participant: { ...participant, ageCategoryName: band?.name ?? null },
    events,
    categories,
    stats: {
      events: events.length,
      assigned: events.filter((e) => e.boutName).length,
      judged: sheets.length,
      medals: medalSheets.length,
      bestPosition,
      averageScore:
        sheets.length === 0
          ? null
          : Math.round((sheets.reduce((n, x) => n + x.total, 0) / sheets.length) * 10) / 10,
    },
  });
});

router.put('/me', requireAuth('INDIVIDUAL', 'ACADEMY_PARTICIPANT'), (req, res) => {
  const editable = {
    mobile: PARTICIPANT_RULES.mobile,
    address: PARTICIPANT_RULES.address,
    location: PARTICIPANT_RULES.location,
  };
  const { ok, values, errors } = validate(req.body, editable);
  if (!ok) return res.status(400).json({ errors });

  const participant = db.update('Participants', (p) => p.participantId === req.user.refId, values);
  res.json({ participant });
});

router.get('/', requireAuth('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const scope = scopeFor(req.user);
  const participants = db
    .filter('Participants', (p) => inScope(p, scope))
    .map((p) => ({ ...p, boutIds: boutIdsFor(p.participantId) }));
  res.json({ participants });
});

/**
 * Admin edit from the participant drill-down. Only the fields the drill-down
 * exposes are writable; participantId, academyId and createdAt are not, so an
 * edit can never re-key a row or move it between academies.
 */
router.put('/:participantId', requireAuth('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const participant = db.find('Participants', (p) => p.participantId === req.params.participantId);
  if (!participant) return res.status(404).json({ error: 'Participant not found' });

  const merged = {
    participantName: participant.participantName,
    fatherName: participant.fatherName,
    age: participant.age,
    mobile: participant.mobile,
    address: participant.address,
    location: participant.location,
    events: participant.events,
    ...Object.fromEntries(
      Object.entries(req.body ?? {}).filter(
        ([k, v]) => k in PARTICIPANT_RULES && v !== '' && v != null
      )
    ),
  };

  const { ok, values, errors } = validate(merged, PARTICIPANT_RULES);
  if (!ok) return res.status(400).json({ errors });

  const eventError = checkEvents(values.events);
  if (eventError) return res.status(400).json({ errors: { events: eventError } });

  const updated = db.update(
    'Participants',
    (p) => p.participantId === req.params.participantId,
    values
  );
  res.json({ participant: updated });
});

/**
 * Places participants into a bout, or takes them out of it.
 *
 * A participant holds one entry per bout, so someone entered in several events
 * appears in several bouts; `remove: true` drops just the named bout.
 */
router.post('/assign-bout', requireAuth('ADMIN', 'SUPER_ADMIN'), requireModule('judging'), (req, res) => {
  const ids = Array.isArray(req.body?.participantIds) ? req.body.participantIds : [];
  if (ids.length === 0) return res.status(400).json({ error: 'Select at least one participant' });

  const boutId = req.body?.boutId ?? null;
  if (!boutId) return res.status(400).json({ errors: { boutId: 'Select a bout' } });

  const bout = db.find('BoutMaster', (b) => b.boutId === boutId);
  if (!bout) return res.status(400).json({ errors: { boutId: 'Unknown bout' } });

  const missing = ids.filter((id) => !db.find('Participants', (p) => p.participantId === id));
  if (missing.length) {
    return res.status(404).json({ error: `Unknown participant(s): ${missing.join(', ')}` });
  }

  const removing = req.body?.remove === true;

  // A bout scoped to an event only makes sense for entrants of that event.
  if (!removing && bout.eventId) {
    const wrong = ids.filter((id) => {
      const p = db.find('Participants', (x) => x.participantId === id);
      return !p.events.includes(bout.eventId);
    });
    if (wrong.length) {
      return res.status(400).json({
        error: `Not registered for this bout's event: ${wrong.join(', ')}`,
      });
    }
  }

  if (!removing) {
    const clashes = ids
      .map((id) => {
        const clash = eventClashFor(id, boutId);
        return clash ? `${id} is already in ${clash.boutName} for this event` : null;
      })
      .filter(Boolean);
    if (clashes.length) {
      return res.status(409).json({
        error: `A competitor can only be in one bout per event. ${clashes.join('; ')}.`,
      });
    }
  }

  for (const id of ids) {
    if (removing) removeEntry(boutId, id);
    else addEntry(boutId, id);
  }

  res.json({
    updatedCount: ids.length,
    removed: removing,
    participants: ids.map((id) => ({ participantId: id, boutIds: boutIdsFor(id) })),
  });
});

export default router;
