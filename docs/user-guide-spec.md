# User Guide — Docs Spec (draft 1)

Status: **done** (2026-10-15). The guide is in `docs/user-guide/`; this spec is kept as the record of decisions. This spec plans a full user guide for LiveRun v2 under `docs/user-guide/`, and a slimmer README that points into it.

## 1. Why

The README has grown to ~340 lines and still doesn't cover most of v2: the guard panel, layout settings, train profiles, boarding, guard events, Limit of Authority, live changes from Control, graph editing. Feature knowledge is spread across the README, `docs/guard-panel-spec.md` (a design document, not a manual) and CLAUDE.md (for developers). Users need one place, written for them, organised by what they're trying to do.

## 2. Goals and non-goals

**Goals**
- Every user-visible feature documented, in the words the UI uses (button labels, menu names, badges).
- Organised by **role and task**, so a guard never has to read about CATS XML and a planner can find "move a train" in seconds.
- Robust: each feature page states what it does, how to use it, what the guard/crew sees, the rules and limits, and what to do when it goes wrong.
- Accurate against the code at the time of writing, and kept accurate (§8).
- Reads well on GitHub (plain Markdown, relative links, images in the repo). No build step.

**Non-goals**
- Developer docs (stay in CLAUDE.md and code comments).
- Design rationale (stays in `docs/guard-panel-spec.md`; the guide links to it where useful).
- A hosted docs site (possible later, see §9 Q3).

## 3. Audiences

| Audience | Who | Reads |
|----------|-----|-------|
| **Layout owner / Control** | Builds timetables, configures the layout, runs sessions | Planner, Layout settings, Running a session, Integrations |
| **Guard** | Rides with a train on a tablet | Guard panel (and the quick start) |
| **Crew / driver** | Follows their jobs on a phone | Crew view |
| **Integrator** | Connects JMRI, CATS, displays, scripts | Integrations |

