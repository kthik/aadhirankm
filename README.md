# Veeran — Silambam Competition Management

Mobile-first, no-database competition platform. JSON file storage, config-driven modules,
React SPA + Express API.

**Covered so far: foundation, registration/auth, bulk upload, judging, scoring and the
analytics dashboard.** Live updates, i18n and backup/restore are switched off in config.

## Documentation

Two standalone HTML documents at the project root — open either in a browser, no server
needed. Both follow the app's own day/night tokens.

| File | What it is |
| --- | --- |
| `VEERAN-OPERATING-MANUAL.html` | Step-by-step instructions by role: start the system, first-time setup, registration, bout assignment, judging, medals, backups, moving the database, troubleshooting |
| `VEERAN-FUNCTIONAL-SPEC.html` | What the system does and the rules it enforces: roles, modules, the 15 collections, tournaments, running-order derivation, scoring, storage, backup semantics, validation, API surface |

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
  data/*.json            Local database, and the Drive cache under gdrive. Gitignored.
client/src/
  lib/session.jsx        Session + config context
  components/            Tabs, charts, Field, EventPicker, Modal, BulkUpload,
                         ScoreSheet, JudgeAdmin, AdminAnalytics, ParticipantDrawer
  pages/                 Login, ForgotUid, registration, dashboards
```

## Android app

`veeran-app/` packages the same client as an installable Android app — one copy of the
UI, built by Vite and synced into a Capacitor shell (`webDir` points at
`../client/dist`). See [veeran-app/README.md](veeran-app/README.md) for the build.

```bash
cd veeran-app && npm run apk:debug     # -> android/app/build/outputs/apk/debug/app-debug.apk
```

The app ships the interface, not the data, so it needs the API on the network:

- On first launch the sign-in screen asks for a **server address** (e.g.
  `192.168.1.20:4000`), checks it against `/api/health`, and remembers it.
- The API is then cross-site over plain HTTP, where a session cookie cannot be sent
  (`SameSite=None` requires `Secure`). The app sends the same signed session as an
  `Authorization: Bearer` header instead; `attachUser()` accepts either transport. A
  browser is never issued a token — its session stays in an HTTP-only cookie it cannot
  read — and the token is only returned to a client that identifies itself with
  `X-Veeran-Client: native`.
- CORS allows the shell's own origin plus private-range LAN addresses, which is how a
  phone reaches a laptop at a venue.
- The web view is served from `http://localhost` rather than `https://localhost`, so the
  page and a plain-HTTP API share a scheme and the call is not blocked as mixed content.

## Where the database lives

One switch in `config/app.config.json` decides which database the server runs on:

```json
"storage": {
  "driver": "local",
  "local":  { "dataDir": "server/data" },
  "gdrive": { "dataDir": "Veeran/data", "driveRoot": "", "cache": true }
}
```

| `driver` | The database is |
| --- | --- |
| `"local"` | `storage.local.dataDir` on this machine (default `server/data`), and nothing else |
| `"gdrive"` | `storage.gdrive.dataDir` inside the locally synced Google Drive folder, with the local folder kept as a cache of it |

### Drive as the database, local JSON as cache

Under the `gdrive` driver the app uses both folders. Drive holds the database; the
local folder is a mirror of it:

- **Reads** are served from the local copy, so no request waits on the Drive mount.
  Before each read the Drive file's timestamp is compared with the cached one and
  the newer Drive copy is pulled down - that is how a change another machine synced
  up gets picked up.
- **Writes** go to Drive first, then into the cache. If Drive is unreachable the
  write fails and the request errors: an accepted write that existed only in the
  cache would be lost the moment the cache refreshed. Mirroring into the cache is
  best-effort, since a stale cache self-corrects on the next read.
- **While Drive is offline** reads keep working from the cache and writes are
  refused, so the app stays usable read-only instead of going down.

Set `storage.gdrive.cache` to `false` to read and write the Drive folder directly
with no local copy. The cache folder is `storage.local.dataDir` - the same files the
`local` driver uses as its database, which is what makes flipping the driver cheap.

It ships as `"local"`, so a fresh clone runs with no Drive client installed. Both
blocks stay in the file, so flipping is a one-word edit plus a restart, and the
active driver and resolved folder are printed on boot:

```
Database: gdrive -> C:\Users\me\My Drive\Veeran\data
Local cache: ...\Veeran\server\data
```

Set `driver` to `gdrive` only on a machine that has Drive for desktop: the API exits
at boot when the Drive folder is missing, and with the API down the Vite dev proxy
answers every `/api` call with a 500 - in the browser that looks like a failed login
rather than a storage problem. The API's own console prints the real reason.

`gdrive` needs Google Drive for desktop installed and signed in. The Drive root is
auto-detected (`~/Google Drive/My Drive`, `~/Google Drive`, `~/My Drive`, and the
Drive for desktop virtual drives `G:\My Drive` and up); set
`storage.gdrive.driveRoot` if it is mounted somewhere else. With no Drive folder
found, the server prints what to fix and exits rather than quietly writing a second
copy of the database to local disk. An unknown driver name fails the same way.

**Switching local -> gdrive** copies the local collections into the Drive folder on
the first boot, so the current tournament carries over. It only runs into a Drive
folder that holds no collection file yet, so it can never overwrite live data.
**Switching gdrive -> local** copies nothing - but because the cache folder *is* the
local database, the local files already hold everything the last gdrive session read
or wrote, so the flip lands on current data as long as that session was live.

Env vars override the config file for a one-off run, without editing it:

| Variable | Effect |
| --- | --- |
| `VEERAN_DB_DRIVER=local` | run on the other driver once (e.g. dev on a machine with no Drive) |
| `VEERAN_DATA_DIR=/srv/veeran` | ignore both drivers and use this one folder, uncached |
| `VEERAN_GDRIVE_DIR` | where the synced Drive folder is mounted |
| `VEERAN_CONFIG_PATH` | where `app.config.json` itself lives |

Paths in the config or those vars accept absolute or repo-relative forms, `~`, and
`%VAR%` / `$VAR`. Everything is resolved once at startup; a live swap would split
writes across two databases, so changing the driver needs a restart.

> Drive syncs whole files rather than merging them, so run one server against a Drive
> folder at a time - two writers produce a Drive conflict copy, not a merge.

## Super Admin dashboard

Three tabs of its own, on top of admins, tournaments, backup, logs and events:

- **Overview** - one filter bar (tournament, event, age category, academy, registered
  between two dates) drives every panel below it: headline figures, scoring progress
  split by event / age band / academy, a cumulative registered-vs-scored trend, and a
  card per tournament carrying the same measures for that tournament alone. One
  `/api/dashboard/overview` call feeds all of it, so no two panels can disagree.
  Picking a tournament narrows the page to that card rather than emptying the others.
- **Database** - where the JSON lives, and how to move it. See below.

Every figure is derived per request from participants and their filed sheets, so
nothing here can go stale against the tables it came from.

### Moving the database from the Super Admin screen

The Database tab shows the folder in use, the driver, the local cache (under
`gdrive`), and how many rows and Super Admin logins are in it. Changing location is
deliberately three steps:

1. **Check location** resolves the new spec and reports what is already in that
   folder - nothing is written.
2. **Save location** opens a dialog stating where the data is going, what is there
   now, and asking the one question that matters: *copy the current data across?*
3. The change applies only with the acting Super Admin's own **password**.

The copy question is enforced, not advisory:

| Situation | What happens |
| --- | --- |
| Copy accepted | Every collection is written to the new folder, then the app switches to it |
| Copy accepted, folder already holds data | Blocked until the "will be replaced" box is ticked |
| Copy declined, folder **has** a Super Admin login | Allowed, with an alert that the old data stays behind and is no longer read |
| Copy declined, folder has **no** Super Admin login | **Refused**, in the dialog and again on the server: nobody could sign in afterwards and the real database would be stranded at the old path |

Nothing is ever deleted from the old folder, the switch is logged to System logs, and
the running server repoints without a restart. Environment overrides still win over
the config file, and the panel says so when one is set.

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
