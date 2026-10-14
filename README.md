# LiveRun

**Plan and run your model railway operating sessions — from timetable to train graph to crew assignments, all in one place.**

LiveRun is a web app built for model railway clubs and home layouts. Build a stringline (time-distance) graph of your session, assign trains to operators, print station timetables, sync a live fast clock from JMRI, and expose your timetable to guard panels and operator displays via a read-only REST API.

![Train graph overview](docs/screenshots/01-train-graph-overview.png)

---

## What you can do with LiveRun

| | |
|---|---|
| **Visualise your session** | Build an interactive train graph — see every service at a glance, zoom in for detail, hover for stop times |
| **Plan crew workloads** | Assign trains to operators, auto-distribute services, and filter the graph by crew member |
| **Speed up train entry** | Define reusable route templates (Paths) and auto-fill all stop times from a single departure time |
| **Print timetables and registers** | Print the full working timetable, station registers, and the train graph — formatted for A4 and A5 |
| **Find trains instantly** | Filter the train list by name as you type — useful in large timetables |
| **Run trains from a tablet** | A guard panel at `/guard` with doors and bell via JMRI, passenger boarding, scripted events and Limit of Authority |
| **Connect external systems** | Feed guard panels, JMRI displays, and operator apps from a live REST API |
| **Sync the fast clock** | Subscribe to an MQTT broker topic and see the session clock ticking on the graph |
| **Export to CATS** | One click exports your trains and crew roster as CATS XML |

---

## Features

### Train Graph

The heart of LiveRun — an interactive stringline graph with time on the X axis and stations on the Y axis.

- Stations are spaced to scale using configurable graph position values
- Zoom up to **8×** on the time axis for detailed planning
- **Live updates** — the graph redraws instantly as you edit stop times
- Hover any train line for its name, origin, destination, and full stop list
- **Next service** indicator on the tooltip when the same locomotive runs again later in the session
- **Branch groups** — organise stations into named branches; each branch is visually separated in the sidebar and on the graph
- Show or hide individual trains without deleting them
- Full **undo / redo** history

![Train graph with branch groups](docs/screenshots/01b-train-graph-branches.png)

![Zoomed graph with tooltip](docs/screenshots/02-train-graph-zoomed-tooltip.png)

### Timetables

- **Multiple timetables** — create and switch between independent operating scenarios
- **Configurable time window** — set a custom start and end time per timetable
- **Duplicate** — clone an existing timetable as a starting point for a new session
- **Import / Export** — back up and restore timetables as JSON

### Stations

- Assign a **short code** for compact graph labels and reports (e.g. `KJN` for Kembla Junction)
- Set a **graph position** to control Y-axis order and spacing on the stringline
- Group stations by **branch name** to visually separate lines in the sidebar and graph
- **Auto-space** on insert — push-down shifts all stations below the new one down by one graph position automatically
- **Location alias toggle** — enable per-station to let individual stops display a custom name (e.g. a platform or siding) in reports and on guard panels
- **Name styling** — mark individual stations as bold, italic, or underlined; formatting appears on the graph labels and in printouts

### Trains

- **Colour-coded** — 12 preset colours plus a custom colour picker
- **Rich metadata** — train number, roster ID (suggested from JMRI when configured), direction, and free-text notes
- **Special instructions** — per-stop public notes, printed on station reports and shown on operator displays
- **Guard events** — hidden, scripted per-stop events (with probability and random timing) that only fire on the guard panel
- At-a-glance badges on the train list: **N** notes · **S** special instructions · the assigned crew's initials (e.g. **LO1**) in their colour
- **Search and filter** — type in the filter bar to instantly narrow the train list by name
- **Terminal stop enforcement** — the first stop has no arrival field; the last stop has no departure field, matching real-world practice
- **Location alias** — override the displayed station name for a specific stop (e.g. show a platform or siding rather than the parent station)
- **Run tracking** — mark trains as Running (▶) or Completed (✓) during a live session; status is shown on the train list and graph, and synced in real-time across all connected browsers via WebSocket. Reset all statuses with one click.

![Train search and filter](docs/screenshots/03b-train-search-filter.png)

