# Troubleshooting

**What this page is for:** symptom → likely cause → fix, by screen.
**Who it's for:** everyone; Control will usually be the one fixing.

- [Fast clock](#fast-clock)
- [Planner](#planner)
- [Guard panel](#guard-panel)
- [Limit of authority](#limit-of-authority)
- [Train Crew App and the Crewing Manager](#train-crew-app)
- [Path requests](#path-requests)
- [Integrations](#integrations)

## Fast clock

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| The clock is grey (guard panel) or the dot is red | The broker isn't reachable from this device, or nothing is publishing | Check ⚙ → **Fast clock** → **Broker URL** is the broker's **WebSocket** address (`ws://` / `wss://`, not `mqtt://` port 1883) and is reachable from the tablet. Check JMRI's clock script is running |
| The clock dot is green but the time doesn't move | The fast clock is stopped in JMRI, or the topic is wrong | Start the clock in JMRI; compare the topic in ⚙ with the script's |
| Works on the laptop, not on tablets | The broker address is `localhost` or a name only the laptop knows | Use an address every device can reach |
| A `wss://` page can't connect to a `ws://` broker | Browsers block insecure connections from secure pages | Give the broker a `wss://` listener |

## Planner

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| **Done** after moving trains says a train's stops were changed after it was moved | Someone edited that train's stops while your move was a draft | Your moves are still on the graph: press **Done** again to save the rest, or **Cancel** and redo the move |
| Can't drag trains on the graph | **✎ Edit** is off (it's always off when the planner loads) | Click **✎ Edit** |
| A train disappeared from the graph | It's hidden (👁), or the **Filter by crew** is on | Click 👁 in the train list; set the filter to **All operators** |
| Train ID suggestions don't appear | No JMRI URL, or the roster can't be fetched | Layout → **JMRI** → **Test connection** |
| Undo brought back old times but not run status | By design: run status isn't part of undo | Mark trains again, or use **✓ Reset jobs** |
| The Up train's stops look upside down | Stops are listed in station order | That's normal; the guard panel, the Train Crew App and the Crewing Manager show running order |

## Guard panel

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| **Who are you?** shows no crews | No crew has **Guard** ticked | In the planner's crew list, tick **Guard** for the crews that use the guard panel |
| No sound at all | **Tap to start** wasn't tapped (it reappears after a reload), the tablet is muted, or the train's profile has no sounds | Tap **Tap to start**; check the volume; check the [train profile](layout-settings.md#train-profiles) and its preview |
| Doors disabled, **Acquiring…** for a long time | JMRI hasn't handed over the loco | Check the loco isn't held by another throttle; **☰ → Reload** |
| Doors disabled, **JMRI disconnected** | JMRI isn't reachable from this tablet | Check JMRI's web server is running and the URL in Layout → **JMRI** works from the tablet. Buttons mapped by roster label still play sounds meanwhile |
| **Unable to find roster entry "…"** | The train ID doesn't exactly match a JMRI roster name | Fix the **Train ID** in the planner (the roster suggestions help) |
| Grey **loco not in JMRI roster** under the buttons | As above, for a profile that uses roster labels | As above |
| Grey **function label not on this loco** | The profile's roster label isn't on this loco | Use the loco's label, or an F-number, in its profile; **Test** it |
| Doors open but the loco does nothing | **not mapped in profile**, or the wrong F-number | Check the profile's decoder functions and **Test** them |
| **Current stop unknown (no clock) — tap a stop in the list to set it** | No clock reading | Tap the stop you're at to pin it, then open the doors again |
| The wrong stop is highlighted | Running early/late, or the clock is off | Tap the right stop to pin it (until Doors Close) |
| Running a train a second time in the same session, its guard events don't fire | Events are rolled once per run and the tablet remembers them for 12 hours | **☰ → Reset events for this train** before running it again |
| New layout settings (profiles, events, sounds) aren't used | The open panel hasn't reloaded the settings | **☰ → Reload** |
| A red banner says Control has removed or reassigned the train | Control changed the job | Close the doors if open, tap **ACK** |
| Changes from Control stopped arriving | The **Live** dot isn't green | Wait for it to reconnect (it catches up by itself), or **☰ → Reload** |

## Limit of authority

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| A train stays on its **first** section showing **AWAIT**, although it's past it | The tablet opened the train after that section was granted and released, so it never saw either | Open the train **before** Control sets up next time. For this run, later sections still update in the **Limit of authority** list, but the strip stays on the first section; follow the list and tell Control |
| Dots grey with **?** / **NO DATA** / **waiting for signal data** | The server has no value for those topics: nothing has been published since it started, the topic is wrong, or the active timetable's broker isn't the one your signalling uses | Check the topics in Layout → **Limit of authority** (the live value shows next to each). Make the signalling publish retained values, or change the element once. Check the **active** timetable's broker |
| Everything clears but it never says **GRANTED** | The granting elements weren't all clear at the same moment, or a section has no element ticked **Grants** | Set the route so all are clear together. Check the editor's warnings |
| **GRANTED** never goes to **COMPLETE** | No element is ticked **Revokes**, or the token never went back to a not-clear value | Tick **Revokes** on the token; check its value changes when it's returned |
| The preview gives a train the wrong sections | Station names don't match, or **Only/Except** patterns exclude it | Section **From**/**To** must match station names exactly (case doesn't matter) |
| Opened the doors and LOA didn't change | By design | LOA follows only the signalling |

## Train Crew App

The Train Crew App is the phone view at `…/mobile?view=jobs`; see [Train Crew App](crew-jobs.md). The same dot and timetable behaviour applies to the [Crewing Manager](crew-view.md).

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| A phone shows the chooser every time | By design: the chooser is the phone's home page | Open `…/mobile?view=jobs` (or `?view=board`) from a bookmark or QR code |
| **Who are you?** shows the wrong crews, or none | The timetable has no crews, or this is a different timetable | Check the timetable name with Control; Control adds crews in the planner |
| My jobs is empty (**No jobs for this crew yet.**) | No trains are assigned to your crew | Ask Control to assign trains, or tap **☰ → Change crew** |
| **+ Request a path** isn't there | The timetable isn't the active one, or Control has turned off **Crews can request paths** | Ask Control to make the session's timetable active and check ⚙ → **Path requests** |
| **Send request** is greyed out | The form isn't complete | Read the message above the button |
| **Requests only go to the running session** (red, on the form) | The timetable stopped being active while you filled the form | Ask Control; reopen the Train Crew App to follow the active timetable |
| **Path requests are turned off for this session** | Control switched requests off | Ask Control |
| **Too many open requests (50)** | The timetable already has 50 open requests | Tell Control, who can decline or clear some |
| **Can't withdraw it: the request is …** or **Can't ask to cancel it: …** (409) | Control acted at the same moment, so the card was out of date | The card updates itself; read its new status |
| **Only the crew that made this request can …** | The phone was switched to another crew | **☰ → Change crew** back to the crew that sent it |
| A request disappeared from My jobs without becoming a job | Control assigned the train to another crew or left it unassigned, or deleted it | Ask Control |
| Jobs on the Crewing Manager but not in Train Crew App | Crewing Manager shows everyone's jobs unless filtered by crew | Use the **Crew** filter on the Crewing Manager, or **Change crew** in Train Crew App |
| The dot isn't green | Reconnecting | It catches up by itself when it's back |
| **Select Timetable** appears (Crewing Manager) | No timetable is active and none is chosen | Pick one, or ask Control to make the session's timetable active |

## Path requests

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| The **Requests** button is missing | The open timetable isn't the active one and has no requests | Make it active (click its dot) |
| **Finish or cancel plotting … first** | One request is already being plotted | **Accept** or **Cancel** that one |
| Accept fails and says a train changed | Someone edited a train you moved while you were plotting | Your drafts are kept: **Accept** again, or **Cancel** and redo the move |
| After a reload the draft is gone | Drafts live in the browser page only | The request is still **Plotting**: **Resume plotting** in the drawer |
| **times from** says **No path or timetable data** | No path template and no timetabled train links those stations | Add paths ([Paths](planner.md#paths-route-templates)), or accept the **Default leg time** and adjust on the graph |
| A leg is timed **from timetabled trains** and looks wrong | No path template reaches that station, so the trains' median running time was used | Add a path covering it, or drag the draft / use **Edit stops** |
| Plotted times look wrong | The route was timed from the wrong path, or the default leg time | Check the **times from** line; drag the draft or use **Edit stops** |
| The audit log is empty | New install, or the data folder was changed | The log is `audit.jsonl` in the server's data folder |

## Integrations

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| JMRI **Test connection** fails but JMRI is running | JMRI isn't sending CORS headers for LiveRun's address, or a `ws://` URL on an HTTPS page | Allow LiveRun's origin in JMRI's web server settings; use `wss://` |
| CATS import loses origin and destination | CATS Designer's 3rd and 4th train fields aren't `ORIGIN` and `DESTINATION` String fields | See [CATS XML export](integrations.md#cats-xml-export) |
| The station feed sends `error` | Unknown timetable id or station name | Use the id from `/api/active-timetable` and the station's exact name |
| Everything is under `/traingraph/` and links break | `BASE_PATH` not set on the server | Set `BASE_PATH=/traingraph` |

---

Last checked against v2.2.0.
