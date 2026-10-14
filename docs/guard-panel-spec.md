# Guard Panel — Design Spec (draft 2)

Status: **spec complete, ready to build**. Nothing implemented yet.
Source: `guard_panel.html` (standalone page, Paho MQTT, direct JMRI JSON WebSocket). This spec is a **rewrite** into LiveRun, not a port — the old code is reference for behaviour only.

## 0. Decisions so far

| # | Decision | Outcome |
|---|----------|---------|
| D1 | Config scope | **Layout-wide** (one `layout` block in the DB, not per timetable) |
| D2 | MQTT broker | **Reuse** the active timetable's `clock_broker_url` / `clock_topic` |
| D3 | JMRI connection | **Browser connects directly** to JMRI (separate host, e.g. `wss://jmri.illawarraline.net/json/`) |
| D4 | LOA config editor | Deferred — LOA itself to be specced first (§11) |
| D5 | Run tracking from guard panel | **No** — managed externally |
| D6 | `train_type` | **Removed entirely** (breaking, v2.0.0). Sound selection moves to train-ID pattern profiles |
| D7 | Mobile entry | Replace UA auto-redirect with a **mode picker** whose choice persists, with a way back |
| D8 | Door state | A single JMRI function: open = ON, close = OFF. Nothing further tracked |
| D9 | CrewMobile filters | Train-type filter dropped; **crew filter only** |
| D10 | Hidden events | **Separate `guard_events` field** — `special_instructions` stays public |
| D11 | Guard train list | Guard **picks their crew** (e.g. "Local Operator 1"); replaces the name/letter filter that hid freights |
| D12 | Sub-path | Prod runs with `BASE_PATH=/traingraph` |
| D13 | Layout-specific behaviour | **No opinionated logic in code.** Formulas are generic; every rule/value is config. Illawarra values live only in `docs/layout.example.json` |
| D14 | Stats consumers | Not a concern — keep a sensible default |
| D15 | Control changes mid-session | **Pushed in real time** to guard panel *and* CrewMobile (§6.5); no more "please refresh" |
| D16 | Function mapping | Per **train profile** (glob on `train_id`): optional tablet sounds + optional decoder function per action, by F-number or roster label (§7.3) |
| D17 | Guard events on the train API | Fine as-is; no separate endpoint |
| D18 | En-route event missed (train arrives first) | **Dropped** |
| D20 | Existing special instructions | **Not converted.** `special_instructions` stays as-is and editable; the owner moves text into guard events by hand |
| D19 | Events driving the loco | Yes — library entries can trigger a profile action (§10.5) |

## 1. Phasing

| Phase | Contents | Breaking? |
|-------|----------|-----------|
| 1 | Remove `train_type`; Train ID roster combobox; `layout` config scaffold (JMRI URL) | **Yes** → v2.0.0 |
| 2 | Live job-change push (§6.5) for CrewMobile, then mode picker + `/guard` shell: crew pick, train select, stop list, clock, connection status | No |
| 3 | JMRI throttle + guard actions + train profiles (sounds + function mapping) + sound library | No |
| 4 | Passenger boarding model + MQTT stats | No |
| 5 | Guard events: library, station + en-route placement (§10) | No (new fields) |
| 6 | Limit of Authority: server topic cache, sections, panel strip/tab, editor (§11) | No |

---

## 2. Breaking change: remove `train_type`

Removed from every layer, plus a one-off startup migration that deletes `train_type` from stored trains (same pattern as the existing terminal-stop migration).

| Location | Change |
|----------|--------|
| `types.ts` | Drop `Train.train_type` |
| `TrainEditor.tsx` | Drop the Train Type field; Train ID becomes the roster combobox (§3) |
| `App.tsx` | Drop `trainType` from save payload |
| `CrewMobile.tsx` | Drop type badge, train-type filter chips and `mob:typeFilter` storage; crew filter remains (D9) |
| `server/index.js` | Create/update/import/duplicate handlers; live API `trainType` field; station board `?trainType=` filter (REST + WS) |
| `openapi.js`, `ws-inspector.html` | Remove `trainType` param/field |

External consumers of `/live/*` or the station-feed WS that read `trainType` or pass `?trainType=` will break. That is accepted (D6); called out in release notes.

## 3. Train ID — JMRI roster combobox

The `train_id` field is the JMRI roster entry name. It becomes a single-value combobox:

- **Typing** shows a dropdown of roster names containing the text (case-insensitive), best prefix match first.
- **Tab / Enter / click** accepts the highlighted suggestion and renders it as a **chip** with a small ×. × clears the chip and returns focus to the text input.
- **Custom values**: Enter on text with no matching suggestion creates a chip anyway, styled dashed with a "not in roster" hint. Still saved.
- Chip also shows which **train profile** the ID resolves to (§7.3), so mis-matches are visible at edit time.
- **Roster source**: fetched by the browser from JMRI (`<jmri http base>/json/roster`, derived from `layout.jmri.url`: `wss→https`, `ws→http`, path `/json/roster`). Cached in memory for the page session; refresh button in the dropdown footer.
- **JMRI unreachable / not configured**: plain text input, no suggestions, small "roster unavailable" note. Saving never depends on JMRI.

## 4. Layout configuration

### 4.1 Storage

New top-level key in the JSON DB alongside `timetables`:

