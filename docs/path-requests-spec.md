# Path Requests — Design Spec (draft 4)

Status: **implemented** on branch `feat/path-requests`, phases 1–4 (§10, §12.3). The decisions in §0 are recorded and still apply; where a later section's wording differs from the code, the code is the reference. Draft 1's open questions are answered and logged in §0 (P11–P20).

## Summary

A crew on the layout asks Control for a path: "I'm at A with 3001, I want to go to C, stopping at B for 20 min to shunt." The request turns up in the planner as a notification. Control reviews it and acknowledges it. The graph then opens in edit mode with the movement drawn as a draft train, timed from the layout's **path templates**. Control moves it, or other trains, around any conflicts with the existing drag/dwell tools. On **Accept** the movement is saved as an ordinary train assigned to a crew and appears in that crew's **Crew jobs** app with its full timetable and instructions.

The existing crew view (`CrewMobile`, relabelled **Running board**) is **not** used for this. It is the layout owner's situational-awareness screen (what's running and when, marking runs started/ended) and stays that way. Train crews get a new, separate app (§3): they request paths and see their own jobs, and nothing else they can change.

```
Crew jobs (/mobile)        Server                      Planner (Control)
─────────                  ──────                      ─────────────────
Request path ──POST──────▶ pending ──path-requests──▶ toast + badge
                                                       Review → Acknowledge
"Control is plotting" ◀─── in_review ◀──────────────── (graph: edit mode, draft train)
                                                       drag / dwell / move others
New job card ◀─ timetable- accepted + train created ◀── Accept (+ note to crew)
                updated                                (one mutation, one undo step)
"Declined: note" ◀──────── declined ◀───────────────── Decline (note required)
```

## 0. Decisions

