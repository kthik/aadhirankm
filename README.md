# Veeran — Silambam Competition Management

Mobile-first, no-database competition platform. JSON file storage, config-driven modules,
React SPA + Express API.

**Covered so far: foundation, registration/auth, bulk upload, judging, scoring and the
analytics dashboard.** Live updates, i18n and backup/restore are switched off in config.

## Run it

```bash
npm run install:all   # installs root, server and client deps
npm run dev           # API on :4000, web on :5173
```

Open http://localhost:5173. For a single-process production run:

```bash
npm run build && npm start   # server serves client/dist on :4000
```

## Seeded accounts

Created on first boot, password `pass@123`:

| UID | Role |
| --- | --- |
| `SA001` | Super Admin |
| `AD001` | Admin |

Six Silambam events (`E001`–`E006`) are seeded into `EventMaster`. Academies and
participants are created through the registration screens, which issue `A00n` / `P00n`
UIDs with the same default password.

## Layout

```
config/app.config.json   Single source of truth: modules, roles, ID prefixes, validation
server/
  config.js              Config loader + requireModule() route guard
  lib/store.js           JSON collection store (atomic writes, sequential IDs)
  lib/auth.js            scrypt hashing, HMAC session cookies, role guards
  lib/validate.js        Declarative field validation, returns per-field errors
  routes/                auth, academies, participants, events, judges, scores,
                         masters (age/score categories, bouts), dashboard (analytics)
  data/*.json            The database. Seeded on first boot, gitignored.
client/src/
  lib/session.jsx        Session + config context
  components/            Tabs, charts, Field, EventPicker, Modal, BulkUpload,
                         ScoreSheet, JudgeAdmin, AdminAnalytics, ParticipantDrawer
  pages/                 Login, ForgotUid, registration, dashboards
```

## Plug and play

`config/app.config.json` is re-read every second, so toggling a module takes effect
without a restart. A disabled module is enforced on both sides: the API 404s its routes
via `requireModule()`, and the SPA hides its links and redirects its routes.

```json
"modules": { "academyRegistration": true, "judging": true, "analytics": false }
```

Roles, their dashboard homes, ID prefixes (`A`, `P`, `E`…) and validation rules
(phone pattern, age range) live in the same file.

## Implemented flows

- **Academy registration** — creates the `Academy` row plus a `LoginMaster` entry with
  role `ACADEMY`, then shows the generated UID and default password.
- **Individual registration** — same, with `academyId: null` and role `INDIVIDUAL`.
- **Academy direct registration** — academy ID comes from the session; mobile, address
  and location pre-fill from the academy and are editable per participant.
- **Academy bulk upload** — download an .xlsx template (with an Event Codes reference
  sheet), fill one row per participant, upload. The Events column accepts codes, full
  event names, or a comma/semicolon list of either; blank Mobile/Address/Location inherit
  the academy's. Import is all-or-nothing: if any row fails, nothing is saved and every
  bad row comes back with its spreadsheet row number and field errors. Duplicates
  (same name + mobile under that academy) are rejected, and the batch cap is 500 rows.
- **Forgot UID** — requires academy name + coach name + phone to all match, so the
  endpoint cannot be used to enumerate academies; otherwise it says to contact an Admin.
- **Login / logout / change password** — HTTP-only signed session cookie, 8-hour expiry.
  Accounts still on `pass@123` see a banner prompting a reset.
- **Judge creation and editing (Admin)** — judge name, academy, location, address,
  mobile and one or more bouts. A judge may hold several bouts and gets a tab per bout on
  their dashboard; a bout still belongs to exactly one judge. Clicking a judge opens a
  drawer with their bouts, the sheets they have filed, and an edit form.
- **Judge deactivate and delete** — both hand back every bout the judge has **not
  finished**, so it shows as unassigned and an admin can reassign it. A bout they did
  finish keeps their id, because that is the record of who scored those results; deleting
  a judge with finished bouts asks for confirmation first and never deletes the sheets
  themselves. Deactivating also blocks their sign-in; reactivating restores the sign-in
  but not the bouts, which may already belong to someone else.
