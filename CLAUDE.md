# LiveRun — Claude Code Guide

## What This App Is

A web app for planning and running model railway operating sessions. Features: visual stringline (time-distance) graph, timetable/station/train/crew management, CATS XML export, live REST API for guard panels/JMRI, and real-time MQTT fast-clock sync. No authentication — designed for trusted LAN environments.

## Tech Stack

- **Frontend:** React 18 + TypeScript 5 (strict), Vite 5, Tailwind CSS 3 (dark theme, custom `surface-` palette)
- **Backend:** Node.js 20, Express 4 (flat route handlers in `server/index.js`, no router framework)
- **Database:** Single JSON file (`server/data/train-graph.json`). Atomic writes via tmp→rename. All data loaded in memory per request.
- **Real-time:** MQTT (`mqtt` library) for fast-clock sync; WebSockets (`ws`) for live station feed and completion sync

## Key Files

| File | Role |
|------|------|
| `server/index.js` | All Express routes, WebSocket handler, MQTT lifecycle, auto-assign algorithm, import/export (~1420 lines) |
| `server/db.js` | DB layer: `readDB()`, `writeDB()`, `getTimetable(id)`, `mutateTimetable(id, fn)` |
| `server/openapi.js` | OpenAPI 3.0 spec (served at `/api/schema`, UI at `/api/docs`) |
| `server/layout.js` | Layout-wide config routes: `GET/PUT /api/layout` (validation, see `register()`) |
| `server/sync.js` | `/api/live/sync` WebSocket: `hello`/`completions`/`timetable-updated`/`timetable-deleted`/`active-changed`, per-timetable coalescer, heartbeat |
| `client/src/hooks/useLiveTimetable.ts` | Holds a timetable live: sync WS, rev checks, re-fetch on change/reconnect/wake. Used by CrewMobile and the guard panel |
| `client/src/lib/jobDiff.ts` | `diffJobs()` (added/removed/reassigned/retimed/renamed per crew) + `describeJobChange()` |
| `client/src/lib/mode.ts` | Entry routing: `resolveMode()` (planner / crew / guard / mode picker), saved mode, `switchMode()`; mobile views: `resolveMobileView()` (`liverun.mobileView`, `?view=jobs\|board`), `changeMobileView()` |
| `client/src/lib/stops.ts` | `runningOrder()`/`inRunningOrder()` (stored station order → running order), `sequenceStops()` (midnight-safe), `currentStop()`, run-order helpers |
| `client/src/components/guard/` | Guard panel at `/guard` (`GuardPanel.tsx`, `StopTable.tsx`, `CrewPicker.tsx`, `DoorsCard.tsx`) |
| `server/sounds.js` | Sound library `/api/sounds` (list/serve/upload/delete; name + magic-byte checks; seeds `server/default-sounds/` into `<data>/sounds` on first start) |
| `client/src/hooks/useJmriThrottle.ts` | Browser → JMRI JSON throttle: acquire/release by roster name, heartbeat, reconnect, reported F states. Never queues commands |
| `client/src/hooks/useProfileActions.ts` | Runs train-profile actions (on/off/toggle/pulse/hold/on_for) via `lib/actionRunner.ts` |
| `client/src/lib/profiles.ts` | `resolveProfile()` (first glob match on `train_id`, else fallback) and `resolveAction()` (F-number or roster label → fn, with skip reasons) |
| `client/src/lib/boarding.ts` | Pure boarding model: demand curve, rules, `sampleCount()`, `createBoardingRun()` run-down state machine |
| `client/src/lib/sound.ts` | `playSound()` via the shared Web Audio context (unlocked by Tap to start) |
| `client/src/components/layout/` | Layout settings sections (JMRI, Guard, Train profiles, Boarding, Stats, Guard events, Limit of authority, Sound library) |
| `client/src/lib/guardEvents.ts` | Pure guard-event engine: `rollEvents`/`reconcileRolled` (once per run, survives Control re-saves), `onDoor`/`tick` scheduler (station = door trigger + real-time delay; en-route = fraction of section run time from actual departure, dropped if the train stops first) |
| `client/src/hooks/useGuardEvents.ts` | Guard panel wiring: per-train rolled state + un-ACKed banner queue in localStorage, 1 s tick |
| `server/events.js` | Validation for `TrainStop.guard_events` placements and `layout.events` library |
| `server/loa-cache.js` | LOA topic cache: one server MQTT client on the active timetable's broker, subscribed to every `layout.loa` topic; `GET /api/loa/values`; snapshot + 100 ms deltas via `sync.js`. `refresh()` after layout / active-timetable changes |
| `server/loa.js` | Validation for `layout.loa` (sections, conditions, selectors) |
| `client/src/lib/loa.ts` | Pure LOA engine: `sectionsForTrain()` (from→to pairing on station names), `evaluateElement()` (selectors), `stepLoa()` latch (unknown/await/granted/complete), driven only by topic values |
| `client/src/hooks/useLoa.ts` | Guard panel LOA state per train in localStorage (`guard:loa:<tt>:<train>`), `reset` |
| `docs/layout.example.json` | Example layout config — the only place Illawarra-specific values (LOA sections) live |
| `client/src/components/ChangeToasts.tsx` | Reusable toast stack + `useToasts()` (with history) |
| `server/migrations.js` | Pure startup migrations (e.g. `stripTrainType`), called from `server/index.js` |
| `client/src/App.tsx` | Root component — single source of truth for all UI state (~1100 lines) |
| `client/src/types.ts` | All TypeScript domain types |
| `client/src/api.ts` | Typed fetch client (all API calls) |
| `client/src/utils.ts` | Time conversion, `exportCatsXml()`, `exportCrewsXml()`, `escapeXml()`, `useLocalStorage()`, `stationNameStyle()` |
| `client/src/components/Sidebar.tsx` | Left panel: timetable list, station manager, train list/search, crew manager |
| `client/src/components/TrainEditor.tsx` | Train form modal — stops, path template, color picker |
| `client/src/components/TrainGraph.tsx` | SVG stringline — pan/zoom (8x max), hover tooltips, branch grouping; ✎ Edit (off on load): drag a train or a stop's dwell handle; moves are drafts until Done → `onTrainTimesCommit` (one undo step), Cancel discards. Never changes running times |
| `server/retime.js` | `POST /api/timetables/:id/trains/retime`: graph edits — times only, matched by station, all-or-nothing (409 if a train's stops changed), one mutation |
| `client/src/lib/trainDrag.ts` | Pure graph-edit maths: `shiftStops()` (whole train), `changeDwell()` (one dwell, later stops follow, ≥ 0), midnight-safe, running order |
| `client/src/components/StationReport.tsx` | A5 printable arrival/departure register |
| `client/src/components/CrewMobile.tsx` | Running board: owner's mobile view of everything running and when; run/complete marking; Requested badge; View button (☰ change view) |
| `client/src/components/MobileRoot.tsx` + `MobilePicker.tsx` | `…/mobile` entry: picks Crew jobs or Running board (saved per device) |
| `client/src/components/jobs/` | Crew jobs (`CrewJobs.tsx`, `JobCard.tsx`, `CrewPicker.tsx`), path request form and cards (`RequestForm.tsx`, `RequestCard.tsx`). Read-only for jobs; no run-state controls, no `guard_events` |
| `client/src/components/requests/` | Control's Requests drawer (`RequestsDrawer.tsx`: queue, acknowledge/accept/decline/cancel decisions) and the audit log tab (`AuditLog.tsx`) |
| `client/src/components/PlottingBar.tsx` | Edit bar while plotting a request's draft train on the graph (crew, note, Edit stops, Accept/Cancel) |
| `server/path-requests.js` | Path requests: `GET/POST …/path-requests`, per-request actions, accept (creates the train), cancel-ask/approve/reject, `DELETE ?closed=true`. Pure `validateSubmit`/`transition`/`planAccept` exported for tests |
| `server/audit.js` | Path-request audit log: append-only `<data>/audit.jsonl`, `GET /api/audit` (filters, `format=csv`); `summariseTrain()` |
| `server/trains.js` | `newTrain()`: train construction shared by `POST /trains` and accept, so both apply the same normalisation and terminal-stop rules |
| `server/request-settings.js` | Validation for the path-request keys of `PUT /api/timetables/:id/settings` |
| `client/src/lib/pathRequests.ts` | Pure helpers for the Crew jobs request form and request cards: submit body, status text, labels |
| `client/src/lib/pathPlan.ts` | Draft train for a request: one path covering it, else chained path legs (median), else path legs + timetabled trains' consecutive-stop running times for pairs no path has (fewest train legs; request-made trains ignored), else `request_default_leg_min`; `describeSource()` for the "times from" line (Vitest) |
| `client/src/lib/plotting.ts` | Plotting helpers: `draftFromRequest()`, `retimeFromDrafts()`, `plotRequestState()`, `plotWarnings()`; `pendingTrainId()` (in pathPlan.ts) gives the draft's id |
| `client/src/lib/requestQueue.ts` | Planner-side helpers for the request queue: request summaries and toast text |
| `client/src/lib/auditView.ts` | Audit log view model: filters and row labels; reads the server's `detail` defensively |
| `client/src/lib/device.ts` | `deviceId()` (random per browser, `liverun.deviceId`), `setClockHint()`, `auditHeaders()` sent as `X-LiveRun-Device` / `X-LiveRun-Clock` |
| `client/src/hooks/useFastClock.ts` | Browser MQTT subscriber for live clock |
| `client/src/hooks/useJmriRoster.ts` | Fetches and caches the JMRI roster for Train ID suggestions |
| `client/src/lib/jmri.ts` | JMRI roster helpers (HTTP base from WS URL, normalise, rank matches) |
| `client/src/components/RosterCombobox.tsx` | Train ID combobox fed by the JMRI roster |
| `docs/guard-panel-spec.md` | Guard panel design spec — source of truth for the v2 work |
| `docs/user-guide/` | User guide (Markdown on GitHub): index, planner, running a session, layout settings, guard panel, crew view, LOA, integrations, troubleshooting; images in `images/` |
| `scripts/docs/screenshots.js` | `npm run docs:screenshots` — regenerates the guide's images on a throwaway stack (aedes broker, mock JMRI, temp DB, Vite dev) seeded from `docs/user-guide/demo/`; `--serve` keeps it up, `--list`, glob filters |
| `client/src/lib/help.ts` | `HELP_BASE` / `helpUrl()` — the in-app Help links (planner header, guard ☰, crew view, crew jobs) |

## Data Model (types.ts)

```
Timetable: id, name, description, start_time, end_time, active?, stations[], trains[], paths[], crews[], path_requests[], settings
Station:   id, timetable_id, name, short_code, distance (display label), graph_pos (Y-axis), sort_order, branch_name, alias_enabled?, bold_name?, italic_name?, underline_name?
Train:     id, timetable_id, name, color, notes, train_id?, direction?, crew_id?, status? ('running'|'completed'), request_id? (set when made by accepting a path request), stops[]
PathRequest: id, timetable_id, crew_id, loco?, stops[] (kind stop|shunt|work, minutes, location_alias?), ready_at?, notes?, status (pending|in_review|accepted|declined|withdrawn|cancelled), control_note?, train_id_created?, assigned_crew_id?, cancel_ask?  — spec: docs/path-requests-spec.md
TrainStop: id, train_id, station_id, arrival (HH:MM|null), departure (HH:MM|null), special_instructions?, location_alias?
Path:      id, timetable_id, name, stops[]  — reusable route template
PathStop:  station_id, sort_order, travel_time_from_prev (min), dwell_time (min)
Crew:      id, timetable_id, name, color, guard_visible? (offered in the guard panel's crew picker; opt-in)
TimetableSettings: clock_enabled, clock_broker_url, clock_topic, auto_assign_min_break, requests_enabled (default true), request_train_prefix ('PR'), request_default_leg_min (5), request_lead_min (2)
```

`Train.train_id` is the JMRI roster entry name (client-side combobox; saving never depends on JMRI being reachable).

**Layout config:** layout-wide (not per timetable), stored at top-level `db.layout` and read via `getLayout()`/`setLayout()` in `server/db.js` (defaults merged). Holds `jmri`, `guard`, `train_profiles`, `boarding`, `stats`, `events` and `loa` (see `LayoutConfig` in types.ts). Routes and validation in `server/layout.js` (+ `events.js`, `loa.js`).

## API Endpoints

Base: `/api` (dev: Vite proxies 5173 → 3001). Rate limit: 200 req/min.

```
GET/POST   /api/timetables
GET/PUT/DELETE /api/timetables/:id
POST       /api/timetables/:id/duplicate
POST       /api/timetables/:id/restore
PUT        /api/timetables/:id/settings
GET/PUT    /api/active-timetable
GET/PUT    /api/layout                                        — layout-wide config (see Data Model)
GET        /api/loa/values                                    — LOA topic cache: topic → { value, at }

POST/PUT/DELETE  /api/timetables/:id/stations/:stationId?
POST/PUT/DELETE  /api/timetables/:id/trains/:trainId?
POST             /api/timetables/:id/trains/auto-assign
PATCH            /api/timetables/:id/trains/:trainId/complete  — set status ('running'|'completed'|null)
POST             /api/timetables/:id/trains/reset-complete     — clear all train statuses
POST/PUT/DELETE  /api/timetables/:id/paths/:pathId?
POST/PUT/DELETE  /api/timetables/:id/crews/:crewId?
PUT              /api/timetables/:id/crews/reorder

GET              /api/timetables/:id/path-requests
POST             /api/timetables/:id/path-requests                          — crew submit → 201 pending
POST             /api/timetables/:id/path-requests/:reqId/withdraw          — crew { crewId }
POST             /api/timetables/:id/path-requests/:reqId/acknowledge       — Control: pending → in_review
POST             /api/timetables/:id/path-requests/:reqId/release           — Control: in_review → pending (or Reopen an accepted one whose train is gone)
POST             /api/timetables/:id/path-requests/:reqId/decline           — Control { note }
POST             /api/timetables/:id/path-requests/:reqId/accept            — Control { train, retime?, note? }: creates the train
POST             /api/timetables/:id/path-requests/:reqId/cancel-ask        — crew { crewId, reason? } (accepted only)
POST             /api/timetables/:id/path-requests/:reqId/cancel-approve    — Control { note? }: deletes the train
POST             /api/timetables/:id/path-requests/:reqId/cancel-reject     — Control { note }
DELETE           /api/timetables/:id/path-requests?closed=true              — Control: clear closed requests
GET              /api/audit?timetableId=&requestId=&crewId=&ip=&device=&action=&before=&limit=[&format=csv]  — path-request audit log (newest first)

GET  /api/timetables/:id/live/trains
GET  /api/timetables/:id/live/trains/:trainName
GET  /api/timetables/:id/live/stations/:stationName  [?direction=up|down&trainId=%pat%]
WS   /api/live/station-feed?id=&station=[&direction][&trainId][&futureCount]
WS   /api/live/sync?id=                                       — live notices: hello (rev, activeId), completions, timetable-updated (coalesced), timetable-deleted, active-changed, loa-values (full snapshot after hello, then deltas), path-requests (request list; with rev only for request-only changes)
```

All mutation endpoints return the full updated Timetable.

## Non-Obvious Architecture

- **No Redux/Zustand:** `App.tsx` is the single source of truth. Every mutation: component → `api.ts` → server → `App.tsx` setState.
- **Undo/redo:** Full-Timetable stacks (`historyPast[]`, `historyFuture[]`) in App.tsx — not delta-based.
- **camelCase/snake_case split:** Client sends camelCase request bodies; server stores + responds in snake_case; normalization in server route handlers.
- **Server returns full timetable:** Every mutation endpoint returns the complete updated Timetable, not just the delta.
- **MQTT per WebSocket:** Each live station-feed WS connection gets its own MQTT client; cleaned up on WS close.
- **Terminal stop enforcement:** First stop → no arrival; last stop → no departure. Enforced in UI and on save.
- **`graph_pos` vs `distance`:** `graph_pos` is the Y-axis layout unit (integer); `distance` is an optional display label. Independent fields.
- **`BASE_PATH` env var:** For reverse proxy sub-path deployments (e.g. `/liverun/`). Vite base is `./` (relative URLs).
- **Train status is ephemeral:** `status` ('running'|'completed') lives on Train objects in the DB but is stripped from undo/redo history stacks (`stripStatus()` in App.tsx) so undoing edits never restores stale run state.
- **Live sync (`server/sync.js`):** `mutateTimetable` bumps `tt.rev` and notifies `onTimetableChange` listeners; sync coalesces these (~300 ms) into `timetable-updated` notices that carry no data — clients re-fetch. Status-only mutations (`complete`, `reset-complete`) pass `{ notify: false }` and send `completions` with `rev` instead, so crew taps don't make every screen re-fetch. Clients compare `rev` in `hello` to catch anything missed while disconnected.
- **Entry routing:** `main.tsx` uses `resolveMode()`: `…/guard` → guard panel, `…/mobile` → `MobileRoot` (Crew jobs, Running board or the view picker; see below), `?desktop` → planner, `?choose` → mode picker; otherwise the saved mode (`localStorage['liverun.mode']`) or, with none, mobile UA → picker / desktop → planner. `/guard/` and `/mobile/` redirect to the slash-less path with a relative `Location` (works under `BASE_PATH`).
- **Train profiles, not train types:** sounds and decoder functions for a train come from the first `layout.train_profiles` entry whose glob matches `train_id` (the JMRI roster name). Actions that resolve to a function are disabled while the throttle isn't acquired; actions that don't resolve still play sounds. The guard panel's throttle follows the *displayed* train, so a train held behind the lost-train ACK banner keeps its throttle until ACK.
- **LOA (spec §11):** sections are directional `from`→`to` station pairs matched on a train's stops, so no train types or odd/even rules. Raw topic values are shared by the server cache; latching is client-side and per device. Each element has *Grants* (default on) and *Revokes* (default tokens) flags: all granting elements clear at once → GRANTED; a revoking element going not-clear → COMPLETE (released, e.g. staff sunk; never re-granted). **Only the safeworking elements drive it: doors, pinned stops and the fast clock never do (L6)** — doors are not a safeworking element and must not be interlocked with LOA. The guard panel shows dots and labels only, never raw MQTT values. Guard panel only, not CrewMobile (L3).
- **Stops are stored in station order, not running order:** the planner builds a train's stops from the sorted station list, so a train running the other way (Up) is stored backwards. Anything that needs running order (guard panel, LOA direction, boarding, events) must go through `runningOrder()` / `inRunningOrder()`; `sequenceStops()` already does.
- **Graph edits save times only:** Done sends every draft through `/trains/retime`, which applies arrival/departure to each train's *current* stops by station and touches nothing else, so an edit made after the drag is never overwritten.
- **Guard events vs special instructions:** `guard_events` (per stop, hidden, guard panel only) are the scripted-event feature; `special_instructions` stays a public note (printed, station board) and is never converted automatically (spec D20).
- **Guard panel never renders `special_instructions`** — on the owner's layout that field holds hidden scripted events (to be replaced by `guard_events`, spec §10).
- **Station name style defaults:** `stationNameStyle()` in utils.ts returns `bold:true` when none of the three flags are set — preserving legacy bold appearance for existing stations.
- **`reset-complete` route ordering:** The `POST /trains/reset-complete` route is registered before `/:trainId` routes so Express doesn't match the literal string "reset-complete" as a train ID.
- **Feature modules:** New server features live in their own module exporting `register(app, deps)`, called from `server/index.js` (routes themselves are still flat Express handlers, no router framework). See `server/layout.js`.
- **User guide upkeep:** any change to user-visible behaviour (labels, buttons, rules) updates the matching `docs/user-guide/` page in the same commit, and `npm run docs:screenshots -- <shot>` for affected images. Write it from the code, not from the spec. Demo crew names are anonymised (public repo) — keep them that way. Changelog in `CHANGELOG.md`.
- **Path requests live on the active timetable only:** `tt.path_requests[]`; new submits to an inactive timetable are refused (400). They never follow undo/redo (`/restore`); duplicate, export and import drop them (spec P2).
- **Request sync:** request-only mutations use `{ notify: false }` and send a `path-requests` message carrying `rev`, so screens don't re-fetch. Accept and cancel-approve create or delete a train: they notify and send `path-requests` without `rev`, so clients re-fetch the timetable.
- **Path requests are logged; the log is not the DB:** every request action, accepted or refused, is appended to `<data>/audit.jsonl` (rotated at 5 MB). Identity is IP + `X-LiveRun-Device` + User-Agent + the claimed crew. The crew is self-declared (no auth), so the log shows which browser acted, not who. Only Control reads it (Requests drawer, `GET /api/audit`).
- **Mobile views:** `…/mobile` shows Crew jobs or the Running board (`CrewMobile`). The choice is saved per device in `localStorage['liverun.mobileView']`; `?view=jobs|board` deep-links and saves. The Running board's ☰ "View" clears it and returns to the picker.
- **Crew jobs is read-only for run state:** it never shows run/complete controls, never renders `guard_events`, and shows only the picked crew's trains. Only the Running board and Control change run state.
- **Request drafts are built from path templates, then timetabled trains:** `pathPlan.ts` times the draft from a path covering the request, else chained path legs; only where no path reaches does it use timetabled trains' running times (train edges cost a large penalty so they only bridge gaps). Stops are stored in station order, like every train (see the stop-order bullet above).
- **Approve cancel has no undo step:** Approve (cancel-approve) deletes the train on the server and is not pushed onto the undo stack. Accept does push one undo step, and undoing it removes the train, but the request stays `accepted` (shown as "train no longer exists", with Reopen).
- **`train_type` removed in v2:** A startup migration (`stripTrainType` in `server/migrations.js`) deletes the field from all trains; the `?trainType=` station-board filter is gone. Don't reintroduce either.

## Dev Commands

```bash
npm install       # install all workspaces
npm run dev       # Vite (5173) + Express (3001) concurrently
npm run build     # tsc + vite build → client/dist/
npm run start     # Express serving client/dist/ (production)
docker compose up -d  # production; UI at localhost:3001
npm test          # server node:test + client Vitest
npm run docs:screenshots   # regenerate docs/user-guide/images (needs: npx playwright install chromium)
LIVERUN_API=http://localhost:3011 npm run dev --workspace=client   # point the Vite dev proxy at another server
npm run mock:jmri  # mock JMRI JSON server: ws://localhost:12080/json/ + /json/roster (env PORT, ROSTER=file.json, HEARTBEAT)
                   # logs every throttle command/broadcast; set Layout → JMRI URL to ws://localhost:12080/json/
curl -X POST 'localhost:12080/mock/set?address=3001&fn=6&on=true'  # simulate a driver's handheld; GET /mock/state shows F states
```

**Local build on macOS arm64:** the committed lockfile lacks the Rollup/esbuild native packages (npm optional-deps bug; CI deletes the lockfile). Before `npm run build` locally, run `npm install --no-save @rollup/rollup-darwin-arm64@<rollup version> @esbuild/darwin-arm64@<esbuild version>`, using the versions in `node_modules/rollup/package.json` and `node_modules/esbuild/package.json` (currently rollup 4.60.1, esbuild 0.21.5).

## Environment Variables

| Var | Default | Purpose |
|-----|---------|---------|
| `NODE_ENV` | — | `production` enables static file serving from Express |
| `PORT` | 3001 | Express listen port |
| `DB_PATH` | `server/data/train-graph.json` | JSON DB file path |
| `BASE_PATH` | — | Sub-path prefix for reverse proxy |
| `ALLOWED_ORIGIN` | `*` | CORS whitelist |