| # | Decision | Outcome |
|---|----------|---------|
| P1 | What an accepted request becomes | An **ordinary `Train`** with `crew_id` set. Owner's crew view, guard panel, station board, live API, CATS export and auto-assign need no special case. The train keeps a link back to its request (`Train.request_id`) |
| P2 | Where requests are stored | `Timetable.path_requests[]`, **active timetable only**. `/restore` (undo/redo) doesn't touch them; duplicate, export and import drop them |
| P3 | Who can submit | Train crews, from a **new Crew jobs app** (one of the two views at `…/mobile`, §3.1), after picking their crew (no auth, like the guard panel's crew pick) |
| P3a | Running board (today's crew view) | **Unchanged in function.** It stays the owner's situational-awareness view with run/complete marking. Train crews never get run/complete controls; managing run state is Control's or the owner's job |
| P4 | Locations | Timetable **stations** only, because the graph can only plot stations. A station with `alias_enabled` also gets a free-text siding/road field (→ `location_alias`) |
| P5 | Work at intermediate stops | Per stop: kind (**Shunt** / **Work** / **Stop**), minutes, optional note. Minutes become the dwell. The note goes into `special_instructions` |
| P6 | Running times | From **path templates** (`Timetable.paths`): a single path covering the request if one exists, otherwise inferred by chaining other paths' legs; where no path reaches, **timetabled trains'** running times fill the gap (§5.2 step 3, added after testing on the B session: no template reaches Shoalhaven Starches). No layout-specific rules (D13) |
| P7 | Conflict detection | **None in code.** LiveRun has no track/occupancy model. Control judges the graph and moves things by hand |
| P8 | Committing | **Accept** saves the new train *and* any other trains moved while plotting, in **one mutation** (one rev bump, one undo step) |
| P9 | Notification | Planner: top-right toast via the existing `useToasts`, plus a **Requests** badge in the header. Crew jobs app: status on their request and a NEW job toast (reusing `diffJobs`) |
| P10 | Live transport | New `path-requests` sync message carrying the request list (small). Request-only changes don't send `timetable-updated`, so screens don't re-fetch |
| P11 (Q1) | Extending an existing job | **No.** Every request is a new movement and a new train |
| P12 (Q2) | Assigning to another crew | **Yes.** Control can assign the movement to any crew; the requester's card shows who got it |
| P13 (Q3) | Passing stations | Added **only when path templates give their time** (they fall out of the matched or inferred path route). Legs with no path data get the requested points only |
| P14 (Q4) | Sounds | **None** for requests, in the planner or the Crew jobs app |
| P15 (Q5) | ASAP with the fast clock off | Placed at the **timetable start time**; Control drags it into place |
| P16 (Q6) | Control's note to the crew | **Yes.** `control_note`: optional on accept, required on decline, shown on the request card |
| P17 (Q7) | Mobile views | `…/mobile` **asks which view** (Crew jobs or Running board) on first open, **remembers it on the device**, and offers **Change view** (§3.1) |
| P18 (Q8) | Crew list in Crew jobs | **No filter**: every crew in the timetable is listed |
| P19 (Q9) | `special_instructions` | **Shown** in the Crew jobs app. No migration or moves into `guard_events` |
| P20 (Q10) | Other trains in Crew jobs | **No.** Crews see their own jobs only |
| P21 | Audit log | Every path-request action, accepted or rejected, is logged with time, IP, device, acting crew or Control, and what changed (§4.4). Kept in an append-only file, not the timetable. Visible to Control only |
| P22 | Crew cancelling | **Withdraw** while `pending` or `in_review`. After accept the crew can only **Ask to cancel**; Control approves (train removed) or rejects with a note (§1.1) |

## 1. Request lifecycle

| State | Set by | Meaning | Crew sees |
|-------|--------|---------|-----------|
| `pending` | Crew submits | Waiting for Control | "Waiting for Control" |
| `in_review` | Control **Acknowledge** | Control is plotting it on the graph | "Control is plotting your path" |
| `accepted` | Control **Accept** | Train created; `train_id_created` set | Job appears (NEW) for the assigned crew; request shows "Accepted → PR3" (+ "assigned to Crew 3" if another crew got it) and Control's note |
| `declined` | Control **Decline** (note required) | Closed | Toast + "Declined: *note*" |
| `withdrawn` | Crew **Withdraw** (while `pending` or `in_review`) | Closed | "Withdrawn" |
| `cancelled` | Control **approves** a crew's ask to cancel | Train removed; closed | "Cancelled" + Control's note |

- **Cancel while plotting** returns the request to `pending`. Nothing is saved, as with Cancel in graph edit mode today.
- If the planner tab closes or reloads mid-plot, the request stays `in_review`. The Requests drawer offers **Resume plotting** (a fresh draft) or **Return to queue**.
- **Undo after Accept** removes the train (normal undo), but the request stays `accepted`. The drawer shows it as "Accepted — train no longer exists" with **Reopen** (→ `pending`). Requests don't follow undo, so a crew's request never disappears because Control pressed Ctrl+Z.
- Closed requests (`accepted`/`declined`/`withdrawn`/`cancelled`) stay visible until Control clears them (**Clear closed** in the drawer). **Reset completions** doesn't touch them.

### 1.1 Crew cancelling (P22)

- **Before accept** (`pending`, `in_review`): the crew taps **Withdraw** and it closes straight away. If Control is plotting it, the `path-requests` sync message arrives and the edit bar shows "Crew 2 withdrew this request". Accept is disabled; Cancel discards the drafts. If Accept races the withdraw, the server returns 409 and nothing is saved.
- **After accept**: the movement is a train in Control's timetable, so the crew can't delete it. They tap **Ask to cancel** (optional reason) on the request card. The request stays `accepted` with an open `cancel_ask`:
  - Control gets a toast ("Crew 2 asks to cancel PR3") and the drawer flags the row, which counts in the Requests badge.
  - **Approve**: the train is deleted in the same mutation and the request becomes `cancelled`, with an optional note. The crew's job disappears, using the existing removed-job toast.
  - **Reject** (note required): the ask is closed, the train stays, and the crew sees "Cancel refused: *note*".
  - Only one open ask at a time. The crew can ask again after a rejection.
  - Control can still move, reassign or delete the train by any normal means. If the train is already gone when Control looks, the ask shows "train no longer exists" with **Close**.
- An Approve isn't undone together with the train: as with accept, requests don't follow undo.

## 2. Data model

```ts
// types.ts
export type PathRequestStatus = 'pending' | 'in_review' | 'accepted' | 'declined' | 'withdrawn' | 'cancelled';
export type PathWorkKind = 'stop' | 'shunt' | 'work';

export interface PathRequestStop {
  station_id: string;
  location_alias?: string | null;   // siding/road, only where the station has alias_enabled
  kind: PathWorkKind;               // origin/destination: 'stop'
  minutes: number;                  // requested time on site (0–240); origin/destination 0
  note?: string;                    // ≤ 200 chars → special_instructions on accept
}

export interface PathRequest {
  id: string;
  timetable_id: string;
  crew_id: string;                  // requesting crew; default assignee
  loco?: string;                    // JMRI roster name / free text → Train.train_id
  stops: PathRequestStop[];         // running order: [current, …intermediate, proposed]; ≥ 2, unique stations
  ready_at?: string | null;         // HH:MM fast-clock time; null = as soon as possible
  notes?: string;                   // ≤ 500 chars, shown to Control (and copied to Train.notes)
  status: PathRequestStatus;
  created_at: string;               // ISO wall-clock
  updated_at: string;
  control_note?: string;            // ≤ 300 chars; Control → crew (P16). Required on decline
  train_id_created?: string;        // Train.id once accepted
  assigned_crew_id?: string;        // crew the train was given to (may differ from crew_id, P12)
  cancel_ask?: {                    // crew's ask to cancel an accepted path (§1.1)
    at: string;
    reason?: string;                // ≤ 300 chars
    status: 'open' | 'rejected' | 'approved';
    control_note?: string;
  };
}

// Timetable gains:
path_requests?: PathRequest[];
// Train gains:
request_id?: string;                // set on trains created from a request
```

Notes:
- **Request stops are in running order**, as the crew enters them. On accept the train's stops are stored in station order like any planner-built train. Anything reading them afterwards goes through `runningOrder()` (see CLAUDE.md "Stops are stored in station order").
- One direction per request: a there-and-back is two requests. Stations must be unique per train (retime matches by station).
- `rev` is bumped by request changes (they go through `mutateTimetable`), but with `{ notify: false }` (§4.3).

## 3. Crew jobs app (`…/mobile`)

A new phone-first page for **train crews**, separate from the owner's crew view. Crews see their jobs and ask Control for paths. Nothing on it changes run state.

### 3.1 Routing, mobile view picker and crew pick

- `…/mobile` stays the single phone entry point (existing bookmarks, the main mode picker's saved `crew` mode and the `/mobile/` redirect are unchanged). It now shows one of two views:
  - **Crew jobs**: "Your jobs, their timetables and instructions. Request a path from Control."
  - **Running board** (today's `CrewMobile`, relabelled): "Everything running and when. Mark runs started and complete."
- **Ask, then remember.** If the device has no saved choice, `/mobile` shows a **mobile view picker** with those two cards. The choice is always saved on the device (`localStorage['liverun.mobileView']` = `'jobs' | 'board'`, with no "remember" checkbox), and from then on `/mobile` opens straight into that view.
- **Change view** in ☰ of both views clears the saved choice and shows the picker again. **Switch mode** (to the main mode picker) stays where it is today.
- Deep links `…/mobile?view=jobs` and `…/mobile?view=board` pick the view and save it. These are useful for QR codes posted around the layout for crews. An unknown value shows the picker.
- `lib/mode.ts` gains `resolveMobileView()`, `loadMobileView()` and `saveMobileView()` (pure, tested like `resolveMode()`). No new route, no new `SavedMode`.
- Existing devices with no saved mobile view (e.g. the owner's phone) see the picker once on their next visit.
- The main mode picker's "Crew view" card becomes **Mobile** ("Crew jobs or the running board") and still goes to `/mobile`.
- On first open the crew picks **their crew** from **every crew in the timetable** (P18), using the same pattern as `GuardPanel`'s `CrewPicker`. The choice is stored per device (`jobs:crew:<timetableId>`) and can be changed from ☰.
- Always uses the **active timetable** (`useLiveTimetable`), so jobs update live within a second or two, with no refresh.

### 3.2 Screen

```
┌────────────────────────────────────┐
│ Crew 2            14:07 ⏱   ☰       │  crew name, fast clock (if enabled)
├────────────────────────────────────┤
│ [ + Request a path ]               │
│ My requests                        │
│  ⏳ Kiama → Bombo (shunt 20)  Waiting│
├────────────────────────────────────┤
│ My jobs                            │
│ ▸ 31L  3001  Kiama 14:20 → Bombo …  │  next/current job expanded
│   Stop          Arr    Dep          │
│   Kiama Rd 2     —     14:20        │
│   Bombo         14:31  14:51        │
│     ⚑ Shunt 20 min: drop 2 wagons   │  special instructions
│   Dunmore       15:02   —           │
│   Notes: …            Requested ⓘ   │
│ ▸ PR4  …                            │
└────────────────────────────────────┘
```

- **My jobs**: every train with `crew_id` = this crew, sorted by run (`sortByRun`), whether it came from a request or not. Each job shows:
  - the full stop list in **running order** (`sequenceStops`), with arrival/departure and `location_alias`;
  - `special_instructions` (P19);
  - the loco (`train_id`) and train notes;
  - a **Requested** badge if `request_id` is set.

  The current or next job is expanded (`autoSelectTrain` with the fast clock); the current stop is highlighted (`currentStop`).
- Run status is shown **read-only** ("Running", "Done" dimmed) where Control or the owner set it. There are no buttons to change it.
- **Never rendered:** `guard_events` (hidden, guard panel only). Other crews' trains are never listed (P20).
- Live changes from Control use the `diffJobs` toasts the guard panel and owner view already have: "New job: PR4 (14:20)", "31L retimed" (changed cells flash), "23L → Crew 3". No sounds (P14).
- ☰: change crew, **Change view**, Switch mode, Help link (`helpUrl`).

### 3.3 Request form

Opened by **Request a path**. Hidden when no active timetable is set or `requests_enabled` is off.

| Field | Control | Notes |
|-------|---------|-------|
| Crew | Read-only (the picked crew) | |
| Loco | Roster combobox (`RosterCombobox`), optional | Prefilled from the crew's current/last job's `train_id` |
| From (current location) | Station picker (+ siding text if `alias_enabled`) | Prefilled from the last stop of the crew's current/most recent job |
| Stops en route | "+ Add stop" rows: station, kind (Stop/Shunt/Work), minutes stepper, note | Reorderable with ↑↓ |
| To (proposed location) | Station picker (+ siding) | |
| Ready at | "As soon as possible" (default) or a time | Shows the fast clock if it's running |
| Notes for Control | Textarea | |

- **Submit** is disabled until From ≠ To and stations are unique. On success the form closes and the request appears under **My requests**.
- A request card shows status, the route (`A → B (shunt 20) → C`), Control's note, and the assigned crew if it isn't this one. Actions: **Withdraw** while pending or being plotted; **Ask to cancel** once accepted, then "Waiting for Control" until it's approved or refused (§1.1).
- Status changes arrive via the `path-requests` sync message. On `declined`: toast with Control's note. On `accepted`: the assigned crew's new job appears in My jobs (NEW), and the request card links to it (if it's this crew's) and fades after a few minutes.

## 4. Server

### 4.1 Module

New `server/path-requests.js` exporting `register(app, deps)` (pattern: `server/retime.js`), with pure `validateRequest()` and `applyAccept()` for `node:test`.

### 4.2 Endpoints

```
GET    /api/timetables/:id/path-requests                         — list (also in GET timetable)
POST   /api/timetables/:id/path-requests                         — crew submits → pending
POST   /api/timetables/:id/path-requests/:reqId/withdraw         — crew, pending or in_review → withdrawn
POST   /api/timetables/:id/path-requests/:reqId/acknowledge      — Control, pending → in_review
POST   /api/timetables/:id/path-requests/:reqId/release          — Control, in_review → pending (Cancel / Return to queue / Reopen)
POST   /api/timetables/:id/path-requests/:reqId/decline          — Control, { note } (required) → declined
POST   /api/timetables/:id/path-requests/:reqId/accept           — Control, in_review → accepted (below)
POST   /api/timetables/:id/path-requests/:reqId/cancel-ask       — crew, accepted, { reason? } → open cancel_ask
POST   /api/timetables/:id/path-requests/:reqId/cancel-approve   — Control, { note? }: delete the train + → cancelled (one notifying mutation)
POST   /api/timetables/:id/path-requests/:reqId/cancel-reject    — Control, { note } (required) → cancel_ask rejected
DELETE /api/timetables/:id/path-requests?closed=true             — Control, clear closed
```

Wrong state for an action → **409** with the current status (e.g. the crew withdrew while Control was plotting).

**Accept** body (camelCase, like other request bodies):

```jsonc
{
  "train": { "name": "PR3", "color": "#…", "trainId": "3001", "crewId": "…", "direction": "Up", "notes": "…",
             "stops": [ { "stationId": "…", "arrival": null, "departure": "14:20", "specialInstructions": "Shunt 20 min: …", "locationAlias": null }, … ] },
  "retime": [ { "trainId": "…", "times": [ … ] } ],  // optional: other trains moved while plotting, same shape as /trains/retime
  "note": "Held 10 min at Bombo for 23L"             // optional control_note
}
```

The whole accept is one `mutateTimetable`:
1. Check the request is `in_review`.
2. Validate `retime` with `validateRetime()` (all-or-nothing, 409 on conflicts).
3. Create the train, with the same normalisation and terminal-stop rules as `POST /trains`, plus `request_id`.
4. Apply the retime.
5. Set the request to `accepted`, with `train_id_created`, `assigned_crew_id` and `control_note`.

It returns the full timetable.

Validation on submit:
- 2 to 20 stops. The stations exist in the timetable and are unique.
- `crew_id` exists.
- Minutes are integers from 0 to 240. `ready_at` is HH:MM or null.
- Text lengths are capped.
- At most **50 open** (`pending`/`in_review`) requests per timetable.
- Requests are accepted only against the **active** timetable (400 otherwise), so a stale crew tab can't file into an old session.

### 4.3 Sync

- New message `{ type: 'path-requests', timetableId, rev, requests: PathRequest[] }`, sent on every request change (including accept) and once after `hello`.
- Request-only mutations (`submit`, `withdraw`, `acknowledge`, `release`, `decline`, `cancel-ask`, `cancel-reject`, `clear`) use `{ notify: false }`, as `complete` does. Accept and cancel-approve are normal notifying mutations, because a train is created or deleted.
- `openapi.js`, `ws-inspector.html` and the `SyncMessage` type are updated.

### 4.4 Audit log (P21)

Records who did what to path requests: which IP, which device, as which crew (or Control), and what changed.

**Identity.** There is no auth, so "user" means:
- **IP**: `req.ip`. This is already correct behind the reverse proxy (`trust proxy` is set for loopback/private ranges in `index.js`).
- **Device**: a random id generated once per browser (`localStorage['liverun.deviceId']`), sent as an `X-LiveRun-Device` header on path-request calls. It tells apart phones behind the same NAT or Wi-Fi.
- **User agent**: shortened (e.g. "Safari iOS 18").
- **Actor**: `crew` (with the crew id and the crew's name at that moment) for Crew jobs actions; `control` for planner actions.

The crew is self-declared (whoever picked it on that phone). The log shows what each device *claimed*, which is what makes mistakes and misuse traceable on a trusted LAN.

**What's logged.** Every call to the §4.2 endpoints, including rejected ones (400/409), so failed attempts show too:

```jsonc
{ "at": "2026-10-15T04:12:09.311Z", "clock": "14:07",        // wall time + fast-clock time if known
  "ip": "192.168.1.42", "device": "d-7f3a…", "ua": "Safari iOS 18",
  "actor": "crew", "crew_id": "…", "crew_name": "Crew 2",
  "action": "submit",                                          // submit|withdraw|acknowledge|release|decline|accept|cancel-ask|cancel-approve|cancel-reject|clear
  "outcome": "ok",                                             // ok | rejected (+ "error": "…")
  "timetable_id": "…", "timetable_name": "…", "request_id": "…",
  "detail": { … } }
```

`detail` by action:
- `submit`: the request as filed (stops, loco, ready-at, notes).
- `decline` / `withdraw` / `release` / `cancel-ask` / `cancel-reject`: the note or reason, if any. A `withdraw` notes whether Control was plotting it.
- `cancel-approve`: the deleted train (name, crew, stops with times) and the note.
- `accept`: the created train (name, crew, loco, stops with times), the assigned crew if it isn't the requester, the note, and each other train moved while plotting (name, old → new times).
- `clear`: the ids of the requests removed.

**Storage.** New `server/audit.js`:
- Writes are an append-only JSON-lines file, `<data dir>/audit.jsonl`, appended per entry, so the DB is never rewritten for a log line.
- It survives undo, timetable deletion and restore.
- At 5 MB the file is rotated to `audit.1.jsonl`; one old file is kept.
- Pure helpers (`entry()`, `shortUa()`, `summarise()`) are tested with `node:test`.

**API.** `GET /api/audit?timetableId=&requestId=&crewId=&ip=&action=&before=&limit=` returns the newest entries first (default limit 200, max 1000), and `?format=csv` returns CSV. Read-only; nothing in the app edits or deletes entries.

**UI (Control only).**
- In the Requests drawer, each request row expands to show its history (time, action, crew/Control, IP, device).
- An **Audit log** tab in the drawer lists all entries, filterable by crew, IP, device, action and request, with an **Export CSV** button.
- Crews never see the log.

**Scope.** Path-request actions only. Logging every planner mutation is possible later on the same module, but it's out of scope here.

## 5. Planner (Control)

### 5.1 Notification and queue

- On a new `pending` request: toast top-right, "**Crew 2** requests a path: Kiama → Bombo (2 stops)", with a **Review** button. No sound (P14).
- Header **Requests** button with a badge counting `pending`. It opens a right-hand drawer listing requests, open ones first, then closed. Each row shows:
  - crew (colour chip), loco, route with work stops, ready-at, age and notes;
  - **where the times will come from** (§5.2): "Path *Kiama–Bombo*", "Inferred from 2 paths" or "⚠ Bombo → Dunmore: no path data".

  Actions by state:
  - pending: **Acknowledge & plot**, **Decline** (asks for a note)
  - in_review: **Resume plotting**, **Return to queue**, **Decline**
  - accepted: link "→ PR3" (selects the train on the graph); "train no longer exists" + **Reopen** if it's gone
  - accepted with an open ask to cancel: flagged, with the reason, **Approve cancel** and **Reject** (asks for a note)
- Only one request is plotted at a time. Acknowledging a second one while plotting asks to finish or cancel the first.

### 5.2 Acknowledge → draft train (times from path templates)

Acknowledge calls `/acknowledge`, builds a draft train client-side, switches the graph into ✎ Edit and scrolls/zooms to it.

The draft is built by a new pure module, **`client/src/lib/pathPlan.ts`** (Vitest). The drawer uses the same module for its "times from" line.

**Path legs.** Each `Path` gives legs between its consecutive stops (by `sort_order`). The leg into a stop takes that stop's `travel_time_from_prev` minutes. A leg can be used in either direction.

**Route and running times**, tried in order:

1. **Single path.** Find a path containing every requested station in the requested order, forwards or reversed. If more than one fits, use the one with the fewest stations between origin and destination, then the first by name. The route is that path's stations from origin to destination. Running times are its leg times.
2. **Inferred from other paths.** Build a graph from every path's legs, with undirected edges. Where several paths share a leg, the edge time is their median. For each consecutive pair of requested points, take the fastest route through the graph (Dijkstra on minutes). This chains paths across junctions and branches.
3. **Timetabled trains.** If the path graph has no route for a leg, add an edge for every station pair that existing trains run between consecutive stops and no path has (minutes = median of arrival − previous departure, midnight-safe; trains made from requests are ignored). Route with train edges as a last resort (large cost penalty, so the fewest are used and path data always wins). Each train-timed edge is noted on the edit bar ("Berry → Shoalhaven Starches: no path template, 22 min from 5 timetabled trains").
4. **No data.** If no route exists for a leg, use just the two requested points for that leg, with the timetable setting `request_default_leg_min` (default 5). The leg is flagged on the edit bar and in the drawer.

If inferred routes would put a station in the train twice, that leg falls back to step 4 and is flagged. A train's stations must be unique.

**Stops**
- **Requested points**: dwell = requested minutes (at least 1 for kind `stop`). The siding goes into `location_alias`. Shunt/work stops get `special_instructions` = `"<Shunt|Work> <n> min"`, plus `": <note>"` if there is one.
- **Passing stations from the route** (P13): timing points with no dwell (arrival = departure), no instructions. The path's own dwell times are **not** used: the template is a timing source, not a stopping pattern.
- First stop has no arrival, last stop no departure (terminal-stop rule).

**Start time**
- `ready_at`, if set and in the future;
- else, with the fast clock running, the clock time rounded up to the next minute plus `request_lead_min`;
- else the timetable start time (P15).

**Train fields**
- **Name**: `<prefix><n>`, where `request_train_prefix` defaults to `PR` and n is the next free number.
- **Crew**: the requester.
- **Colour**: a random bright colour, chosen among the hues furthest from every existing train's colour (`pickRequestColor`), so the draft is easy to find; the accepted train keeps it.
- **Direction**: from the graph_pos trend.
- `train_id`: the loco.
- `notes`: the request notes.

### 5.3 Plotting on the graph

`TrainGraph` gets an optional **`plotting`** prop (`PlottingState`, `client/src/lib/plotting.ts`): the draft train, which isn't in `timetable.trains` (its id comes from `pendingTrainId()`). Its callbacks are `onPlotChange` (a moved draft), `onPlotEditStops`, `onPlotAccept(others, note)` and `onPlotCancel`.

- Drawn on top, **dashed with marching dashes, a dark casing and a pulsing glow**, in its picked colour, labelled "PR3 (request)". The usual hover tooltip lists the work stops.
- Drag-to-shift and dwell handles work on it exactly as on a draft (`shiftStops`, `changeDwell`, midnight-safe). Running times stay as planned, matching today's rule that graph edits never change running times. To change a leg's running time, Control uses **Edit stops**.
- Other trains can be moved in the same session as normal drafts, to clear the path.
- While a pending train is shown, the edit bar becomes:
  `Plotting PR3 for Crew 2 · 1 other train moved` · Crew ▾ · **Edit stops** · Note to crew … · **Cancel** · **Accept**
  - **Crew ▾**: assign to any crew (P12). Defaults to the requester; changing it keeps the draft's colour.
  - **Edit stops**: opens `TrainEditor` on the draft (name, crew, loco, stops, times, special instructions) without saving. On close, the edited train replaces the draft.
  - **Note to crew**: optional `control_note` (P16).
  - **Accept**: sends `/accept` with the draft, every other draft as `retime`, and the note. On 409 (request withdrawn, or another train's stops changed) nothing is saved, the drafts stay, and the error is shown, as Done does today.
  - **Cancel**: discards all drafts and calls `/release`.
- Non-blocking warnings on the edit bar: "starts 3 min before the fast clock", "Crew 2 has another job overlapping 14:10–14:40", "Bombo → Dunmore: no path data, 5 min used". This is the only "conflict" logic. It's per crew, not per track (P7).
- Accept pushes one undo step (`historyPast`) before the call, as `onTrainTimesCommit` does.

## 6. Other views after accept

- **Crew jobs app**: the new train is a job like any other for the assigned crew (§3.2).
- **Running board**: unchanged in function. The train shows up like any train, with a small **Requested** badge. Run/complete marking stays here and in the planner only.
- **Guard panel**: shown like any job if the crew is `guard_visible`. Nothing request-specific. The guard panel still never renders `special_instructions`; P19 applies to Crew jobs only.

## 7. Settings

Per timetable (`TimetableSettings`, edited with the existing auto-assign settings):

| Key | Default | Purpose |
|-----|---------|---------|
| `requests_enabled` | `true` | Hides **Request a path** in Crew jobs and rejects submits when off (the jobs list still works) |
| `request_train_prefix` | `"PR"` | Name prefix for accepted trains |
| `request_default_leg_min` | `5` | Leg running time when no path or timetable data exists (§5.2 step 4) |
| `request_lead_min` | `2` | Lead time from the fast clock for ASAP requests |

## 8. Out of scope

- Track/occupancy conflict detection or interlocking (P7).
- Requests to locations that aren't timetable stations.
- Extending or continuing an existing job (P11).
- Requests from the guard panel (possible later; it would reuse the same endpoint).
- Any run-state control (start/complete) for train crews (P3a).
- Other trains in Crew jobs (P20).
- Sounds for requests (P14).
- Auth/identity beyond picking a crew (the audit log records claimed identity, IP and device; it doesn't verify them).
- Audit logging of non-request planner edits (§4.4 Scope).
- Auto-accept or auto-plotting without Control.

## 9. Docs and release

- `docs/user-guide/`:
  - new pages: "Crew jobs" (for train crews) and "Path requests" (crew + Control);
  - updated pages: planner, mode picker and the new mobile view picker, running a session, and the crew view page, renamed Running board;
  - new screenshots via `npm run docs:screenshots`. The demo data gets a couple of paths and requests, with anonymised crews.
- User guide: the audit log section on the Path requests page. `CLAUDE.md` key files and endpoints (incl. `server/audit.js`, `/api/audit`), `openapi.js`, `CHANGELOG.md`. Minor version (no breaking changes; new optional fields, and `/mobile` keeps its URL).

## 10. Phasing

| Phase | Contents |
|-------|----------|
| 1 | Crew jobs app: mobile view picker at `/mobile` (ask, remember, Change view, `?view=` deep links), Running board label, crew pick, read-only My jobs with live updates and toasts (useful on its own, before requests exist) |
| 2 | Types + `server/path-requests.js` (submit/withdraw/acknowledge/release/decline/cancel-ask/cancel-reject/clear, validation, tests) + `path-requests` sync message + `server/audit.js` (log every request action from day one) and the device-id header. Request form + My requests (Withdraw, Ask to cancel). Planner toast, badge and drawer with Decline / Reject cancel |
| 3 | `pathPlan.ts` (path matching, inferred routes, fallbacks; tests) + `pendingTrain` in `TrainGraph` + edit-bar flow (crew, note, Edit stops) + `/accept` (with retime batch) + `/cancel-approve` + undo step |
| 4 | Settings, warnings, Requested badges, audit log UI (per-request history, Audit log tab, CSV), user guide + screenshots, OpenAPI/CLAUDE.md |

Who builds what, in which order, is in §12. Phase gate: §12.4.

## 11. Open questions

None. Draft 1's questions are answered in §0 (P11–P20).

## 12. Delivery plan

Same model as the guard-panel spec §14.

### 12.1 Roles and models

| Role | Model | Responsibilities |
|------|-------|------------------|
| **Supervisor** | Opus 5.5 (main session) | Write each phase's contracts (types, API shapes, sync message, hook and pure-function signatures) before dispatching; brief agents; merge worktrees; own `App.tsx` integration where waves would collide; run build, Docker and Playwright checks; review; commit; report at each phase gate |
| **Implementer: logic** | Opus 5.5 subagent | Code where subtle bugs are expensive: the request state machine and its races (withdraw vs accept), atomic accept/cancel-approve mutations, path-template routing (`pathPlan.ts`) |
| **Implementer: standard** | Sonnet 5.5 subagent | UI components (Crew jobs, picker, request form, drawer, graph pending train, audit UI), the audit module, settings, docs and screenshots |
| **Sweeper** | Haiku 5.5 subagent | Read-only leftover checks, and syncing `CLAUDE.md`, README, OpenAPI and CHANGELOG with what was built |

### 12.2 Working rules

- **Contracts first.** Before agents start, the supervisor commits the shared types (`types.ts`: `PathRequest`, `SyncMessage` additions, `Train.request_id`), endpoint request/response shapes, the audit entry shape and the `X-LiveRun-Device` header, and the signatures of `resolveMobileView()` and `planDraft()`. Parallel agents build against these.
- **Parallel agents get separate files** and run in **isolated git worktrees**. Two agents never edit the same file in the same wave. `App.tsx` and `TrainGraph.tsx` are hotspots: at most one agent touches each per wave, otherwise the supervisor wires them.
- **New server code goes in new modules** (`server/path-requests.js`, `server/audit.js`), each exporting `register(app, deps)` and called from `index.js` in one line. Train creation shared with `POST /trains` is extracted into a helper rather than copied.
- **Pure logic is a separate module with unit tests**: mobile view resolution, request validation and transitions, audit helpers, `pathPlan.ts`. Client tests use Vitest; server tests use `node:test`.
- **Two-device testing**: Playwright runs a phone context (Crew jobs) and a desktop context (planner) against the same server, so the request → toast → plot → accept → job flow is checked end to end. Demo data gains path templates covering a single-path case, an inferred (chained) case and a no-data leg.
- Branch `feat/path-requests`, **one commit per phase**, no push or PR without asking.

### 12.3 Phases

| Phase | Wave | Agent (model) | Work |
|-------|------|---------------|------|
| **1** Crew jobs | 0 | Supervisor | Contracts: `MobileView` type, `resolveMobileView()` / `loadMobileView()` / `saveMobileView()` signatures, Crew jobs props |
| | 1 ∥ | 1A (Sonnet) | `lib/mode.ts` mobile view functions + tests; `MobilePicker`; `/mobile` entry switch (`?view=` deep links); main picker card → **Mobile**; Running board label and ☰ **Change view** in `CrewMobile` |
| | 1 ∥ | 1B (Sonnet) | `CrewJobs` view: crew pick (all crews), My jobs (running order, special instructions, aliases, loco, notes, current stop, read-only status), live updates and `diffJobs` toasts via `useLiveTimetable`; never renders `guard_events` |
| **2** Requests + audit | 0 | Supervisor | Contracts: `PathRequest` types, endpoint shapes, `path-requests` sync message, audit entry shape, device-id header, `api.ts` signatures |
| | 1 ∥ | 2A (Opus) | `server/path-requests.js`: submit, withdraw (pending/in_review), acknowledge, release, decline, cancel-ask, cancel-reject, clear; validation, 409 state rules, active-timetable check, open-request cap; `{ notify: false }` mutations; `path-requests` message in `sync.js` (on change + after `hello`); tests |
| | 1 ∥ | 2B (Sonnet) | `server/audit.js`: append-only JSONL, 5 MB rotation, `shortUa()`, query + CSV, `GET /api/audit`; tests. Client device id + header in `api.ts` |
| | 1 ∥ | 2C (Sonnet) | Crew jobs: request form (stations, sidings, work stops, ready-at, notes, roster combobox), My requests cards (status, Control's note, Withdraw, Ask to cancel) |
| | 2 | 2D (Sonnet) | Planner: new-request and ask-to-cancel toasts, **Requests** badge, drawer (list, "times from" placeholder, Decline, Return to queue, Reject cancel); sync handling in `App.tsx` |
| | 2 | Supervisor | Merge 2A + 2B: call `audit.js` from every path-request handler (ok and rejected) |
| **3** Plot + accept | 0 | Supervisor | Contracts: `planDraft(request, timetable, clock) → { train, source, warnings }`, `pendingTrain` prop and edit-bar callbacks, accept / cancel-approve bodies |
| | 1 ∥ | 3A (Opus) | `lib/pathPlan.ts`: single-path match (forward/reversed, most direct), leg graph + Dijkstra on median leg times, no-data fallback, duplicate-station fallback, passing points, start time, terminal-stop rule, station-order storage; Vitest |
| | 1 ∥ | 3B (Opus) | Server `/accept` (one mutation: state check, `validateRetime`, shared train creation, retime, request update) and `/cancel-approve` (delete train + `cancelled`); audit details for both; tests incl. withdraw-vs-accept race |
| | 1 ∥ | 3C (Sonnet) | `TrainGraph`: dashed `pendingTrain`, drag/dwell on it, plotting edit bar (crew ▾, note, Edit stops, Accept, Cancel), "crew withdrew" state, warnings |
| | 2 | 3D (Sonnet) | `App.tsx` wiring: Acknowledge → `planDraft` → graph; Accept with undo step; Cancel → release; Edit stops via `TrainEditor` in draft mode; drawer: Resume plotting, Approve cancel, "times from" line, accepted/cancelled links |
| **4** Polish + docs | 1 ∥ | 4A (Sonnet) | Per-timetable settings (keys + UI), **Requested** badges in Crew jobs and Running board, crew-overlap and before-clock warnings |
| | 1 ∥ | 4B (Sonnet) | Audit log UI: per-request history in the drawer, **Audit log** tab with filters, Export CSV |
| | 2 | 4C (Sonnet) | User guide: Crew jobs and Path requests pages, mobile view picker, Running board rename; demo data (paths, requests); `npm run docs:screenshots` |
| | 3 | Sweeper (Haiku) | `CLAUDE.md` (key files, endpoints, architecture notes), OpenAPI, README, CHANGELOG; checks: no run-state controls in Crew jobs, no `guard_events` in Crew jobs, guard panel still hides `special_instructions` |
| **Release** | — | Supervisor + Haiku | Minor version bump, `/code-review` and `/security-review` on the branch (new unauthenticated write endpoints, request text shown to Control, IP/device logging) |

∥ = runs in parallel in separate worktrees.

### 12.4 Phase gate (every phase)

1. `npm run build` (tsc + Vite) and unit tests pass.
2. `docker compose up -d --build`, then a Playwright smoke test of the screens touched, including under `BASE_PATH=/traingraph`.
3. From phase 2 on: the two-device flow (phone + planner). Phase 2: submit → toast → decline/withdraw. Phase 3: submit → acknowledge → plot → accept → job on the phone; withdraw while plotting; ask to cancel → approve. Audit entries checked for each step.
4. Supervisor reviews the diff, commits, and reports to Aaron with a summary and screenshots. **The next phase starts only after Aaron approves.**
