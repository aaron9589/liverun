# User guide demo data

Seed data for `npm run docs:screenshots` (`scripts/docs/screenshots.js`), which regenerates every image in `../images/` on a throwaway stack.

| File | What it is |
|------|------------|
| `b-session.json` | Timetable export of the Illawarra **Base MTP – B Session** (crew names anonymised, run statuses stripped, clock broker blank — the script points it at its own broker) |
| `roster.json` | JMRI roster served by the mock JMRI server, matching the session's train IDs |
| `layout-overrides.json` | Layered over `docs/layout.example.json` (which supplies LOA): train profiles, guard events library, stats, alert sound. `placements` adds guard events to trains' stops at import time, so `b-session.json` stays a plain export |

All values here are example data for the user guide, not defaults.
