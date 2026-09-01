import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';

import { config, ROOT } from './config.js';
import * as db from './lib/store.js';
import { attachUser } from './lib/auth.js';
import { seeds } from './seed.js';
import { migrateJudgeBouts, migrateLegacyBoutIds } from './lib/queue.js';
import { autoDeactivateExpired, ensureTournament } from './lib/tournament.js';
import { config as appConfig } from './config.js';

import authRoutes from './routes/auth.js';
import academyRoutes from './routes/academies.js';
import participantRoutes from './routes/participants.js';
import eventRoutes from './routes/events.js';
import judgeRoutes from './routes/judges.js';
import scoreRoutes from './routes/scores.js';
import masterRoutes from './routes/masters.js';
import dashboardRoutes from './routes/dashboard.js';
import backupRoutes from './routes/backup.js';
import championRoutes from './routes/champions.js';
import tournamentRoutes from './routes/tournaments.js';
import adminRoutes from './routes/admins.js';
import logRoutes from './routes/logs.js';

db.ensureSeed(seeds());

// Participants used to carry a single boutId; entries replace it so someone
// entered in several events can sit in a bout per event.
const migrated = migrateLegacyBoutIds();
if (migrated) console.log(`Migrated ${migrated} participant(s) to bout entries`);

// Judges used to hold exactly one bout; boutIds lets them hold several.
const judgesMigrated = migrateJudgeBouts();
if (judgesMigrated) console.log(`Migrated ${judgesMigrated} judge(s) to multi-bout`);

// Every competition record belongs to a tournament; data that predates them is
// filed under a first tournament created here.
const { tournamentId, tagged } = ensureTournament();
if (tagged) console.log(`Tagged ${tagged} record(s) with tournament ${tournamentId}`);

// The end-date sweep runs on boot and then on the configured interval, so a
// long-running server switches off a finished tournament without a restart.
const expired = autoDeactivateExpired();
if (expired.length) console.log(`Auto-deactivated expired tournament(s): ${expired.join(', ')}`);

const everyHours = appConfig().tournaments?.checkIntervalHours ?? 24;
setInterval(() => {
  const off = autoDeactivateExpired();
  if (off.length) console.log(`Auto-deactivated expired tournament(s): ${off.join(', ')}`);
}, Math.max(everyHours, 1) * 60 * 60 * 1000).unref();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: process.env.WEB_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());
app.use(attachUser);

/** The client reads this to hide UI for modules that are switched off. */
app.get('/api/config', (_req, res) => {
  const { app: meta, modules, roles, theme, validation, scoring } = config();
  res.json({
    app: { name: meta.name, tagline: meta.tagline, defaultLanguage: meta.defaultLanguage },
    modules,
    roles,
    theme,
    validation,
    scoring,
  });
});

app.get('/api/health', (_req, res) => res.json({ ok: true, at: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/academies', academyRoutes);
app.use('/api/participants', participantRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/judges', judgeRoutes);
app.use('/api/scores', scoreRoutes);
app.use('/api', masterRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/champions', championRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/admins', adminRoutes);
app.use('/api/logs', logRoutes);

// Serve the built SPA when it exists, so `npm run build && npm start` is one process.
const dist = path.join(ROOT, 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

app.listen(PORT, () => {
  console.log(`Veeran API listening on http://localhost:${PORT}`);
});