- **Bout assignment** — a bout belongs to exactly one judge. Assigning a bout that is
  already held is refused with `requiresConfirmation`, which raises the admin's
  confirmation alert; confirming resets the previous judge's bout link before the new
  judge claims it, so a bout is never held twice.
- **Participant to bout** — Admin places participants into a bout, which is what makes
  them visible to the judge holding it.
- **Judge running order** — the judge sees only their own bout's event, even for a
  competitor entered in several. Order is: competitors entered in more events first (so
  they have time to prepare for their next event), then queue number, with scored rows
  dropping to the bottom. Progress metrics show total assigned, completed performances,
  and the percentage closed with a 1st/2nd/3rd position.
- **Concurrent performances** — someone due in two bouts at once performs in one of
  them; the other judge sees them as **In other performance**, greyed out and not
  clickable, until the first bout files a score. The API refuses the write too, so a
  stale page cannot score around it.
- **Scoring** — clicking a participant opens the score sheet. Categories load from Score
  Category Table (capped at 5 by config) and positions from Position Master
  (Disqualified, Absent, 1-4). Submitting returns to the dashboard with progress updated;
  re-opening a scored participant pre-fills the sheet, so submit doubles as revise.
- **Bout creation & categorisation** — Admin creates bouts, optionally scoped to an
  event and an age group; a bout's eligible list is then the participants who match
  both and are not already in another bout.
- **Age & score categories** — age categories are non-overlapping ranges, so a
  participant's band is derived from their age rather than stored: editing a range
  re-categorises everyone. Score categories are capped at five, enforced on create and
  on re-activation.
- **Analytics** — overall progress (participants, events, bouts, judges active,
  completion %), event cards (entered / scored / waiting, average score, podium), a bout
  grid, and per-judge completion and average score.
- **Detail drawers** — clicking an academy, participant or judge name opens their full
  record: an academy's squad, progress and sign-in, a participant's event history and
  every judge's sheet, a judge's bouts and filed sheets. Participants and judges are
  editable from their drawer.
- **Academy sign-in (Admin)** — the drawer shows the academy's UID, whether they are
  still on the default password, and when they last signed in, with a reset. Leaving the
  field blank puts them back to `pass@123`; typing one sets it. The new password is
  returned once so the admin can read it to the coach, and stored hashed — the old one is
  never recoverable, because it was only ever a hash.
- **Participants tab** — filters by search, event, academy, bout and assignment state,
  with row selection for bulk add/remove against a bout.
- **Filtered list & export** — filter by event, age group, bout, judge, completion status
  or free text; every filter re-queries the server, and the CSV export writes exactly the
  rows on screen. A competitor entered in several events gets **one row per event**, all
  sharing their registration ID, each showing that event's own bout and result; filtering
  by event narrows to that event's rows rather than showing every event of anyone who
  entered it.
- **Champions** — medal winners grouped by bout, with gold/silver/bronze totals. Each
  winner has an *issued* checkbox: ticking it asks for confirmation, then records the
  handover with who issued it and when, and locks the box. Issuing is deliberately
  one-way — handing over a medal is a physical act, not a toggle — and lives in its own
  `Medals` record, so a judge revising a sheet cannot undo it.
- **Age category drill-down** — clicking a category name lists everyone whose age falls
  in that band, with their events, bouts and scoring status.
- **Dashboards** — Academy (register, bulk upload, roster, reset password), Participant
  (entries, profile update), Admin (academies, participants, bouts, judges, bout
  assignment), Super Admin (activate and deactivate events; a deactivated event is
  rejected at registration), Judge (bout, roster, scoring).

## Language

English and Tamil, switched under the settings gear. `lib/i18n.jsx` holds the
dictionary and a `t(key, fallback)` helper: a key with no Tamil string falls back to the
English text rather than showing the key, so an untranslated corner degrades to readable
English instead of breaking.

**Interface text is translated; data is not.** An academy named "Veeran Academy" and an
event named "Maankombu" read the same in both languages — translating a competitor's
name would be wrong, and translating an event name would break the code that matches on
it. Coverage is the chrome, navigation, statuses, table headers, stat labels and the
sign-in screen; deeper admin copy still falls back to English.

## Day and night