```jsonc
"layout": {
  "jmri": {
    "url": "wss://jmri.illawarraline.net/json/"
  },
  "guard": {
    "event_alert_sound": "bell_alert_4.mp3"
  },
  "train_profiles": [ /* §7.3 */ ],
  "boarding": { /* §8 */ },
  "stats": { /* §9 */ },
  "events": { /* §10 — pending */ },
  "loa": { "sections": [] }  /* §11 */
}
```

Defaults are generic (empty URLs, no profiles, no stats). The current Illawarra values ship as `docs/layout.example.json` — nothing layout-specific in code.

### 4.2 API

```
GET  /api/layout          → full layout config (defaults merged)
PUT  /api/layout          → replace; server validates (URL schemes, globs, numeric ranges)
GET  /api/sounds          → [{ file, size }]
POST /api/sounds          → upload (audio/mpeg|ogg|wav, ≤ 2 MB, raw body, filename via query)
DELETE /api/sounds/:file
GET  /api/sounds/:file    → serves audio
```

Sounds live in the data volume (`server/data/sounds/`), seeded on first start with the 7 MP3s from the zip (bundled in the image under `server/default-sounds/`). Adding a new train's sounds needs no rebuild.

Validation mirrors existing `clock_broker_url` checks: `jmri.url` must be `ws:`/`wss:`. If LiveRun is served over HTTPS the browser will refuse `ws:` (mixed content) — the settings UI warns about this.

### 4.3 UI

New **Layout** settings panel (separate from per-timetable Settings), with sections: JMRI, Guard panel, Train profiles, Sound library, Boarding, Stats. Plus **Export / Import layout JSON** buttons (covers backup and moving between installs).

## 5. Entry routing and mode picker

### 5.1 Behaviour

| URL | Result |
|-----|--------|
| `…/guard` | Guard panel (always) |
| `…/mobile` | Crew view (always) |
| `…/?desktop` | Planner (always; existing escape hatch) |
| `…/?choose` | Mode picker (always) |
| `…/` with saved mode | Saved mode (`history.replaceState` to `…/guard` or `…/mobile`, no reload) |
| `…/` no saved mode, mobile/tablet UA | Mode picker |
| `…/` no saved mode, desktop UA | Planner (unchanged) |

- **Mode picker**: three large cards — *Guard panel*, *Crew view*, *Planner* — plus a "Remember this choice on this device" toggle (default on). Saves `localStorage['liverun.mode']`.
- **Way back**: Guard panel and Crew view headers get a "Switch mode" item that clears the saved mode and goes to `…/?choose`. Planner gets a "Guard panel" link in the toolbar.
- Explicit `/guard` / `/mobile` URLs don't alter the saved mode (bookmarks stay predictable).

### 5.2 Sub-path deployment (`ops.illawarraline.net/traingraph`, `BASE_PATH=/traingraph`)

The proxy passes the full path and the server's `BASE_PATH` middleware strips the prefix. Client URLs stay relative (Vite `base: './'`). Guards:

- **Trailing slash**: `…/guard/` would resolve `./assets` and `./api` one level too deep. Server returns `301` with a **relative** `Location: ../guard` for `/guard/` and `/mobile/` — correct with or without a prefix.
- Path detection in `main.tsx` uses "pathname ends with `/guard`" (as `/mobile` does today).
- Test matrix: `/guard`, `/guard/`, `/traingraph/guard`, `/traingraph/guard/`, deep reload of each, sync WS under the prefix.

> Aside (existing bug, found while checking this): the `/api` rate limiter is registered *before* the `BASE_PATH` rewrite, so under `/traingraph` it never matches and rate limiting is effectively off in prod. Fix by moving the rewrite middleware first.

## 6. Guard panel

### 6.1 Layout (tablet landscape primary; portrait stacks columns)

```
┌──────────────────────────────────────────────────────────────────────┐
│ [◀ Back] [ Train: 23L  ▾ ]        14:07        ● MQTT ● JMRI    ☰  │
├───────────────────────────────┬──────────────────────────────────────┤
│  ┌─────────────────────────┐  │  23L  → forms 24L                    │
│  │  ⚠ INSTRUCTION (flash)  │  │  ┌──────────┬───────┬───────┐        │
│  │  text…        [ ACK ]   │  │  │ Kiama    │       │ 14:02 │        │
│  └─────────────────────────┘  │  │▶Bombo    │ 14:06 │ 14:07 │ ← now  │
│  Boarding        41           │  │ Minnamurra│      │ 14:11 │        │
│  ████████░░░░  (runner!)      │  │ …        │       │       │        │
│                               │  └──────────┴───────┴───────┘        │
│  [   DOORS OPEN   ] [ CLOSE ] │                                      │
│  DOIL ●   [ BELL ]            │  Roster: CityRail V-12  · V set      │
│                               │  Dir: Up · Notes: …                  │
└───────────────────────────────┴──────────────────────────────────────┘
```

- First interaction shows a **"Tap to start"** overlay — unlocks audio (browser autoplay rules) and requests a **screen wake lock**.
- ☰ menu: Change crew, Switch mode, Reset events for this train, Reload.
- Header shows the crew name next to the train selector.
- Dark Tailwind theme; touch targets ≥ 48 px; door buttons largest on screen.

### 6.2 Data

