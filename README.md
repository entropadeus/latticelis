# Lattice LIS

A browser-first Laboratory Information System prototype.

![status: prototype](https://img.shields.io/badge/status-prototype-yellow)
![stack: react + indexeddb](https://img.shields.io/badge/stack-react%20%2B%20indexeddb-2c5e4a)
![license: see LICENSE](https://img.shields.io/badge/license-see%20LICENSE-555)

> **Status:** Prototype / proof-of-concept. Not intended for clinical or production use. Do not enter real patient data.

[**Live demo →**](https://entropadeus.github.io/latticelis/)

---

## What is this?

Most lab information systems look and feel like 2005. Lattice LIS is a small experiment in what happens when you give those same workflows the same care that consumer-grade tools get — typography, motion, density, keyboard ergonomics — without sacrificing the dense, accession-centric layouts that lab techs actually need.

It runs entirely in the browser today using IndexedDB for persistence, with a clean adapter boundary so the same code can graduate to Electron + SQLite without rewrites.

## Features

- **Order entry.** Accession-centric, with patient/client/test composition, specimen condition handling, and label generation.
- **Result management.** Entry, verification, and non-overwriting corrections that preserve the full chain.
- **Quality control.** Westgard rule evaluation with lab-wide configuration and instrument-level lockout.
- **Rules engine.** Operator-authored rules across orders, results, and routing, with safety-confirmed enable/disable.
- **Critical alerts & escalation.** Configurable thresholds, recipient routing, and escalation timelines.
- **Audit trail.** Every meaningful event captured to a replayable, entity-scoped log.
- **HL7 / LML interop.** Pasted-payload intake with shape validation and a confirmation flow.
- **Label printing.** ZPL templating with print-storm and printer-command linting.

## Stack

| Layer       | Today                                        | Tomorrow                              |
| ----------- | -------------------------------------------- | ------------------------------------- |
| Views       | React + Babel-standalone (no build step)     | React + precompiled JSX bundle        |
| Persistence | IndexedDB                                    | better-sqlite3 (Electron port)        |
| Events      | In-process semantic event bus + auto-audit   | Same surface, host-owned writes       |
| Type system | Plain JS + JSDoc                             | Same                                  |

Geist Sans + Geist Mono. Warm ivory + sage. 1.25px geometric icons. Conservative motion language — Material standard easings, no spring physics.

## Run locally

Static-served from the project root. Any no-cache HTTP server works:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000/>.

A precompiled JSX bundle (`compiled/app.bundle.js`) is also available for deployments where end users shouldn't load Babel in the browser.

## Roadmap

The current focus is the move to a real trust boundary: graduating off the browser-only architecture into an Electron host with SQLite persistence, host-owned audit, and an authenticated session model. The renderer keeps its UI surface; privileged writes move behind IPC.

## License

See [LICENSE](LICENSE).
