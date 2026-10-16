# Running a session

**What this page is for:** Control's checklist for a session, covering what to do before, during and after.
**Who it's for:** Control and the layout owner.

- [Before the session](#before-the-session)
- [During the session](#during-the-session)
- [After the session](#after-the-session)
- [If something goes wrong](#if-something-goes-wrong)

## Before the session

**In the planner**

1. **Back up.** Export the timetable as JSON (and **Export layout JSON** in Layout settings). If anything goes wrong, importing it gets you back.
2. **Make the timetable active**: click its dot so it shows 🟢. Train Crew App, the Crewing Manager, guard panel, live API and LOA all follow the active timetable. Path requests only go to the active timetable.
3. **Fast clock**: check the header shows a green dot and the clock topic, and the dashed clock line is moving on the graph. See [Settings and the fast clock](planner.md#settings-and-the-fast-clock).
4. **Crews**: every train has a crew, there are no **⚠ overlap** warnings, and **Guard** is ticked for each crew that will use the guard panel.
5. **Layout settings** (if you use the guard panel): the JMRI URL passes **Test connection**; [train profiles](layout-settings.md#train-profiles) cover your locos (check the preview); LOA elements show live dots.
6. **Run status**: if the last session left trains marked running or completed, clear them (**✓ Reset jobs** in the header).

**On the tablets and phones**

1. Open LiveRun and pick a screen in the chooser: **Guard Panel** on tablets, **Train Crew App** (each crew picks itself under **Who are you?**) or **Crewing Manager** on phones. Hand out `…/mobile?view=jobs` or `…/guard` as a QR code or bookmark to skip the chooser.
2. Guard panel: **Tap to start**, then pick the crew.
3. Guard panel: open the **first train before Control sets up its authority** ([why](limit-of-authority.md#operating-rules)).
4. Check the guard panel's **Live**, **JMRI** and **Clock** dots are green.

## During the session

### Making changes

You can change the timetable while the session runs. Changes reach crews within a second or two, with nothing to refresh:

| You… | Guard panel | Train Crew App and Crewing Manager |
|------|-------------|-----------|
| retime a train (editor or [graph](planner.md#move-trains-on-the-graph)) | **KN-6 retimed**; changed stops flash | **KN-6 retimed**; times highlighted |
| give a crew a train | **New job: …** with the alert sound | **New job: …**; the card is marked **NEW** |
| take a train off a crew | If it's on screen, a red banner holds it until the guard taps **ACK** (doors still work) | **KN-6 → Local Operator 6** / **KN-6 removed** |
| rename a train | **… renamed to …** | the same |
| make more than five changes to one crew at once | one notice, **Control changed n of your jobs** | the same |
| switch the active timetable | amber banner; the panel switches when the guard taps **ACK** | switches, with a notice |

> **Note** Changes to **Layout settings** reach a guard panel only when its screen comes back on or it reloads. Ask guards to **☰ → Reload** after you change them.

### Moving trains on the graph

Turn on **✎ Edit**, drag, then **Done**. Nothing reaches crews until **Done**, so you can try a few moves and **Cancel** if they don't work out. See [Move trains on the graph](planner.md#move-trains-on-the-graph).

### Run status

Crews mark trains running and completed from the Train Crew App (their own jobs) or the Crewing Manager (any train): **Run** → **Done** → **Reset**. You can do the same from the planner's crew list (▶ / ✓ / ↺). Running trains glow on the graph; completed ones turn grey. Statuses aren't part of undo.

### Path requests

Crews can ask for extra paths from Train Crew App. A toast tells you (**… requests a path: …**) and the **Requests** button shows a badge. Open the drawer, **Acknowledge & plot**, adjust on the graph and **Accept**, or **Decline** with a reason. The crew sees every step on their phone. Crews can also withdraw a request, or ask to cancel an accepted one, which you approve or reject. If you'd rather not take requests for a while, switch off ⚙ → **Path requests** → **Crews can request paths**. See [Path requests](path-requests.md).

Settled requests leave the drawer by themselves; the audit log keeps the record.

### Limit of authority

Watch the guard panel's strip, or the dots in **Layout → Limit of authority**. Authority is granted when every granting element clears together and released when a token is returned. Only the signalling changes it. See [Limit of authority](limit-of-authority.md).

## After the session

1. **Reset run statuses**: **✓ Reset jobs** in the planner header (or **Reset all statuses** on the Crewing Manager).
2. **Back up** again if you changed the timetable during the session.
3. Leave the timetable active, or clear the flag. Tablets forget their LOA state and rolled guard events by themselves 12 hours after the session.

## If something goes wrong

See [Troubleshooting](troubleshooting.md). If the data itself is wrong, **undo** (⌘Z / Ctrl+Z) in the planner, or import the JSON backup you made before the session.

---

Last checked against v2.1.0.