- Active timetable from `GET /api/active-timetable`.
- **Crew choice (D11)**: on first open (and from ☰ → Change crew) the guard picks their name from the timetable's crews ticked **Guard** in the planner (`Crew.guard_visible`, opt-in) ("Local Operator 1", …). The train selector then lists **only that crew's trains, in run order**. Freights belong to other crews, so no name/type filtering is needed. An "All trains" entry stays available at the bottom of the crew list for relief/testing. Stored in `localStorage['guard:crew']` (single crew; independent of CrewMobile's multi-select `mob:crewFilter`). If the stored crew no longer exists in the active timetable, the picker reopens.
- **Auto-select train**: on load / crew change, pick the crew's train whose time span contains the fast clock, else the next one to start; else the first. Manual selection persisted and restored while it's still valid.
- Trains without a `train_id` are listed; JMRI controls show "no roster ID" (§7.1).
- The panel holds the **full timetable** via the shared `useLiveTimetable` hook (same as CrewMobile), so it has trains, stops, stations and crews without extra live-API endpoints.
- Stops shown in **running order**. The planner stores stops in station order, so a train running the other way is stored backwards; the panel reverses it when its times run backwards (midnight-safe, `runningOrder()`). An aliased stop leads with the alias (e.g. *Sydney Terminal*) with the real location (*Staging (Up)*) underneath. **Hidden events are never rendered** in the list (§10).
- "Forms next service" link on the last stop navigates; back stack as today.
- **Live refresh**: see §6.5.
- All requests use an abort/sequence guard so a slow response for a previously-selected train can't overwrite the current one.

### 6.3 Current stop

Needed for highlighting, boarding, stats and events.

- **Auto**: from the fast clock — the stop whose `[arrival ?? departure, departure ?? arrival]` window contains the clock, else the next upcoming stop. Times parsed to minutes (existing `parseClockTime`), midnight-safe.
- **Manual override**: tap a row to pin it as "at platform". Cleared on the next door-close.
- Door-open always records the stop it happened at (manual pin wins, else auto).

### 6.4 Connections

| Link | Implementation | On loss |
|------|----------------|---------|
| API | `api.ts` | Banner; retry |
| MQTT | Generalised `useMqtt` hook (bundled `mqtt` lib, no CDN), auto-reconnect, resubscribe on reconnect | Status dot red; clock shows last value greyed |
| JMRI | `useJmriThrottle` hook, reconnect with backoff (1 s → 30 s), ping every 15 s | Status dot red; **door buttons disabled** — no command queuing |

### 6.5 Live job changes from Control (D15)

Control deletes, reassigns, adds and retimes jobs mid-session. Today crews are asked to refresh. Both the **guard panel and CrewMobile** must pick changes up within a second or two, with no refresh.

**Server push**
- `mutateTimetable` (db.js) also bumps a per-timetable **`rev`** counter and notifies a listener. index.js broadcasts `{ type: 'timetable-updated', timetableId, rev }` on `/api/live/sync`.
- The direct-`writeDB` paths that matter are hooked as well: delete timetable (`timetable-deleted`) and set active timetable (`active-changed`).
- Broadcasts are **coalesced** per timetable (≈300 ms trailing), so a burst of planner edits or an undo/redo sends one notice.
- The notice carries no data. Clients re-fetch; on a LAN that's cheap and avoids a second diff format to keep in sync.

**Missed messages**
- The WS `hello` on connect includes the current `rev`. A client re-fetches if it differs from what it holds. This covers reconnects, tablets waking from sleep, and server restarts.
- Also re-fetch on `visibilitychange` → visible. No polling.

**Stable identity**
- The guard panel tracks trains by **id**, not name (it has the full timetable), so a rename shows as a rename, not a delete plus an add. Rolled event state (§10.4) is keyed by train id too.

**What the guard/crew sees.** The client diffs the old and new job lists for its crew:

| Change | Guard panel | CrewMobile |
|--------|-------------|------------|
| Job **added** to my crew | Toast "New job: 31L (14:20)" + alert sound; list updates | Card appears, highlighted "NEW" |
| Job **removed** or **reassigned** away — *not* the selected train | Toast "23L removed" / "23L → Local Operator 2"; list updates | Card disappears; toast |
| Selected train **removed/reassigned** | **Blocking banner** "Control has removed 23L from your jobs" + alert, **ACK** required. Until ACK the train stays loaded and **Door Close still works**, so doors are never left open on the loco. On ACK: release throttle, move to the next job (§6.2 auto-select) | Toast |
| **Retimed** / stops changed | Stop table updates in place; changed cells flash for a few seconds; toast "23L retimed" | Card updates, changed times highlighted |
| Train **renamed** | Name updates in place | Same |
| Next-crew-service changes | "Forms" link updates | Same |
| My **crew deleted** | Banner, then crew picker | Crew filter drops the stale id (already handled) |
| **Active timetable changed** / deleted | Banner "Control switched to *X*", ACK → reload into the new timetable, crew picker if the crew name isn't there | Reload into the new timetable |

- Toasts stack top-right and auto-hide after ~8 s. The last 10 sit in a "Changes from Control" list under ☰.
- Boarding in progress, pending guard events and door state are never reset by an update unless the selected train itself was removed (and then only after ACK).

## 7. Doors, JMRI throttle, sounds and functions

### 7.1 Throttle

- On train select: release previous throttle, acquire new one: `{type:'throttle', data:{name: <throttleName>, rosterEntry: <train_id>}}`.
- `throttleName = "guard-<panelId>"` where `panelId` is a random id stored per device — stable across reloads, unique per tablet. One protocol key (`name`) used consistently.
- Which function keys to drive comes from the train's **profile** (§7.3), resolved against the roster entry.
- On reconnect: re-acquire. On page hide/unload: release (any held/pulsed functions are turned off first).
- If the train has no `train_id`, the roster entry is missing, or the profile maps no function for an action: that action still plays its tablet sound and runs boarding; a small chip says why JMRI isn't being driven for it.

### 7.2 Guard actions (D8, D16)

| Button | JMRI (if mapped) | Tablet sound (if set) | DOIL | Boarding |
|--------|------------------|------------------------|------|----------|
| **Doors Open** | profile `door_open` action | profile `door_open` | on | starts when open sound ends (fallback `boarding.start_delay_s`) |
| **Doors Close** | profile `door_close` action | profile `door_close` | off when close sound ends (fallback `boarding.doil_off_delay_s`) | stops; remaining → "left behind"; stats published (§9) |
| **Bell** | profile `bell` action | profile `bell` | — | — |

- Repeated presses cancel pending timers (pulses, DOIL, boarding start) from the previous press.
- When doors are a **latching** function, the DOIL follows the state JMRI reports back, so it stays right if a driver toggles the same function from a handheld. With separate open/close pulses, the DOIL is tracked locally.

### 7.3 Train profiles (D16)

Replaces "sound profiles" and the global `door_function_label`. A profile says, for every loco/set whose `train_id` matches, **which tablet sounds to play and which decoder functions to drive** — because some engines are sound-equipped and some aren't, and mappings differ between decoders.

```jsonc
"train_profiles": [
  { "id": "tangara-sound", "name": "Tangara (sound decoder)",
    "match": ["CityRail ?T-*"],
    "sounds":  { "door_open": "", "door_close": "", "bell": "" },          // decoder makes the noise
    "functions": {
      "door_open":    { "key": { "label": "Door Open/Close" }, "mode": "on" },
      "door_close":   { "key": { "label": "Door Open/Close" }, "mode": "off" },
      "bell":         { "key": { "fn": 2 }, "mode": "pulse", "pulse_ms": 600 },
      "brake_squeal": { "key": { "fn": 8 }, "mode": "on_for", "duration_s": 12 }
    } },
  { "id": "v-set", "name": "V set (no sound)",
    "match": ["CityRail ?V-*"],
    "sounds":  { "door_open": "s-door-open.mp3", "door_close": "s-door-close.mp3", "bell": "bell.mp3" },
    "functions": {
      "door_open":  { "key": { "fn": 6 }, "mode": "on" },                    // e.g. door lights only
      "door_close": { "key": { "fn": 6 }, "mode": "off" }
    } },
  { "id": "default", "name": "Default", "match": [],                        // empty = fallback
    "sounds": { "door_open": "", "door_close": "", "bell": "bell.mp3" },
    "functions": {} }
]
```

**Matching.** `match` = case-insensitive **globs** on `train_id` (`*` any run, `?` one char). Ordered list, **first match wins**; a profile with empty `match` is the fallback. A one-off loco gets its own profile with an exact pattern placed above the general one.

**Actions.** Fixed names `door_open`, `door_close`, `bell`, plus any **custom names** (e.g. `brake_squeal`, `horn`) that guard events can call (§10.5). Every entry is optional; anything unmapped is simply not sent.

**Key.** Either an explicit function number `{ "fn": 0–68 }`, or a roster label `{ "label": "Door Open/Close" }` looked up in that loco's roster `functionKeys[]`. Label lookup lets one profile cover locos whose decoders put the same feature on different keys, as long as the roster labels are consistent. If a label isn't found on a loco, that action is skipped with a warning chip.

**Mode.**

| Mode | Sends | Typical use |
|------|-------|-------------|
| `on` / `off` | Set F on / off | Latching door function: open = `on`, close = `off` (same key) |
| `toggle` | Flip current F state | Decoders where one press opens and the next closes |
| `pulse` | On, then off after `pulse_ms` | Separate momentary door-open / door-close sounds, bell |
| `hold` | On while the button is held, off on release | Bell/buzzer held like the real thing |
| `on_for` | On, then off after `duration_s` | Event effects (brake squeal) |

**Editor.** One row per action: action name, key (fn number or roster label), mode, timing. Plus:
- a **Test** button that sends the action to a chosen roster loco;
- a **preview** listing every train in the active timetable with its resolved profile, the actual F-numbers each action resolves to on that loco, and warnings (label not found, unmatched train IDs).

Matching and resolution run client-side; the same code feeds the Train ID chip (§3), which shows the profile name.

## 8. Passenger boarding model

Replaces "uniform 1–75, drop 1–10 every 1–2 s". Per D13 the **formula is generic and every input is config** — no built-in peaks, directions or curves. With defaults (flat curve, no rules) it behaves like a tidier version of today's random count.

### 8.1 How many

```
expected = max_passengers × demand(clock) × Π(matching rule factors) × station_weight × position_factor
count    = round( max(0, expected + noise) ),   noise ~ Normal(0, √expected + spread·expected)
```

| Input | Meaning | Default (neutral) |
|-------|---------|-------------------|
| `max_passengers` | Load at demand 1.0, weight 1.0 | 60 |
| `demand_curve` | `[[ "HH:MM", factor ], …]`, piecewise-linear over fast-clock time | `[["00:00",1],["24:00",1]]` (flat) |
| `rules[]` | Zero or more `{ name, when: { direction?, train_id?, train_name?, from?, to? }, factor }`. All `when` keys optional; text matches are case-insensitive globs against the train's fields; `from`/`to` is a clock window (may cross midnight). Every matching rule multiplies in | `[]` |
| `station_weight` | Optional `Station.boarding_weight` (0–2) in the station manager | 1.0 |
| `position.origin` / `.intermediate` / `.terminus` | Factor by the stop's place in the train's run | 1 / 1 / 0 |
| `spread` | Extra randomness as a fraction of expected | 0.15 |

If the fast clock isn't running, the stop's scheduled time is used for `demand` and rule windows.

Illawarra example (in `docs/layout.example.json` only):

```jsonc
"demand_curve": [["00:00",.02],["05:00",.05],["06:00",.4],["07:00",.85],["08:00",1],["09:00",.6],["10:00",.35],
                 ["14:30",.4],["15:30",.6],["16:30",.85],["17:30",1],["18:30",.6],["19:30",.3],["22:00",.12],["24:00",.02]],
"rules": [
  { "name": "AM counter-peak", "when": { "direction": "Down", "from": "06:00", "to": "09:30" }, "factor": 0.45 },
  { "name": "PM counter-peak", "when": { "direction": "Up",   "from": "15:30", "to": "18:30" }, "factor": 0.45 }
],
"position": { "origin": 1.2, "intermediate": 1, "terminus": 0 }
```

The Layout settings screen draws the demand curve and shows a "what would board" preview for a chosen train/stop/time.

### 8.2 How long

Real-time seconds, ticked every `tick_s` with ±`jitter`:

1. **Main flow** — each tick boards `Poisson(flow_rate)` passengers.
2. **Stragglers** — once ≤ `straggler_threshold` remain, rate drops to `straggler_rate` with longer gaps.
3. **Runners** — after reaching 0 and before Close, with probability `runner_chance × demand(clock)`, `runner_count` runners appear after `runner_delay_s`; counter bumps up and flashes "RUNNER".

| Param | Default |
|-------|---------|
| `tick_s` / `jitter` | 1 / 0.3 |
| `flow_rate` | 3 per tick |
| `straggler_threshold` / `straggler_rate` | 5 / 0.5 |
| `runner_chance` / `runner_count` / `runner_delay_s` | 0.2 / [1,3] / [2,6] |
| `start_delay_s` (if no door-open sound) | 4 |
| `doil_off_delay_s` (if no door-close sound) | 8 |

Closing with passengers remaining records them as left behind.

### 8.3 Optional: alighting phase

`show_alighting` (off by default): an "Alighting" count runs down before boarding. Uses the same machinery with its own `alighting` block (`max_passengers`, `demand_curve`, `rules`, `position`), so a layout can express "lots get off at the city end in the morning" without code.

## 9. Stats publishing (MQTT)

Blind push from the browser, as today — QoS 0, not retained, no acknowledgement. Off by default (D13); the Illawarra topic goes in the example layout.

```jsonc
"stats": {
  "enabled": false,
  "topic": "",                                       // e.g. "trains/stats/passengersMoved/{train}"; placeholders {train} {trainId} {station}
  "payload": "count",                                  // "count" (plain integer, as today) | "json"
  "publish_on": "door_close"                           // "boarding_start" (today's behaviour) | "door_close"
}
```

- `count` = plain integer, matching what the old panel sent.
- `json` payload: `{ train, trainId, station, boarded, leftBehind, runners, clock, dwellSeconds, at }`.
- Topic placeholder values are sanitised (`/ + #` → `_`).
- If MQTT is briefly down, mqtt.js's offline queue holds the message and sends it on reconnect (cap 50). Nothing is persisted beyond the page session.

## 10. Guard events (hidden, scripted)

### 10.1 Why change

- Today's trigger is the **exact** fast-clock minute = scheduled arr/dep: a late train gets the instruction before it reaches the station; a skipped minute misses it.
- Same instruction every session — crews learn it.
- It uses `special_instructions`, which is **also printed on the Station Report and returned by the live station board API**, so it isn't hidden.

### 10.2 Separate field (D10)

- `special_instructions` stays the **public** operating note. Unchanged.
- New **`guard_events`**, read only by the guard panel. Stripped server-side from the live station board/feed, never shown on Station Report, CrewMobile, the graph tooltip, or the guard panel's own stop list.

### 10.3 Two kinds of event

The two real-world cases need different anchors:

| Kind | Examples | Anchored to | Fires |
|------|----------|-------------|-------|
| **Station** | Unruly passenger, platform incident, wheelchair ramp, late connection | A **stop** | On a door event at that stop — `door_open`, `boarding_done` or `door_close` — after a random delay |
| **En-route** | Sticking brakes, signal at stop, track obstruction | A **section** between a stop and the train's next stop | At a random point within the section's running time, measured from the train's **actual departure** |

**En-route timing.** Section start = the guard's Door Close at the last stopping point at or before the section (i.e. when the train really left), plus the scheduled offset to the section start if it begins at a pass-through stop. Fire time = start + `at` × scheduled section run time, with `at` random within e.g. `[0.2, 0.8]`. Measured on the fast clock; falls back to scheduled clock times if no Door Close was recorded.
If the train reaches the next stop (Door Open) before the event fires, the event is **dropped** (D18).

### 10.4 Randomness

Applies to both kinds:

- **Probability** — chance the event happens at all this run.
- **Message pool** — several wordings; one picked at random.
- **Timing** — random delay (station) or random position in section (en-route).

Rolled once when the train is first selected on a device, then stored, so reloads don't re-roll or re-fire. ☰ → "Reset events for this train" clears it.

### 10.5 Event library + per-train placement

Authoring "sticking brakes" by hand on 40 trains is tedious, so:

```jsonc
// layout.events.library — reusable definitions
{ "id": "sticking-brakes", "name": "Sticking brakes", "kind": "enroute",
  "messages": ["Driver reports brakes dragging on car 3 — proceed at caution", "…"],
  "sound": "",                                      // "" = layout.guard.event_alert_sound
  "action": "brake_squeal" }                        // optional profile action (§7.3, D19)

// TrainStop.guard_events[] — placement on a train
{ "event": "sticking-brakes",                       // library id, or inline:
  "messages": null,                                 //   …override/inline wording
  "probability": 0.3,
  "trigger": "door_close",                          // station kind only
  "delay_s": [0, 20],                               // station kind only
  "at": [0.2, 0.8] }                                // en-route kind only
```

En-route placements sit on the stop where the section **starts** ("between this stop and the next"). TrainEditor shows them under a collapsed "Guard events" disclosure per stop.

**Driving the loco (D19).** If an event names an `action`, then when the event fires the panel runs that action from the train's profile, e.g. `brake_squeal` → F8 `on_for` 12 s. If the train's profile doesn't define that action (a non-sound loco), only the message and alert are shown. The action runs at fire time, before the guard acknowledges, so the crew hear it with no warning.

### 10.6 Optional: random pool (later)

`layout.events.random = { enabled, station_chance, enroute_chance, max_per_run, pool: [library ids] }` — sprinkles library events onto any run without per-train placement. Same machinery; can be added after the authored events work.

### 10.7 On fire

Flashing banner + alert sound until **ACK**; multiple pending events queue. Optionally publishes `{ train, station/section, event, message, clock }` to `layout.events.publish_topic` (blank = off) so a controller board or logger can see what was thrown at the crew.

## 11. Limit of Authority (LOA)

Decisions L1–L6 are recorded inline below. The guard panel shows dots and labels only, never raw MQTT values.

### 11.1 What the old panel did

- Shown only for `train_type === 'E'`. Direction came from whether the run number was odd or even. Two hard-coded lists (`LOA_DOWN`, `LOA_UP`), each split into segments such as *Kiama–Berry*.
- A segment had 3 elements. Each was an MQTT topic plus the value(s) that mean "clear": signal masts (`R285; Lit; Unheld`), signals modelled as turnouts (`THROWN`), and staffs (`CATS`).
- One element was a **switch pair**: the Kiama Down Loop turnout decided whether Sig 45.25 or Sig 45.27 applied.
- A segment **latched "AUTHORITY GRANTED"** once every element was clear *at the same time*. It reset to AWAIT only when the segment's staff stopped being clear (staff returned).
- Dots stayed grey until the first message arrived.

### 11.2 Model: sections between stations

There are no train types, odd/even rules or Up/Down lists. LOA is a layout-level list of **directional sections**, each running from one station to another:

```jsonc
"loa": {
  "sections": [
    { "id": "kia-bry", "name": "Kiama → Berry", "from": "Kiama", "to": "Berry",
      "only": [], "except": [],                     // optional globs on train_id / train name
      "elements": [ /* §11.3, in the order shown */ ] }
  ]
}
```

- **Which trains get LOA.** A section applies to a train when its stop list contains `from` and then, later on, `to`. Intermediate stations in between are fine. Station names are matched case-insensitively, the same way the live station API does it. Trains that never run south of Kiama simply get no LOA, so neither train type nor an "E" flag is needed. `only` / `except` handle exceptions such as exempting light engines.
- **Direction** comes from the order of the stations, so it doesn't matter how a train is numbered. A train that runs Kiama → Berry → Kiama gets both sections, in order.
- Sections are directional, because Up and Down use different signals. Both directions can share the same token topic.

### 11.3 Elements

Everything an element watches is an MQTT topic, and its state is decided by comparing the topic's payload against lists of values (globs allowed, e.g. `R28?; Lit; Unheld`).

| Type | Meaning | Default `grants` | Default `revokes` |
|------|---------|------------------|-------------------|
| `signal` | Signal, mast, or a signal modelled as a turnout | true | false |
| `token` | Staff, ticket or token instrument | true | **true** |
| `condition` | Anything else: track circuit, block instrument, controller release | true | false |
| `selector` | Picks **which** element applies from another topic, e.g. a turnout choosing the departure road. Generalises the old switch pair to N options. The flags come from the option that applies | — | — |

Two tick boxes per element (L5) say what it does:
- **Grants**: must be clear, together with every other granting element, for the section to be granted.
- **Revokes**: going back to not-clear releases the authority.

The defaults reproduce the old panel: all three dots grant, only the staff revokes.

```jsonc
{ "type": "selector", "label": "Kiama departure",
  "topic": "trains/track/turnout/Kiama/Down Loop/State",
  "options": {
    "CLOSED": { "type": "signal", "label": "Sig 45.25", "topic": "trains/track/signalmast/KIA-45.25", "clear": ["R285; Lit; Unheld"] },
    "THROWN": { "type": "signal", "label": "Sig 45.27", "topic": "trains/track/signalmast/KIA-45.27", "clear": ["R286; Lit; Unheld"] }
  },
  "default": "CLOSED" }

{ "type": "token",  "label": "Kiama–Berry staff", "topic": "trains/staff/kiama-berry", "clear": ["CATS"] }
{ "type": "signal", "label": "Sig 7 (Berry)",     "topic": "trains/track/signal/Berry/7", "clear": ["THROWN"],
  "caution": [] }   // optional: values that count as clear but show amber
```

Each element shows a dot: green = clear, amber = caution, red = not clear, grey "?" = no value received yet.

### 11.4 Section state

```
UNKNOWN ──first values──▶ AWAIT ──all granting elements──▶ GRANTED ──revoking element──▶ COMPLETE
                                    clear at once                    goes not-clear       (released)
```

LOA is driven **only by the safeworking elements (L6)**. The guard's doors are not a safeworking element, so they are never interlocked with LOA in either direction. Pinned stops and the fast clock play no part either.

- **Grant rule (L1)**: GRANTED only when **every granting element is clear at the same moment** (caution counts as clear). Elements not ticked *Grants* are shown but never hold the grant up.
- **Revoke (L5)**: a GRANTED section is released when a *Revokes* element goes not-clear ('no value' never revokes), e.g. the staff sunk at Berry. The section is then COMPLETE and the panel moves to the next section. In the field, the interlocking stops the departure signal re-clearing while the staff is out, so the train keeps its authority all the way to the staff being sunk.
- **Frozen**: a completed section is never re-granted, so a following train getting the same staff can't bring it back.
- **Current section**: the first section on the train's route that isn't COMPLETE.
- **Persistence**: latch and complete state are stored per device under timetable + train id, the same as guard events, so a reload keeps them. There is **no manual reset**: LOA is governed entirely by Control through the field elements.

### 11.5 Initial state: server-side topic cache

Without retained messages on the broker, every dot is grey until something changes. That is the most likely failure in a live session, because a tablet reloads after the signal has already cleared.

- The server opens **one** MQTT connection, using the active timetable's broker (D2), subscribed to every topic referenced in `loa`. It keeps the last value and timestamp for each.
- When the sync WS connects, it sends a snapshot of those values. After that it pushes changes, coalesced to about every 100 ms. The guard panel therefore doesn't subscribe to LOA topics itself.
- The cache resubscribes when `loa` or the broker settings change.
- The LOA editor uses the same cache to show each topic's live value (§11.7).

Latching stays client-side (§11.4). Only raw topic values are shared.

### 11.6 Guard panel display

- **Strip:** the current section is always visible under the header, e.g. `Kiama → Berry · AUTHORITY GRANTED` or `AWAIT: Kiama–Berry staff, Sig 7`. It names whatever isn't clear yet.
- **Authority tab:** sits next to *Stops* and shows every section on the train's route in order, with element dots. Completed sections are greyed out, and the current one is highlighted.
- **No departure warning (L2 withdrawn, L6):** the doors are not interlocked with LOA, so Doors Close never checks authority.
- A train with no matching sections shows no strip and no tab.

### 11.7 Editor (D4)

LOA has its own section in Layout settings:

- **Section list:** `from` / `to` are dropdowns of station names from the active timetable, plus free text for names that aren't in it. Each section also has its `only` / `except` globs.
- **Element rows:** type, label, topic, and the **live value** shown beside the topic from the server cache. A **"use current value as clear"** button records whatever the signal is showing right now, which avoids typing mast aspect strings. Selectors open a nested list of options.
- **Preview:** pick a train to see the sections it matches, in order, with live element states.
- **JSON view:** for bulk editing, import and export. It's validated on save.
- The Illawarra configuration ships converted in `docs/layout.example.json`. The Kiama, Berry and Nowra sections each way reproduce the old `LOA_DOWN` / `LOA_UP` exactly.

### 11.8 Who sees LOA

- **Guard panel only.**
- CrewMobile gets **no LOA** (L3). On this layout the driver and guard roles are combined, so the person driving already has the guard panel. A second view would also risk contradicting the guard, because grants are latched per device.
- A control overview of LOA for every running train (L4) is **out of scope**.

## 12. Server changes summary

- `db.js`: `layout` read/write helpers with defaults.
- `index.js`:
  - `/api/layout`, `/api/sounds*` (raw-body upload route, size/type checks).
  - `/guard/` and `/mobile/` relative redirects; move `BASE_PATH` rewrite ahead of the rate limiter.
  - Per-timetable `rev` + mutation listener in `db.js`; coalesced `timetable-updated` / `timetable-deleted` / `active-changed` broadcasts on the sync WS; `rev` in the WS hello.
  - `train_type` removal + startup migration.
  - `Station.boarding_weight`; `TrainStop.guard_events` (validated; stripped from station board, station feed and any non-guard live output).
  - LOA topic cache: one server MQTT client on the active broker, subscribed to all `loa` topics; snapshot + coalesced deltas on the sync WS.
  - (No live-API additions needed: guard panel and CrewMobile use the full timetable via `useLiveTimetable`.)
- `openapi.js`, `CLAUDE.md`, `README.md`, `docs/layout.example.json`.
- Version **2.0.0**.

## 13. Open questions

None. All decisions are logged in §0 and inline in §11.

## 14. Delivery plan

### 14.1 Roles and models

| Role | Model | Responsibilities |
|------|-------|------------------|
| **Supervisor** | Opus 5.5 (main session) | Write each phase's contracts (types, API shapes, hook signatures) before dispatching; brief agents; merge worktrees; run build, Docker and Playwright checks; review; commit; report at each phase gate |
| **Implementer: logic** | Opus 5.5 subagent | Stateful or protocol-heavy code where subtle bugs are expensive: real-time sync and diffing, JMRI throttle, event scheduler, LOA state machine and topic cache |
| **Implementer: standard** | Sonnet 5.5 subagent | UI components, editors, CRUD endpoints, mechanical removals, pure-math modules with tests |
| **Sweeper** | Haiku 5.5 subagent | Read-only leftover checks (e.g. no `train_type` remains), and syncing CLAUDE.md, README and OpenAPI with what was built |

### 14.2 Working rules

- **Contracts first.** Before agents start, the supervisor commits the shared types (`types.ts`), API shapes and hook signatures, so parallel agents build against the same interface.
- **Parallel agents get separate files** and run in **isolated git worktrees**. Two agents never edit the same file in the same wave.
- **New server code goes in new modules** (`server/layout.js`, `server/sounds.js`, `server/loa-cache.js`, …), each exporting `register(app, deps)` and called from `index.js` in one line. Handlers stay flat Express routes (no router framework), but `index.js` (about 1,500 lines) stops being a merge hotspot.
- **Pure logic is a separate module with unit tests**: glob matching, profile resolution, boarding model, event scheduler, LOA state machine, job diff. Client tests use Vitest (new dev dependency); server tests use the built-in `node:test`.
- **Dev mocks for hardware**: a local Mosquitto container (WebSocket listener) and `scripts/dev/mock-jmri.js`, a fake JMRI JSON server that serves a roster and logs throttle and function commands. Testing on the real layout is done by Aaron.
- Branch `feat/guard-panel`, **one commit per phase**, no push or PR without asking.

### 14.3 Phases

| Phase | Wave | Agent (model) | Work |
|-------|------|---------------|------|
| **1** Breaking | 0 | Supervisor | Contracts: `Layout` types, layout defaults in `db.js`, `/api/layout` shape |
| | 1 ∥ | 1A (Sonnet) | Server: remove `train_type`, startup migration, OpenAPI, ws-inspector |
| | 1 ∥ | 1B (Sonnet) | Client: remove `train_type` (TrainEditor, App, CrewMobile, types); `useJmriRoster` + `RosterCombobox` |
| | 2 | 1C (Sonnet) | `server/layout.js` + Layout settings panel (JMRI section, export/import) |
| | 3 | Sweeper (Haiku) | Leftover `train_type` check; docs sync |
| **2** | 0 | Supervisor | `rev`/broadcast message contract; `useLiveTimetable` signature; rate-limiter and trailing-slash fixes |
| | 1 ∥ | 2A (Opus) | `rev` + mutation listener, coalesced broadcasts, `rev` in hello, by-id endpoint, crew fields; `useLiveTimetable`; job diff; CrewMobile live updates and toasts |
| | 1 ∥ | 2B (Sonnet) | Mode picker + `main.tsx` routing; GuardPanel shell: crew picker, train list, stop table, clock, current stop, connection dots, tap-to-start, wake lock (stubs `useLiveTimetable` until 2A lands) |
| **3** | 1 ∥ | 3A (Opus) | `useJmriThrottle` (acquire, release, reconnect, report-back), profile resolver, action executor (all modes), `mock-jmri.js` |
| | 1 ∥ | 3B (Sonnet) | `server/sounds.js` (upload, list, delete, first-run seeding); profiles editor with Test and preview |
| | 1 ∥ | 4A (Sonnet) | Boarding engine (pure + tests). Brought forward from phase 4 because it has no dependencies |
| | 2 | 3C (Sonnet) | Wire guard actions into GuardPanel: doors, DOIL, bell hold, no-JMRI chips |
| **4** | 1 | 4B (Sonnet) | Boarding UI, runners and left-behind; `Station.boarding_weight`; boarding settings (curve editor, preview); stats publisher |
| **5** | 1 ∥ | 5A (Opus) | Event scheduler (pure + tests): rolling, persistence, station/en-route timing, drop rule, action trigger |
| | 1 ∥ | 5B (Sonnet) | Server `guard_events` validation and stripping; TrainEditor "Guard events" UI; event library editor |
| | 2 | 5C (Sonnet) | Banner/ACK queue and event publish wiring in GuardPanel |
| **6** | 1 ∥ | 6A (Opus) | `server/loa-cache.js` (single MQTT client, snapshot and deltas on sync WS); LOA state machine (pure + tests) |
| | 1 ∥ | 6B (Sonnet) | LOA editor (live values, capture-as-clear, preview, JSON view); `docs/layout.example.json` with the Illawarra config |
| | 2 | 6C (Sonnet) | Panel strip, Authority tab, departure warning |
| **Release** | — | Supervisor + Haiku | v2.0.0 bump, CLAUDE.md/README/OpenAPI, `/code-review` and `/security-review` on the branch (sound upload is the main new attack surface) |

∥ = runs in parallel in separate worktrees.

### 14.4 Phase gate (every phase)

1. `npm run build` (tsc + Vite) and unit tests pass.
2. `docker compose up -d --build`, then a Playwright smoke test of the screens touched, including under `BASE_PATH=/traingraph` from phase 2 on.
3. Phases 3, 5 and 6 are also checked against the Mosquitto and mock-JMRI setup.
4. Supervisor reviews the diff, commits, and reports to Aaron with a summary and screenshots. **The next phase starts only after Aaron approves.**
