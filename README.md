# LiveRun

**Plan and run your model railway operating sessions, from timetable to train graph to crews and guards, all in one place.**

LiveRun is a web app for model railway clubs and home layouts. Build your session on a stringline (time-distance) graph and hand the trains out to crews. Then run it live: crews follow their jobs on their phones, guards work their trains from tablets with doors, passengers, scripted events and Limit of Authority, and Control's changes reach everyone within a second or two.

![The planner's train graph](docs/user-guide/images/planner-overview.png)

**📖 [User guide](docs/user-guide/README.md)**, the full manual: [planner](docs/user-guide/planner.md) · [running a session](docs/user-guide/running-a-session.md) · [layout settings](docs/user-guide/layout-settings.md) · [guard panel](docs/user-guide/guard-panel.md) · [crew view](docs/user-guide/crew-view.md) · [limit of authority](docs/user-guide/limit-of-authority.md) · [integrations](docs/user-guide/integrations.md) · [troubleshooting](docs/user-guide/troubleshooting.md)

---

## What you can do with LiveRun

| | |
|---|---|
| **Visualise your session** | An interactive train graph: every service at a glance, zoom for detail, hover for stop times, drag trains to retime them |
| **Plan crew workloads** | Assign trains to crews by hand or with auto-assign, spot overlaps, filter the graph by crew |
| **Speed up train entry** | Reusable route templates (paths) fill in every stop from one departure time |
| **Print** | Station registers, the working timetable and the train graph |
| **Follow jobs on a phone** | Train Crew App: your jobs in order, with live changes from Control. The Crewing Manager: everything running and when, with run tracking |
| **Request paths** | Crews ask Control for a path from their phone (with shunts and work stops); Control plots it on the graph and accepts or declines it. Every request is logged |
| **Run trains from a tablet** | The guard panel: doors, DOIL and bell through JMRI, passenger boarding, hidden scripted events, Limit of Authority |
| **Sync the fast clock** | From JMRI over MQTT, shown on the graph, phones and tablets |
| **Connect other systems** | A live REST API and WebSockets for station boards and displays; CATS XML export |

| Crew view | Guard panel |
|-----------|-------------|
| ![Crew view](docs/user-guide/images/crew-overview.png) | ![Guard panel](docs/user-guide/images/guard-overview.png) |

---

## Getting started

The easiest way to run LiveRun is with **Docker Desktop**, a free app that runs LiveRun in a self-contained environment with nothing else to install.

### Step 1: Install Docker Desktop

Download it from **https://www.docker.com/products/docker-desktop** for Windows or Mac, run the installer, then open Docker Desktop and wait for "Engine running". You only do this once.

### Step 2: Download LiveRun

Click the green **Code** button at the top of this page and choose **Download ZIP**. Extract it somewhere convenient.

### Step 3: Open a terminal in the LiveRun folder

- **Windows:** open the folder in File Explorer, click the address bar, type `cmd` and press Enter.
- **Mac:** right-click the folder and choose *New Terminal at Folder*.

### Step 4: Start LiveRun

```bash
docker compose up -d
```

The first start takes a minute or two. Then open **http://localhost:3001** in your browser. Phones and tablets on the same network use your computer's address instead of `localhost`.

Then follow **[a first session in 10 steps](docs/user-guide/README.md#a-first-session-in-10-steps)**.

### Stopping, starting and updating

- Stop: `docker compose down`
- Start: `docker compose up -d`
- Update to the latest version: `docker compose pull && docker compose up -d`

Your data is kept between restarts and updates.

### For developers

```bash
npm install
npm run dev        # app on http://localhost:5173, API on http://localhost:3001
npm test
```

`npm run docs:screenshots` regenerates the user guide's screenshots on a throwaway server (see [`docs/user-guide/demo/`](docs/user-guide/demo/README.md)). Developer notes are in [CLAUDE.md](CLAUDE.md).

---

## Upgrading to 2.0

2.0 removes the **train type** field everywhere. A one-off migration deletes it from stored trains on first start. External consumers of the live API lose the `trainType` field and the `?trainType=` station-board filter (REST and WebSocket). Sounds and loco functions that used to depend on train type now come from **train profiles** in Layout settings.

After upgrading, set up **Layout settings** (JMRI, train profiles, and Limit of Authority if you use it) and tick **Guard** for the crews who'll use the guard panel. See the [changelog](CHANGELOG.md) for everything that changed.

---

## Security

LiveRun has **no login**. It's made for **trusted local networks** (home layouts and club rooms), not the public internet.

- Anyone who can reach it can change anything, so don't forward its port on your router.
- It sets standard security headers and limits the API to 200 requests a minute.
- **Export a JSON backup before each session.** Importing it undoes any unwanted change in seconds.

---

## Project structure

```
liverun/
├── server/           Express API, WebSockets, MQTT, JSON file storage
├── client/           React + TypeScript (Vite, Tailwind)
├── docs/             User guide, guard panel design spec, example layout
├── scripts/          Dev tools: mock JMRI, screenshot generator
├── Dockerfile        Multi-stage Docker build
└── docker-compose.yml
```