![Train editor with stop list](docs/screenshots/04c-train-editor-stops.png)

![Train editor](docs/screenshots/04-train-editor.png)

### Crew Management

Organise your operators and distribute work fairly.

- Create named crew members with colour coding
- Assign trains manually or use **Auto-assign** to distribute services across selected operators
- **Auto-assign options** — choose which crew and trains to include, enforce a minimum break between jobs, and optionally limit to unassigned trains only
- Filter the graph to a single operator's trains with one click
- Hover a crew member in the sidebar to highlight all their trains on the graph
- Drag to reorder crew members

![Auto-assign crew panel](docs/screenshots/05b-crew-auto-assign.png)

![Graph filtered to a single operator's trains](docs/screenshots/05d-crew-filter-graph.png)

### Paths — Route Templates

Stop entering stop times from scratch. Define a route once and reuse it.

- Set up a station sequence with travel times and dwell times
- When adding a train, pick a path and enter a departure time — all stops are filled in automatically

![Path editor](docs/screenshots/07b-path-editor.png)

![New train with path selected and stops auto-filled](docs/screenshots/07f-new-train-autofilled.png)

### Printing

Open the **Print** menu (🖨 icon) in the header toolbar to access all print options.

**Station Report** — a printable arrival/departure register for any station. Shows all services with arrival, departure, origin, destination, service type (`[ORG]` / `[CAL]` / `[TRM]`), train notes, and special instructions. A5 landscape dot-matrix style — print and hand out at each physical station.

**Working Timetable** — a printer-ready tabular timetable in a new window, with stations in rows and trains in columns sorted by first departure. Paginates automatically across A4 landscape pages.

**Train Graph** — the stringline graph rendered in a print-friendly light colour scheme in a new browser window, ready to print or save as PDF.

![Station report with origin and destination columns](docs/screenshots/09-station-report.png)

### Settings and Fast Clock

- **Distance units** — switch between kilometres and miles; the graph and station list update immediately
- Connect to an **MQTT broker** (e.g. from JMRI) to show a live session clock on the graph
- Status dot and topic name displayed in the header
- Broker URL and topic are configured per timetable
- **Layout settings** — configuration shared by all timetables: JMRI WebSocket URL (e.g. `wss://jmri.example.net/json/`, drives Train ID roster suggestions and the guard panel throttle), guard panel, train profiles, boarding model, stats publishing, guard event library, Limit of Authority and the sound library. Export/import as JSON; `docs/layout.example.json` is a worked example

![Settings panel — km/mi toggle and fast clock](docs/screenshots/08-settings-panel.png)

### Guard Panel and Crew View

Open LiveRun on a phone or tablet and a **mode picker** offers the planner, the crew view (`/mobile`) or the guard panel (`/guard`); the choice is remembered. Both crew screens update within a second or two when Control adds, removes, reassigns or retimes a job — no refreshing.

The **guard panel** is built for a tablet riding with the train:

- **Crew and train** — pick your crew, then your trains are listed in run order; the current stop follows the fast clock (tap a row to pin it)
- **Doors, bell and DOIL** — sent straight to the loco's decoder through JMRI. **Train profiles** (glob patterns on the JMRI roster name) choose the tablet sounds and the function keys per loco
- **Passenger boarding** — a configurable demand model counts passengers on at each stop and can publish stats over MQTT
- **Guard events** — hidden scripted events (station or en-route) fire as a banner with a sound, and can trigger a loco function
- **Limit of Authority** — directional sections between stations, each watching MQTT topics for signals, staffs and other conditions. Each element can be ticked to *grant* (all granting elements clear at once) and to *revoke* (e.g. the staff sunk at the far end releases the section). The panel shows the current section (`AWAIT` / `AUTHORITY GRANTED`) and an Authority tab with every element. LOA follows the safeworking elements only, never the doors. The server caches topic values so a reloaded tablet sees them straight away

### Live API for External Systems

Mark a timetable as *active* and it is immediately available to guard panels, JMRI displays, and operator apps via a read-only REST API. See the [API reference](#live-timetable-api) below.

---

## Getting Started

The easiest way to run LiveRun is with **Docker Desktop** — a free app that runs LiveRun in a self-contained environment with no setup, no dependencies, and no risk of affecting anything else on your computer.

### Step 1 — Install Docker Desktop

Go to **https://www.docker.com/products/docker-desktop** and download the installer for your operating system (Windows or Mac). Run it and follow the prompts. Once installed, open Docker Desktop and wait for the green "Engine running" status in the bottom-left corner. You only need to do this once.

### Step 2 — Download LiveRun

Click the green **Code** button at the top of this page and choose **Download ZIP**. Extract it somewhere convenient — your Desktop or Documents folder works well.

### Step 3 — Open a terminal in the LiveRun folder

- **Windows:** Open the extracted folder in File Explorer, click the address bar at the top, type `cmd`, and press Enter.
- **Mac:** Right-click the extracted folder and choose *New Terminal at Folder* (or open Terminal and drag the folder in).

### Step 4 — Start LiveRun

Paste this command into the terminal and press Enter:

```bash
docker compose up -d
```

Docker will download LiveRun (this takes a minute or two the first time) and start it. When it finishes, open your browser and go to:

**http://localhost:3001**

That's it — LiveRun is running.

### Stopping and starting

- **Stop LiveRun:** `docker compose down`
- **Start it again:** `docker compose up -d`

Your data is saved automatically between restarts. You won't lose anything by stopping LiveRun.

### Updating to a newer version

```bash
docker compose pull && docker compose up -d
```

This downloads the latest version and restarts the app. Your data is untouched.

---

### For developers

```bash
npm install
npm run dev
```

- App: http://localhost:5173
- API: http://localhost:3001

---

## Upgrading to 2.0

2.0 removes the **train type** field everywhere. A one-off migration deletes it from stored trains on first start. External consumers of the live API lose the `trainType` field and the `?trainType=` station-board filter (REST and WebSocket). Sounds and loco functions that used to depend on train type now come from **train profiles** in Layout settings.

---

## Running your first session

1. **Create a timetable** — click *+ New* in the sidebar. Give it a name and set the time window (e.g. `06:00 – 22:00`)
2. **Add stations** — under *Stations*, click *+ Add*. Enter the station name, optional short code, graph position, and branch name. Use the push-down option when inserting a station mid-line to auto-shift positions below it
3. **Add paths** *(optional but recommended)* — under *Paths*, define a route with travel and dwell times per stop. Apply a path when adding trains to auto-fill all stop times
4. **Add trains** — under *Trains*, click *+ Add*. Choose a colour, set stop times (or apply a path), and add any notes or metadata. The graph updates as you type
5. **Add crew** — under *Crew*, add your operators. Assign trains via the train editor or click *Auto-assign*
6. **Mark active** — click the 🟢 flag on a timetable to expose it via the live API
7. **Configure the fast clock** — click ⚙️ in the top bar and enter your MQTT broker URL and topic. Toggle km/mi for your preferred distance unit
8. **Print** — use the 🖨 menu in the header to print station registers, the full working timetable, or the train graph
9. **Export** — hover a timetable name to reveal export options: JSON backup or CATS XML

---

## CATS XML Export

Exporting via the sidebar generates two files:

- **`{name}.xml`** — trains in CATS XML format, sorted chronologically by first departure
- **`{name}-crews.xml`** — crew roster XML (only includes operators assigned to at least one train)

| CATS Field | LiveRun Source |
|---|---|
| `TRAIN_SYMBOL` | Train name |
| `ENGINE` | Train ID (roster) |
| `TRAIN_NAME` | Train notes (if < 50 characters) |
| `DEPARTURE` | First stop departure time |
| `f3` | Origin station name |
| `f4` | Destination station name |

> **Before importing, you need ORIGIN and DESTINATION fields configured in CATS Designer.** Open CATS Designer and go to **Train → Edit Train Fields**. The field keys `f3` and `f4` refer to the **3rd and 4th fields** in that list — whatever fields occupy those positions will receive the origin and destination values from the export. Make sure your 3rd and 4th fields are set up as String fields labelled `ORIGIN` and `DESTINATION` respectively:
>
> ![CATS Designer — Edit Train Fields showing ORIGIN as the 3rd field and DESTINATION as the 4th](docs/screenshots/cats-edit-train-fields.png)
>
> If the 3rd and 4th fields don't exist or are a different type, CATS will silently ignore the origin and destination values on import.

---

## Security

LiveRun has no in-app authentication. It is designed for **trusted local networks** — home layouts and club rooms — not public internet exposure.

- **LAN-only exposure** — the app listens on a local port and is accessible to any device on your network. Don't forward that port on your router.
- **Security headers** — Helmet sets `X-Frame-Options`, `X-Content-Type-Options`, HSTS, and other standard hardening headers on every response.
- **Rate limiting** — API routes are capped at 200 requests per minute.

Even if someone on the LAN makes an unwanted change, the damage is limited. **Timetables can be exported and re-imported as JSON** — export before a session as a backup and you can restore to any previous state in seconds.

---

## Live Timetable API

A read-only REST API for connecting guard panels, JMRI displays, and operator apps to the active session. The full endpoint reference is available at **`/api/docs`** when the app is running.

### Endpoints

- `GET /api/active-timetable`
  Returns `{ id }` for the timetable currently marked active.

- `GET /api/layout` and `PUT /api/layout`
  Read or replace the layout-wide configuration (JMRI, guard panel, train profiles, boarding, stats, events, LOA).

- `GET /api/loa/values`
  Last value of every MQTT topic referenced by the Limit of Authority configuration.

- `GET /api/timetables/{id}/live/trains`
  Returns all services sorted by start time.

- `GET /api/timetables/{id}/live/trains/{trainName}`
  Returns the full timetable and stopping list for one service.

- `GET /api/timetables/{id}/live/stations/{stationName}`
  Returns all services calling at a station, including each service's onward stopping pattern from that point.

- `GET /api/timetables/{id}/live/stations/{stationName}?direction=up`
  Same, filtered to Up services. Use `direction=down` for Down.
  Direction is determined by station order: moving toward a higher station order is `down`, lower is `up`.

- `GET /api/timetables/{id}/live/stations/{stationName}?trainId=%cityrail%`
  Optional TrainID wildcard filter (case-insensitive). `%` matches any sequence, `_` matches a single character.

### Example station display flow

1. Call `/api/active-timetable` and read the returned `id`.
2. Call `/api/timetables/{id}/live/stations/Kiama` for a full board (both directions).
3. Call `/api/timetables/{id}/live/stations/Kiama?direction=down` for a direction-specific board.

### WebSocket station feed

For a live station board that updates as time advances, connect to:

```
ws://localhost:3001/api/live/station-feed?id={timetableId}&station={stationName}
```

Optional parameters:
- `direction` — `up` or `down`. Omit for both directions.
- `trainId` — case-insensitive wildcard filter, e.g. `trainId=%cityrail%`.
- `futureCount` — limit results to the next N services (default `10`).

The feed is driven by the timetable's MQTT fast clock settings. On connect, LiveRun subscribes to the configured topic and pushes a new snapshot whenever the clock advances.

On connect, the server sends:
- `type: "hello"` once
- `type: "stationFeed"` repeatedly, each with `clockTime`, `services[]`, and `minutesUntil` per service

### Live sync socket

`ws://localhost:3001/api/live/sync?id={timetableId}` pushes small notices so clients can re-fetch instead of polling: `hello` (current `rev`), `completions`, `timetable-updated`, `timetable-deleted`, `active-changed` and `loa-values`.

### Browser inspector

LiveRun includes a built-in WebSocket inspector for testing the feed in your browser:

- `http://localhost:3001/ws-inspector.html` (Docker / production)
- `http://localhost:5173/ws-inspector.html` (Vite dev server)

Enter your timetable ID and station, click **Connect**, and watch incoming messages in real time. You can also open it from the app header via **WS Inspector**.

---

## Project Structure

```
liverun/
├── server/           Express API + JSON file persistence
├── client/           React + TypeScript frontend (Vite + Tailwind)
├── Dockerfile        Multi-stage Docker build
└── docker-compose.yml
```
