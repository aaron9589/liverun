# Train Crew App

**What this page is for:** following your own jobs on a phone, and asking Control for a path when you need one.
**Who it's for:** train crews and drivers.

- [Opening it](#opening-it)
- [My jobs](#my-jobs)
- [Requesting a path](#requesting-a-path)
- [Your requests in My jobs](#your-requests-in-my-jobs)

![Train Crew App on a phone: the crew's next job open, with a special instruction at Berry](images/jobs-overview.png)

## Opening it

Open LiveRun on your phone and choose **Train Crew App** in the [chooser](README.md#choosing-a-screen-on-a-device):

![The chooser on a phone](images/mobile-view-picker.png)

To skip the chooser, open `…/mobile?view=jobs`, for example from a bookmark or a QR code Control hands out.

The first time, the Train Crew App asks **Who are you?** Pick your crew. Every crew in the timetable is listed; the choice is remembered on this phone, for this timetable.

The **☰** menu in the top right has:

| Item | Does |
|------|------|
| **Change crew** | Back to **Who are you?** |
| **Switch mode** | Back to the chooser (Train Crew App, Crewing Manager, Guard Panel) |
| **Help** | Opens this page |

The Train Crew App shows the **active timetable**, the one Control has marked active in the planner. If Control switches to another one, your screen follows and tells you (**Control switched to …**). If none is active, it says **No session is running**.

The header shows your crew's colour and name, the fast clock (grey while it's disconnected), and a dot: green means you're live and Control's changes appear by themselves, amber means connecting, red means reconnecting. The screen catches up on anything it missed as soon as it's back, including after the phone wakes from sleep.

## My jobs

**My jobs** is one list of everything for your crew: requests you've sent that aren't a job yet come first (see [below](#your-requests-in-my-jobs)), then the trains assigned to your crew, in the order they run. Each job card shows the train's name, its loco (train ID), and where it runs from and to with the start and end times.

- Tap a card to open or close it. The phone remembers which cards you left open, even after a reload. A job you haven't opened or closed yet opens by itself if it's the first one not marked **Done**.
- An open card lists each stop in running order with its **Arr** and **Dep** times. If Control gave a stop a different name for this train (a siding or staging road), it's shown after the station name.
- A line starting with an amber flag (⚑) is a **special instruction** for that stop. Read these before you start.
- With the fast clock running, the stop you should be at is highlighted and marked **now** (standing at it) or **next**.
- **Notes** from Control are shown under the stops.
- Badges on the right say where a job stands: **Accepted** (made from a path request), **Cancel asked** or **Cancel refused** (see below), and **Running** or **Done** for the train's run status.
- An open card has a run button: **Run** marks the job running, then **Done** marks it finished, and **Reset** clears its status again. It's the same status as the [Crewing Manager](crew-view.md#marking-runs)'s, so Control and every other screen see it straight away. On a requested job it sits next to **Ask to cancel**.

The Train Crew App follows Control's changes live, with no refresh and no sounds. A new job gets a **New job** toast and a green ring for a minute, and retimed stops are highlighted for 10 seconds. The same notices as on the Crewing Manager appear when a job is retimed, renamed or taken off your crew, and **Control changed n of your jobs** when there are more than five changes at once. See [When Control changes something](crew-view.md#when-control-changes-something).

## Requesting a path

When you need to go somewhere your jobs don't take you, tap **+ Request a path**. Control sees it straight away and plots a train for you on the graph. You see it arrive as a new job.

![The Request a path form, filled in with a shunt at Bombo](images/jobs-request-form.png)

| Field | What to enter |
|-------|---------------|
| **Crew** | Fixed: your crew |
| **Loco (optional)** | The loco's roster name or number. It starts as the loco of your current job |
| **From (where you are now)** | The station you're at. It starts as where your current or latest job ends. At stations that allow it, a **Siding / road** box lets you name the road |
| **+ Add stop** | A stop between From and To, if you need one (fields below). You can add up to 18; ↑ ↓ reorder them and ✕ removes one |
| **To (where you want to go)** | The destination |
| **Ready at** | **As soon as possible**, or **At a time** and a time. Control starts your train at that time, or a couple of minutes after the fast clock if that time has already passed |
| **Notes for Control** | Anything else, up to 500 characters |

Each added stop has:

- **Stop / Shunt / Work**: **Stop** is a station you stop at or pass through. **Shunt** and **Work** say you'll be busy there, for example shunting a yard or working a siding.
- **Minutes on site**: how long you'll be there, from 0 to 240 (the − and + buttons move in fives).
- **Note for this stop**: for example, *drop 2 wagons*.

A **Shunt** or **Work** stop becomes a special instruction on the job, such as *Shunt 20 min: drop 2 wagons*, so you'll see it under My jobs.

**Send request** stays off until the form is complete, and the message above it says what's missing: pick both ends; From and To must be different; every added stop needs a station; each station can appear only once; and a time must be chosen under **At a time**.

If Control's server refuses the request, the reason appears in red above the button and the form stays open. See [Troubleshooting](troubleshooting.md#train-crew-app).

> **Note** The **+ Request a path** button is only there while your timetable is the active one and Control hasn't turned requests off. The whole timetable can hold 50 open requests at once.

## Your requests in My jobs

A request you've sent shows at the top of **My jobs** with a dashed border, closed: its header gives the route's ends, where it's at, and a badge. Tap it to see the full route (for example *Kiama → Bombo (shunt 20) → Kembla Heights*), when you're ready, your note and **Withdraw**.

![My jobs: a waiting and a declined request above the jobs](images/jobs-requests.png)

| Badge | Meaning | What you can do |
|-------|---------|-----------------|
| **Waiting** | Control hasn't picked it up yet | **Withdraw** |
| **Plotting** | Control is working out your path | **Withdraw** |
| **Declined** | Control refused it; the reason is on the card. It drops off the list after 10 minutes | Nothing; send a new request if you still need one |
| **Accepted** | Control accepted it: it's now a job in the list, with Control's note when you open it | **Ask to cancel** (open the job) |

A request you withdraw disappears straight away. So does an accepted job that Control cancels or deletes.

**Withdraw** asks you to confirm (**Yes, withdraw** or **Keep**). If Control picked the request up at the same moment, you may be told the request has moved on.

**Ask to cancel** is for an accepted job you no longer need: open the job, tap **Ask to cancel**, type a reason if you like, then **Send request**. The job stays until Control agrees: it shows **Cancel asked**, then either disappears (cancelled) or shows **Cancel refused** with Control's note. You can ask again after a refusal. Only the crew that sent the request can ask to cancel it.

You also get a toast when something changes: **Control is plotting your path**, **Path accepted → PR1**, **Declined: …**, **Cancelled: …** or **Cancel refused: …**.

For what Control does with your request, and what is recorded about it, see [Path requests](path-requests.md).

---

Last checked against v2.2.0.