`client/src/styles.css` is a token system: every colour is declared three times —
once on bare `:root` for day, then again for night under both
`prefers-color-scheme: dark` and an explicit `:root[data-theme="dark"]` stamp, so the
in-app choice wins in either direction. Nothing below the token blocks hard-codes a
colour, which is enforceable by grep.

`lib/theme.jsx` holds the preference (day / night / auto), stamps `<html data-theme>`,
and remembers the choice in `localStorage` — wrapped in try/catch, since storage throws
in a private window. "Auto" removes the stamp and keeps tracking the OS while the page is
open. A four-line inline script in `index.html` applies the saved choice before first
paint, so a viewer whose choice differs from their OS never sees the wrong theme flash.
The switch lives under the settings gear alongside language; the signed-out screens carry
the same gear without the password section.

Both themes were checked rather than eyeballed. All 30 text/background pairs clear WCAG
AA at 4.5:1 — the day accent and the sequential ramp were re-stepped to get there — and
the chart palettes are validated per surface (adjacent CVD ΔE 24.7 day / 26.8 night).

Uses `color-mix()` and `:has()`, so it wants a 2023-or-later browser.

## Dashboard layout

Every dashboard is a stat row plus a section rail. On screens 900px and wider the rail is
**vertical** and sticky beside the content, so the whole set of sections stays visible and
the active one does not move as panels change; below that it folds into a horizontal
scroller, where a phone has width to spare and height to save. The active item is marked
by a sliding accent rail rather than a fully repainted row, which keeps a long list calm.

`components/Tabs.jsx` calls a tab's `render()` only while it is active, so the bulk
uploader's 428 kB chunk is not fetched until the Bulk upload tab is opened. Tabs whose
module is disabled are dropped from the rail.

Tabs that hold both a create form and its list use `components/Collapsible.jsx` — a
`<details>` card, so open/close and keyboard access come from the browser. Bouts folds
into create / assign / list, Judges into create / list, Events into create / list, and
Categories into events / age / score.

Password reset lives behind the settings gear in the top bar, beside Sign out, rather
than as a tab on each dashboard — every role shares it.

## Bouts and performance order

A competitor entered in several events belongs in one bout per event, so the
participant-to-bout link is a row in `BoutEntries`, not a field on the participant.
(Participants used to carry a single `boutId`; `lib/queue.js` migrates it on boot and
clears the old field, so there is one source of truth.)

Nothing about running order is stored — `lib/queue.js` derives it from entries plus the
filed scores, so no status can go stale:

- **Active bout.** Of a competitor's unscored entries, the one with the lowest queue
  number runs first, lower bout id breaking a tie. Both are fixed at assignment, so a row
  cannot flip between states because somebody else was scored.
- **Status.** `scored` in this bout, `ready` if this is their active bout, otherwise
  `blocked` — shown to the judge as *In other performance* and refused by
  `POST /api/scores`.
- **Order.** More events first, then queue number, then scored rows last.

A bout scoped to an event only accepts entrants of that event, and only that event's
name is shown to its judge. A competitor may hold **at most one bout per event** — two
bouts for the same event would mean being judged twice for it — enforced on assignment.

## Tournaments

Every competition record — academies, participants, judges, bouts, entries, scores,
medals — carries a `tournamentId`. `lib/tournament.js` seeds a first tournament on boot
and tags anything untagged, so switching this on over a running competition does not
orphan its data.

- **Auto-deactivation.** A tournament switches itself off once its end date passes. The
  sweep runs on boot, on a timer (`tournaments.checkIntervalHours`), and on demand from
  the dashboard. End dates are inclusive — a tournament ending today is still running.
  Reactivating a finished tournament is refused rather than quietly undone by the next
  sweep; the admin is told to extend the end date instead.
- **Admin privileges.** An Admin can be narrowed to named tournaments; their dashboards,
  lists and analytics then show only those. An admin with none listed is unrestricted,
  which is how every admin behaved before tournaments existed. Super Admin always
  overrides the restriction, as the spec requires.

## Admin management

Super Admin creates, edits, deletes and password-resets Admin accounts, and assigns each
one its tournaments. A new admin gets the default password unless one is set. Deleting
the last active admin asks for confirmation first. Passwords are shown once on creation
or reset and stored hashed — there is no way to read an existing one back.