On some layouts (e.g. the owner's) the driver and guard are the same person; the guide says so where it matters (LOA is guard-panel only).

## 4. Information architecture

```
README.md                       overview, feature table, install, upgrading to 2.0, security, links into the guide
docs/user-guide/
  README.md                     index: the three screens, who uses what, a first session in 10 steps, glossary
  planner.md                    building a timetable: timetables, stations, paths, trains, crews, the train graph,
                                graph editing, printing, backups, settings & fast clock, undo/redo
  running-a-session.md          Control's checklist: before / during / after a session
  layout-settings.md            every Layout settings section, with worked examples
  guard-panel.md                the guard's manual, screen by screen
  crew-view.md                  the crew/driver phone view
  limit-of-authority.md         LOA in depth: model, configuring, what the guard sees, operating rules
  integrations.md               live REST API, WebSockets, MQTT topics, JMRI, CATS XML export
  troubleshooting.md            symptoms → causes → fixes, across all screens
  images/                       screenshots for the guide (see §7)
```

LOA gets its own page because it spans configuration (layout settings), operation (guard panel) and operating rules, and it's the feature most likely to be misread.

## 5. Page outlines

Each page opens with a two-line "what this page is for / who it's for", then a short contents list.

### 5.1 `docs/user-guide/README.md` — index
- What LiveRun is, in three sentences.
- **The three screens**: planner (desktop), crew view (`/mobile`), guard panel (`/guard`), with a screenshot each; the **mode picker** and how a device remembers its choice (`?choose`, `?desktop`, Switch mode).
- Who should read which page (table from §3).
- **A first session in 10 steps** (replaces the README's "Running your first session").
- **Glossary**: active timetable, fast clock, crew / job, run order, pass-through vs dwell, train ID (JMRI roster name), train profile, guard event, special instruction, LOA section / element / grant / revoke, Control.

### 5.2 `planner.md`
- **Timetables**: create, duplicate, import/export JSON, delete; the active timetable (🟢) and what "active" exposes.
- **Stations**: name, short code, graph position vs distance label, branches, push-down insert, location alias toggle, name styling, boarding weight.
- **Paths**: route templates; applying a path to fill times.
- **Trains**: the train editor field by field (name, colour, train ID combobox from the JMRI roster, direction, notes, crew); stops (arrival/departure, terminal rules, special instructions, location alias, guard events); badges in the train list (**N**, **S**, crew initials); search; hide from graph; run status.
  - Note: stops are stored in station order; the guard panel and crew views show running order.
- **Crews**: create/edit/reorder, colours, the **Guard** tick box (who appears in the guard panel), auto-assign and its options, overlaps, filter the graph by crew, unassign.
- **The train graph**: reading it, zoom (horizontal/vertical), pan, tooltips, branch bands, fast-clock hairline, running/completed styling.
- **Editing on the graph**: ✎ Edit → drag a train / drag a ◯ dwell handle → Done / Cancel; rules (running times fixed, dwell ≥ 0, later stops follow, drafts with ghosts, one undo step, what crews see, conflicts "stops were changed after it was moved", Edit off on load).
- **Undo/redo**: what it covers (timetable edits) and doesn't (run status).
- **Printing**: station report, working timetable, train graph.
- **Settings**: distance units, station labels, fast clock (broker URL, topic, enable), JMRI clock script download, developer tools.

### 5.3 `running-a-session.md`
- **Before**: export a JSON backup; set the active timetable; fast clock running; layout settings checked (JMRI URL, profiles, LOA); tick the crews that use the guard panel; tablets open the guard panel, **Tap to start**, pick crew, **open their first train before Control sets up its authority**.
- **During**: making changes (they reach crews in a second or two — table of what each change looks like to guards and crews); moving trains on the graph (drafts until Done); run status; watching LOA.
- **After**: reset run statuses; export a backup; LOA state on tablets expires after 12 h.
- **If something goes wrong** → links into troubleshooting.

### 5.4 `layout-settings.md`
One section per Layout settings page, each with *what it's for*, *every field*, *a worked example*, *how to test it*:
- **JMRI**: WebSocket URL; roster suggestions; the guard panel throttle.
- **Guard panel**: event alert sound.
- **Train profiles**: matching (globs on train ID, first match wins, fallback), tablet sounds, decoder functions (F-number vs roster label), modes (on/off/toggle/pulse/hold/on_for), custom actions for guard events, Test button, preview.
- **Sound library**: upload/delete, formats and size limits, the built-in sounds.
- **Boarding**: the formula in plain words, demand curve, rules, station weight, position factors, timing (flow, stragglers, runners), alighting, the preview.
- **Stats**: topic template and placeholders, payload count vs JSON (fields), publish on boarding start vs door close.
- **Guard events**: library (station vs en-route, messages, sound, loco action), placement on a train's stops (probability, trigger, delay, position), publish topic.
- **Limit of authority**: summary + link to `limit-of-authority.md`.
- **Export / import layout JSON**; `docs/layout.example.json` as a starting point.

### 5.5 `guard-panel.md`
- Opening it; **Tap to start** (sound + keeps the screen awake); picking your crew (only ticked crews; All trains).
- **The header**: ◀ previous job / train list / next job ▶, crew name, fast clock (grey when stale), connection dots (Live, JMRI, Clock), ☰ menu items.
- **Stop list**: running order, current stop and "Next", pass-throughs, aliases (alias first, real location underneath), **tap to pin** "At platform" (cleared on Doors Close), changed stops flash.
- **Doors, DOIL and bell**: what each button does on the loco and on the tablet; why a button is disabled (JMRI disconnected, acquiring, refused, no roster ID); sounds-only locos.
- **Boarding**: when it starts (end of the door-open sound or the fixed delay), the count, stragglers, **RUNNER**, closing early (left behind), "current stop unknown".
- **Guard events**: what a banner means, ACK, queued events, they survive reloads, "Reset events for this train".
- **Limit of authority**: the strip and Authority panel at a glance (detail in `limit-of-authority.md`).
- **Changes from Control**: toasts, flashing retimed stops, the removed/reassigned banner (Door Close still works until ACK), timetable switched banner, ☰ → Changes from Control history.
- **When connections drop**: what still works without JMRI / MQTT / the server.

### 5.6 `crew-view.md`
- Opening it; choosing a timetable; crew filter (multi-select, saved per device).
- Job cards: times, stops, run status (tap to mark running / completed / clear), reset all statuses.
- Live changes: toasts, **NEW** ring (60 s), retimed highlight (10 s), crew removed, timetable switched or deleted.
- Switching mode / back to the planner.

### 5.7 `limit-of-authority.md`
- **The model**: one-way sections between stations; which trains get a section (stop order; only/except); elements (signal, token, condition, selector) and their dots.
- **Grant and revoke**: Grants tick box (all granting elements clear at the same moment), Revokes tick box (an element releases the authority when it returns to not-clear after having been clear since the grant); the panel moves on; released sections never re-grant.
- **Driven only by the safeworking elements**: doors, pinned stops and the fast clock play no part (and why).
- **Configuring**: the editor field by field, "use current value as clear", selectors, the preview, editor warnings (can never be granted / never released), JSON view.
- **Worked example**: the four Illawarra sections from `docs/layout.example.json`, and a KN-6 run step by step (what Control sets, what the guard sees).
- **Operating rules**: open the train before Control sets up; LOA is guard-panel only; no manual reset; tablet state expires after 12 h; the server remembers topic values so reloads don't go grey.

### 5.8 `integrations.md`
- **Live REST API**: endpoints, examples, the station-board flow; `/api/docs`.
- **WebSockets**: station feed (parameters, messages), live sync (message types), the browser WS inspector.
- **MQTT topics LiveRun uses**: fast clock (subscribe), LOA elements (server subscribes), stats (publish), guard event publish; QoS/retain behaviour.
- **JMRI**: roster suggestions, the throttle (what the guard panel sends), the fast-clock Jython script.
- **CATS XML export**: files, field mapping, the CATS Designer field-order requirement (moved from the README).
- **Sub-path deployments** (`BASE_PATH`) and the trusted-LAN security model.

### 5.9 `troubleshooting.md`
Symptom → likely cause → fix, grouped by screen. Seeded from real issues met so far, e.g.: clock grey; JMRI dot red / doors disabled "Acquiring…"; no sounds (Tap to start, profile has no sound); a train's LOA stuck on the first section (opened after Control set up); LOA dots grey after a reload (topic not published since the server started); guard sees no crews (none ticked Guard); "stops were changed after it was moved" on Done; crews not seeing changes (offline tablet; wake from sleep).

## 6. Writing conventions

- **Second person, present tense, task-first headings** ("Move a train on the graph", not "Graph editing feature").
- **UI words in bold, exactly as on screen** (**Done**, **Tap to start**, ☰ → **Change crew**). Keyboard keys as ⌘Z / Ctrl+Z.
- Every feature section: **what it does → how to use it → what others see → rules & limits → if it goes wrong**.
- Tables for settings fields (field · meaning · default · example).
- **Generic first, Illawarra as the worked example** (D13): rules are explained generically; layout-specific values appear only in clearly labelled examples.
- Callouts: `> **Note**`, `> **Important**` (e.g. "open the train before Control sets up").
- One concept per glossary term, linked on first use per page.
- No undocumented promises: if behaviour is a limitation (e.g. no LOA reset), say so plainly.

## 7. Screenshots and diagrams

- Stored in `docs/user-guide/images/`, PNG, light compression, named `<page>-<topic>.png`.
- **Reproducible**: `npm run docs:screenshots` (`scripts/docs/screenshots.js`) starts a throwaway stack (in-process aedes broker, mock JMRI, server on a temp DB, Vite dev), seeds it from `docs/user-guide/demo/`, publishes clock and LOA values, and drives the planner, crew view and guard panel with Playwright, so every image can be regenerated after UI changes. `--serve` keeps the seeded stack up for exploring.
- Data: a neutral demo timetable (§9 Q2), not live session data.
- Planned set (~30): mode picker; planner overview; train editor; crew list with Guard tick; badges; graph edit (drafts + ghost, dwell handle, Done/Cancel); layout settings pages (profiles, boarding preview, guard events, LOA editor); guard panel (overview, header, stop list with alias/pin, doors disabled reasons, boarding with runner, event banner, LOA AWAIT/GRANTED, lost-train banner); crew view (cards, NEW ring, toasts).
- Diagrams (Mermaid, rendered by GitHub): Control → server → tablets live-change flow; LOA section states; boarding timeline.

## 8. Accuracy and upkeep

- Each page is written by reading the **code and UI**, not only this spec or the design spec; facts that differ from `guard-panel-spec.md` are corrected in both.
- Each page ends with "Last checked against v2.0.x".
- A CLAUDE.md rule: *any change to user-visible behaviour updates the matching guide page in the same commit.*
- README "Upgrading to 2.0" and a short **Changelog** section (or `CHANGELOG.md`) for breaking changes.

## 9. Decisions

| # | Question | Decision |
|---|----------|----------|
| Q1 | One long guide or several pages? | **Separate pages** (§4) |
| Q2 | Screenshot data | **Illawarra B session** (Base MTP – B Session), with the example layout (LOA sections) loaded |
| Q3 | Where it's read | **GitHub Markdown only**, plus an in-app **Help** link (planner header and guard panel ☰ menu) to the relevant guide page |
| Q4 | README | **Slim** it to overview, install, upgrading to 2.0, security and links into the guide; CATS, API and feature detail move into the guide |
| Q5 | Changelog | **`CHANGELOG.md`**, starting at 2.0.0 |
| Q6 | Boarding / guard events maths | **Plain language only** — no formulas |

Consequences for the outlines above:
- §5.4 Boarding and §5.4/§5.5 guard events: describe behaviour in words (what raises or lowers the count, what the timing feels like); no formula blocks.
- §7: screenshots seeded from the B session export plus `docs/layout.example.json`; the KN-6 run (Nowra → Berry → Kiama) is the LOA walkthrough.
- Help links: a small **Help** (?) in the planner header → `user-guide/README.md`; ☰ → **Help** on the guard panel → `user-guide/guard-panel.md`; crew view → `user-guide/crew-view.md`. They open the GitHub page in a new tab (URL from a single constant so forks can repoint it).

## 10. Delivery plan (when un-parked)

| Step | Work |
|------|------|
| 1 | ~~Decisions §9; bring this branch up to date with `main`; lock the page list~~ (done 2026-10-15) |
| 2 | ~~Screenshot script + demo data (§7); generate the image set~~ (done 2026-10-15: 35 images from 28 shots) |
| 3 | ~~Write pages: planner + running a session; layout settings + LOA; guard panel + crew view; integrations + troubleshooting~~ (done 2026-10-15) |
| 4 | ~~Slim README; `CHANGELOG.md`; in-app Help links; CLAUDE.md upkeep rule~~ (done 2026-10-15) |
| 5 | ~~Review pass: every UI label checked against the running app; every link and image checked; a "new user" read-through of the quick start~~ (done 2026-10-15) |
