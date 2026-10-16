# Changelog

Notable changes to LiveRun. The [user guide](docs/user-guide/README.md) describes the current behaviour in full.

## 2.2.0 (2026-10-16)

### New
- **Train Crew App** (Crew jobs): a phone view for train crews. Pick your crew, see your jobs with their timetables and instructions, and mark your own jobs **Run**, **Done** or **Reset** (the same run status as the Crewing Manager). Crews can't edit anything else here.
- **Path requests**: a crew asks Control for a path from the Train Crew App (start and destination, optional intermediate stops with shunt, work or stop minutes, a siding where the station has one, and a ready time or as soon as possible). The request appears in the planner with a toast and a **Requests** badge.
  - Control **acknowledges** a request, which opens the graph in edit mode with the path drawn as a dashed draft train timed from the layout's path templates (where no template reaches a station, from the running times of the timetable's own trains). Control can move it and other trains, change its stops or crew, then **Accept** (saves the train and any other moves in one undo step) or **Decline** with a note.
  - An accepted request becomes an ordinary train in the assigned crew's jobs, with the note from Control. Crews can **withdraw** a request while it's pending or being plotted. After accept they can **ask to cancel**; Control approves (the train is removed) or rejects with a note.
  - Control gets a **Requests** drawer with the queue and each request's history. Plotting can be resumed or returned to the queue, an accepted request whose train was undone can be **Reopen**ed, and **Clear closed** removes finished requests.
  - Settings: **Crews can request paths** on/off, train ID prefix (default `PR`), default leg minutes (5) and lead time for ASAP requests (2). Requests only take effect on the active timetable.
- **Audit log**: every path-request action, accepted or refused, is recorded with the time, IP address, device, the acting crew (or Control) and what changed. Control reads it in the Requests drawer and can export CSV. The log is kept in `<data>/audit.jsonl` (rotated at 5 MB) and survives undo, timetable deletion and restore. `GET /api/audit` returns it, with filters and `format=csv`.
- **One chooser** for every screen: **Train Crew App**, **Crewing Manager** and **Guard Panel** (plus **Train Graph**, the planner, on a desktop). On a phone it is always the home page and remembers nothing; every screen has **Switch mode** to return to it. `/mobile?view=jobs`, `/mobile?view=board` and `/guard` open a screen directly.
- The Train Crew App remembers which job cards are open on the device; a job with no saved state opens by itself if it's the first one not marked done.

### Changed
- **The crew view is now the Crewing Manager**: the owner's view of everything running and when, with run and complete marking as before. Trains with a pending request show a **Requested** badge.

## 2.1.0 (2026-10-15)

### Fixed
- **Layout settings previews follow running order.** The Limit of Authority preview showed Up trains' sections reversed (e.g. *Kiama → Berry* for a train running Nowra → Kiama), and the Boarding preview swapped their origin and terminus. Both now match the guard panel.
- The train editor's en-route guard event wording now says *the next stop the train runs to* (the editor lists stops in station order).
- The LOA editor no longer claims a section with no elements is granted immediately; such a section is never granted.
- **Guard events expire after 12 hours on a tablet**, like LOA state: the next session rolls them afresh instead of finding them already fired. Un-ACKed banners expire too.

### New
- **Resizable planner sidebar**: 320 px by default (was 288), drag its right edge to resize; double-click resets.
- **User guide** in [`docs/user-guide/`](docs/user-guide/README.md), with **Help** links in the planner header, the guard panel's ☰ menu and the crew view.

## 2.0.0 (2026-10-15)

LiveRun 2.0 brings the **guard panel** into LiveRun, pushes **Control's changes to crews live**, and adds layout-wide configuration, JMRI-driven train profiles, passenger boarding, hidden guard events, **Limit of Authority** and **editing trains on the graph**.

### Breaking changes
- **Train type is removed.** On first start, a one-off migration deletes `train_type` from every stored train.
- **Live API:** the `trainType` field and the `?trainType=` station-board filter (REST and WebSocket) are gone.
- Sounds and loco functions that depended on train type now come from **train profiles** (Layout settings).

### New
- **Guard panel** at `/guard`: Tap to start, crew picker, ◀ / ▶ job stepping, stops in running order with aliases and tap-to-pin, doors / DOIL / bell through JMRI, passenger boarding with optional MQTT stats, hidden guard events, and Limit of Authority.
- **Train profiles**: patterns on the JMRI roster name choose tablet sounds and decoder functions (F-number or roster label).
- **Limit of Authority**: directional sections between stations watching signals, staffs, conditions and selectors over MQTT, with per-element **Grants** and **Revokes**. Driven only by the safeworking elements.
- **Live changes from Control** in the crew view and guard panel: toasts, NEW and retimed highlights, and an ACK banner when a guard's train is removed or reassigned.
- **Layout settings** shared by every timetable (JMRI, guard panel, train profiles, sound library, boarding, stats, guard events, LOA), with JSON import/export and [`docs/layout.example.json`](docs/layout.example.json).
- **Edit on the graph**: ✎ Edit, drag a train or a stop's dwell; Done saves the moves as one undo step.
- **Train ID** suggestions from the JMRI roster; a **Guard** tick box per crew; train-list badges **N**, **S** and crew initials; a **mode picker** on phones and tablets.

### Upgrading
1. Pull the new image and restart; the migration runs automatically.
2. Configure **Layout settings**: JMRI, train profiles and (if used) Limit of Authority.
3. Tick **Guard** for the crews who will use the guard panel.
4. On each guard tablet, open the train **before** Control starts setting up its authority.
