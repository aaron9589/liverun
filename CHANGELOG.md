# Changelog

Notable changes to LiveRun. The [user guide](docs/user-guide/README.md) describes the current behaviour in full.

## Unreleased

### Fixed
- **Layout settings previews follow running order.** The Limit of Authority preview showed Up trains' sections reversed (e.g. *Kiama → Berry* for a train running Nowra → Kiama), and the Boarding preview swapped their origin and terminus. Both now match the guard panel.
- The train editor's en-route guard event wording now says *the next stop the train runs to* (the editor lists stops in station order).

### New
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
