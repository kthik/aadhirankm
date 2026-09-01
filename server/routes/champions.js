import { Router } from 'express';
import * as db from '../lib/store.js';
import { requireAuth } from '../lib/auth.js';
import { requireModule } from '../config.js';
import { currentTournamentId } from '../lib/tournament.js';

const router = Router();

router.use(requireAuth('ADMIN', 'SUPER_ADMIN'), requireModule('scoring'));

const MEDAL_FOR = { 1: 'Gold', 2: 'Silver', 3: 'Bronze' };

/**
 * Medal winners, grouped by bout.
 *
 * A champion is a filed sheet whose position is one of the ranking positions in
 * Position Master. Issuance lives in its own `Medals` record rather than on the
 * score, so handing out the medal is an administrative act with its own audit
 * trail and cannot be undone by a judge revising a sheet.
 */
router.get('/', (_req, res) => {
  const bouts = db.all('BoutMaster');
  const events = db.all('EventMaster');
  const participants = db.all('Participants');
  const judges = db.all('Judges');
  const positions = db.all('PositionMaster');
  const medals = db.all('Medals');
  const scores = db.all('Scores');

  const ranking = new Map(
    positions.filter((p) => p.ranking).map((p) => [p.positionId, p.positionName])
  );

  const groups = bouts
    .map((bout) => {
      const winners = scores
        .filter((s) => s.boutId === bout.boutId && ranking.has(s.positionId))
        .map((s) => {
          const place = ranking.get(s.positionId);
          const issued = medals.find(
            (m) => m.boutId === s.boutId && m.participantId === s.participantId
          );
          const p = participants.find((x) => x.participantId === s.participantId);
          return {
            participantId: s.participantId,
            participantName: p?.participantName ?? s.participantId,
            academyId: p?.academyId ?? null,
            place,
            medal: MEDAL_FOR[place] ?? place,
            total: s.total,
            judgeName: judges.find((j) => j.judgeId === s.judgeId)?.judgeName ?? s.judgeId,
            issued: Boolean(issued),
            issuedAt: issued?.issuedAt ?? null,
            issuedBy: issued?.issuedBy ?? null,
          };
        })
        .sort((a, b) => Number(a.place) - Number(b.place) || b.total - a.total);

      return {
        boutId: bout.boutId,
        boutName: bout.boutName,
        eventId: bout.eventId ?? null,
        eventName: events.find((e) => e.eventId === bout.eventId)?.name ?? null,
        winners,
        issued: winners.filter((w) => w.issued).length,
      };
    })
    .filter((g) => g.winners.length > 0);

  const all = groups.flatMap((g) => g.winners);
  res.json({
    groups,
    totals: {
      medals: all.length,
      issued: all.filter((w) => w.issued).length,
      pending: all.filter((w) => !w.issued).length,
      gold: all.filter((w) => w.place === '1').length,
      silver: all.filter((w) => w.place === '2').length,
      bronze: all.filter((w) => w.place === '3').length,
    },
  });
});

/**
 * Records a medal as handed over. Deliberately one-way: the admin confirms in
 * the UI, and after that the record stands rather than being toggled back and
 * forth on a podium.
 */
router.post('/issue', (req, res) => {
  const boutId = String(req.body?.boutId ?? '').trim();
  const participantId = String(req.body?.participantId ?? '').trim();

  const score = db.find(
    'Scores',
    (s) => s.boutId === boutId && s.participantId === participantId
  );
  if (!score) return res.status(404).json({ error: 'No scored result for that competitor in that bout' });

  const position = db.find('PositionMaster', (p) => p.positionId === score.positionId);
  if (!position?.ranking) {
    return res.status(400).json({ error: 'That result is not a medal position' });
  }

  const already = db.find(
    'Medals',
    (m) => m.boutId === boutId && m.participantId === participantId
  );
  if (already) return res.status(409).json({ error: 'That medal is already recorded as issued' });

  const medal = db.insert('Medals', {
    medalId: `${boutId}-${participantId}`,
    tournamentId: db.find('BoutMaster', (b) => b.boutId === boutId)?.tournamentId ?? currentTournamentId(),
    boutId,
    participantId,
    eventId: db.find('BoutMaster', (b) => b.boutId === boutId)?.eventId ?? null,
    positionId: score.positionId,
    place: position.positionName,
    medal: MEDAL_FOR[position.positionName] ?? position.positionName,
    issued: true,
    issuedAt: new Date().toISOString(),
    issuedBy: req.user.uid,
  });

  res.status(201).json({ medal });
});

export default router;
