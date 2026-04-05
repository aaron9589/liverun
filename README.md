# Train Graph

A web application for building and managing train stringline (time-distance) diagrams. Replace your Excel workflow with an interactive, real-time graph editor.

## Features

- **Multiple timetables** — manage independent scenarios side-by-side
- **Distance-scaled Y axis** — stations are positioned to true distance scale
- **Real-time graph preview** — the graph updates live as you type stop times
- **Configurable time axis** — set start and end time per timetable
- **Colour-coded trains** — 12 preset colours + custom colour picker
- **Tooltips** — hover any train line to see its name, origin, destination, and times
- **Persistent storage** — data saved as JSON; survives server restarts
- **Dark UI** — easy on the eyes for long planning sessions

## Quick Start (development)

```bash
npm install
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

## Docker (production)

```bash
# Build and run
docker compose up -d

# Access at http://localhost:3001
```

Data is persisted in a Docker volume (`train-graph-data`).

## Usage

1. **Create a timetable** — click *+ New* in the sidebar, set a name and the time window (e.g. 06:00 – 22:00)
2. **Add stations** — click *+ Add* under Stations; enter the station name, optional short code, and distance in km from the origin (distance 0)
3. **Add trains** — click *+ Add* under Trains; pick a colour and enter stop times for each station. Leave a station blank to skip it. The graph updates in real time as you type
4. **Edit** — click any station or train to open its editor
5. **Hover the graph** — mouse over any train line to see its details in a tooltip

## Project Structure

```
train-graph/
├── server/          Express API server + JSON persistence
├── client/          React + TypeScript frontend (Vite)
├── Dockerfile       Multi-stage Docker build
└── docker-compose.yml
```

## Live / Public Timetable API

A read-only API designed for external systems (e.g. guard panels, operator displays). All times are formatted as `H:MM` with no leading zero (e.g. `9:05`, not `09:05`), matching JMRI's clock format.

### Active timetable

External consumers should resolve the active timetable ID before calling train endpoints.

**`GET /api/active-timetable`**

Returns the ID of the timetable currently marked as active.

```json
{ "id": "abc123" }
```

`id` is `null` if no timetable has been marked active. In that case, fall back to the first entry from `GET /api/timetables`.

---

### List trains

**`GET /api/timetables/:id/live/trains`**

Returns all trains in the timetable, sorted by start time.

```json
{
  "trains": [
    {
      "name": "K351",
      "trainType": "L",
      "trainId": "CityRail 51L",
      "direction": "Down",
      "notes": "Stops on request at Minnamurra",
      "nextCrewService": "K352"
    },
    {
      "name": "K352",
      "trainType": "L",
      "trainId": "CityRail 52L",
      "direction": "Up",
      "notes": "",
      "nextCrewService": ""
    }
  ]
}
```

| Field | Description |
|---|---|
| `name` | Train number / display name |
| `trainType` | Short type code (e.g. `L`, `T`, `V`, `E`) — empty string if not set |
| `trainId` | Roster/JMRI name (e.g. `CityRail 51L`) — empty string if not set |
| `direction` | Direction of travel (e.g. `Up`, `Down`, `FWD`) — empty string if not set |
| `notes` | Free-text train notes — empty string if not set |
| `nextCrewService` | Name of the next train the same crew member works, if assigned — empty string otherwise |

Only trains with a non-empty `trainId` are meaningful to operator displays that drive JMRI roster lookups. Filter client-side as needed.

---

### Single train timetable

**`GET /api/timetables/:id/live/trains/:trainName`**

Returns the full stop-by-stop timetable for one train, looked up by its `name`.

```json
{
  "name": "K351",
  "trainType": "L",
  "trainId": "CityRail 51L",
  "direction": "Down",
  "notes": "Stops on request at Minnamurra",
  "nextCrewService": "K352",
  "stops": [
    {
      "stopName": "Kiama",
      "arrival": null,
      "departure": "9:05",
      "specialInstructions": null
    },
    {
      "stopName": "Minnamurra",
      "arrival": "9:10",
      "departure": "9:10",
      "specialInstructions": "Request stop only"
    },
    {
      "stopName": "Shellharbour Junction",
      "arrival": "9:20",
      "departure": null,
      "specialInstructions": null
    }
  ]
}
```

#### Stop fields

| Field | Description |
|---|---|
| `stopName` | Station display name |
| `arrival` | Arrival time as `H:MM`, or `null` if not set |
| `departure` | Departure time as `H:MM`, or `null` if not set |
| `specialInstructions` | Free-text instruction for this stop, or `null` if not set |

#### Notes on times

- A stop where `arrival === departure` is a pass-through — the departure time is the only meaningful value
- The last stop of a train that **forms a next service** will have `departure` set to the next train's name (e.g. `"K352"`) rather than a time. Use `nextCrewService` to detect this case programmatically
- Stops are returned in the order they are stored; sort by time client-side if needed
