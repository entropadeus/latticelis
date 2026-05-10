# Lattice LIS

A browser-first Laboratory Information System prototype and public work-in-progress demo.

![status: prototype](https://img.shields.io/badge/status-prototype-yellow)
![stack: react + indexeddb](https://img.shields.io/badge/stack-react%20%2B%20indexeddb-2c5e4a)
![license: see LICENSE](https://img.shields.io/badge/license-see%20LICENSE-555)

> **Status:** Work in progress / public demo. Not intended for clinical, operational, or production use. Do not enter real patient data.

[**Live demo →**](https://entropadeus.github.io/latticelis/)

un: test
pw: test

---

## What is this?

Most lab information systems look and feel like 2005. Lattice LIS is a small experiment in what happens when you give those same workflows the same care that consumer-grade tools get — typography, motion, density, keyboard ergonomics — without sacrificing the dense, accession-centric layouts that lab techs actually need.

It runs entirely in the browser today using local-only IndexedDB persistence. Records stay in the current browser profile; there is no cloud database, remote sync, or background upload path. Export/import are manual JSON file operations.

## Demo reality check

This repository is a demo of an actively evolving LIS concept. It is meant to show workflow direction, interface density, safety-confirmed actions, fake lab data, and browser-first architecture. It is not a validated medical device, not a production LIS, and not a place for PHI.

The public demo uses intentionally simple demo authentication:

- Username: `test`
- Password: `test`

That account exists so visitors can explore the app without setup. It is not security, and it is not pretending to be. All generated sample records are synthetic demo data prefixed with `__demo_`, using fake MRNs, `555-` phone numbers, and `example.com` email addresses.

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
| Views       | React + precompiled JSX bundle               | Hosted/Electron renderer hardening    |
| Persistence | Local-only IndexedDB                         | Local SQLite (Electron port)          |
| Events      | In-process semantic event bus + auto-audit   | Same surface, host-owned writes       |
| Auth        | Demo login (`test` / `test`)                 | Real local/session auth               |
| Type system | Plain JS + JSDoc                             | Stricter contracts where useful       |

Geist Sans + Geist Mono. Warm ivory + sage. 1.25px geometric icons. Conservative motion language — Material standard easings, no spring physics.

## Run locally

Static-served from the project root. Any no-cache HTTP server works:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000/>.

Sign in with `test` / `test`.

The checked-in precompiled JSX bundle (`compiled/app.bundle.js`) is the active runtime for the public demo. Rebuild it after JSX changes:

```bash
node scripts/build-jsx-bundle.cjs
```

## Roadmap

The current focus is the move from polished browser demo to a real local trust boundary: graduating off browser-only IndexedDB into an Electron host with SQLite persistence, host-owned audit, and real local authentication. The renderer keeps its UI surface; privileged writes move behind IPC.

## License

See [LICENSE](LICENSE).
