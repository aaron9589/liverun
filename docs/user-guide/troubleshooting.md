# Troubleshooting

**What this page is for:** symptom → likely cause → fix, by screen.
**Who it's for:** everyone; Control will usually be the one fixing.

- [Fast clock](#fast-clock)
- [Planner](#planner)
- [Guard panel](#guard-panel)
- [Limit of authority](#limit-of-authority)
- [Crew view](#crew-view)
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
| The Up train's stops look upside down | Stops are listed in station order | That's normal; the guard panel and crew view show running order |

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
| A guard event fired at the last session but not this one | Events are rolled once per run and the tablet remembers them | **☰ → Reset events for this train** before running it again |
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

## Crew view

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| My trains aren't listed | The **Crew** filter is set to someone else, or you're looking at a different timetable | Open **Crew** and tick yours; check the timetable name under the title |
| **Select Timetable** appears | No timetable is active and none is chosen | Pick one, or ask Control to make the session's timetable active |
| The dot isn't green | Reconnecting | It catches up by itself when it's back |

## Integrations

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| JMRI **Test connection** fails but JMRI is running | JMRI isn't sending CORS headers for LiveRun's address, or a `ws://` URL on an HTTPS page | Allow LiveRun's origin in JMRI's web server settings; use `wss://` |
| CATS import loses origin and destination | CATS Designer's 3rd and 4th train fields aren't `ORIGIN` and `DESTINATION` String fields | See [CATS XML export](integrations.md#cats-xml-export) |
| The station feed sends `error` | Unknown timetable id or station name | Use the id from `/api/active-timetable` and the station's exact name |
| Everything is under `/traingraph/` and links break | `BASE_PATH` not set on the server | Set `BASE_PATH=/traingraph` |

---

Last checked against v2.0.0.