## System logs

`lib/audit.js` keeps an append-only record of administrative actions: account changes,
tournament switches, backups, deletes and restores. Routine reads are not logged, and no
password is ever written to it — a reset records that it happened, never the value.

## Backup and restore

`/api/backup` exports the competition as one Excel workbook, a sheet per table. Lists and
score maps are written as JSON text in their cell, so a round trip is lossless; only
genuinely numeric fields (`age`, `total`, `queueNo`, `order`, `minAge`, `maxAge`) parse
back as numbers, which keeps a mobile number from becoming an integer.

**Scope.** A plain export is the full backup; a filter narrows it by tournament, academy,
participant or date range. Admin may take the full backup; the filtered variants, the
deletes and the restore are Super Admin only, because each of those can remove live data.

**Backup and delete are separate actions.** A download that also wipes data on the way out
is far too easy to fire by accident, so deleting what you backed up is its own call,
reports exactly what it would remove, and refuses without an explicit confirm.

**Backup and delete read a filter differently, on purpose.** A backup of one competitor
carries their academy, bout and judge so the file makes sense on its own; deleting that
competitor must *not* take their academy and judge with them. `select(filter, mode)`
returns context under `'backup'` and only owned rows under `'delete'` — an academy is
owned by an academy or tournament filter, judges and bouts only by a tournament filter.

**Restore skips duplicates, never overwrites.** A row whose key already exists is left
alone, so a restore is safe to run twice and cannot silently replace work done since the
backup was taken. The preview shows incoming / duplicates / will-add per table before
anything is written. `deleteBefore` clears the matching records first for a true replace.
A failure part-way through rolls every table back.

## Dashboard metrics

Every role dashboard opens on figures, not a form:

- **Admin** — participants, events, bouts, judges active, completion %, average score;
  event cards, the bout grid and per-judge throughput.
- **Academy** — squad size, event entries, how many are in a bout, scored %, medals and
  average score; entries per event with a scored/waiting split, events-entered per
  competitor, and the academy's podium.
- **Participant** — events entered, judged, medals, best position, average score and age
  group; a per-category score breakdown for each judged event.
- **Judge** — assigned, completed and blocked across all their bouts, then per bout:
  scored/pending, podium closed, and a scored-versus-waiting bar above the running order.

## Charts

`components/charts.jsx` draws with plain HTML and CSS custom properties — the app takes
on no charting dependency, and switching day/night re-themes every chart with no code
change. The two-series palette (`--series-1` completed, `--series-2` waiting) is
re-stepped per theme and validated against each surface: adjacent CVD ΔE 24.7 day /
26.8 night, normal-vision ΔE 33.6 / 31.8, everything clear of 3:1 contrast.

The bout grid deliberately departs from the green/amber/red the spec asked for. Red and
green sit ΔE 4.1 apart under deuteranopia — the two states most worth distinguishing
would have been the two hardest to tell apart. Completion is a magnitude, so the grid
uses a single-hue sequential ramp and prints the percentage and state in every cell,
leaving colour to reinforce a value that is already legible without it.

## Notes on the data layer

`server/data/` holds one JSON file per collection. Writes go through a temp file and a
rename, so a crash cannot leave a truncated document. Sequential IDs are derived by
scanning existing rows rather than from a counter file, so restoring a snapshot cannot
desynchronise the sequence. This is fine for a single-node competition; it is not safe
for multiple server processes writing at once.

Judging adds three reference collections — `BoutMaster`, `ScoreCategory` and
`PositionMaster` — seeded on first boot. Seeding fills a collection that is missing *or*
empty, so enabling the feature on an existing install picks up the new masters without
touching rows already on disk. Scores live in their own `Scores` collection keyed by
judge and participant rather than being written onto the participant row, which keeps one
judge's sheet from colliding with another's and leaves the registration data untouched.

The spreadsheet is parsed in the browser and posted as JSON rows, so the API needs no
file-upload middleware. `xlsx` is lazy-loaded as its own 428 kB chunk that only academy
dashboards fetch, keeping the main bundle at ~194 kB.

Set `VEERAN_SECRET` in the environment before deploying — without it, session cookies
are signed with a fixed development key.
