# User guide demo data

Seed data for `npm run docs:screenshots` (`scripts/docs/screenshots.js`), which regenerates every image in `../images/` on a throwaway stack.

| File | What it is |
|------|------------|
| `b-session.json` | Timetable export of the Illawarra **Base MTP – B Session** (crew names anonymised, run statuses stripped, clock broker blank — the script points it at its own broker) |
| `roster.json` | JMRI roster served by the mock JMRI server, matching the session's train IDs — except `CityRail 4T`, left out on purpose so K444 shows a refused throttle |
| `layout-overrides.json` | Layered over `docs/layout.example.json` (which supplies LOA): train profiles, guard events library, stats, alert sound. `placements` adds guard events to trains' stops at import time, so `b-session.json` stays a plain export |

Path requests aren't in the export (importing drops them). The harness creates them for the shots that need them (Crew jobs, the Requests drawer, plotting, the audit log) through the API after the import, and removes them again afterwards, so the shots don't depend on each other. The audit log shots start from an empty log in the throwaway data folder.

All values here are example data for the user guide, not defaults.
