# Lattice LIS Ledger

## Run log

### 2026-05-08 — Split `other-pages.jsx` into domain page files

Structural move completed with code kept in the same page-level shapes and existing window/global navigation hooks preserved.

Files created:

- `shared-pages.jsx` — `PageHeader`, `Page`, `EmptyTable`, reusable table/status pills, date/name helpers, and shared safety-confirm helpers.
- `dashboard-pages.jsx` — dashboard KPIs, queue panels, client volume, delivery status, and activity widgets.
- `order-workflow-pages.jsx` — orders, specimens, and worklists pages.
- `result-pages.jsx` — results review/correction plus patient result context.
- `interop-pages.jsx` — instrument/interface pages and HL7/LML intake panels.
- `reports-pages.jsx` — activity/audit report page.
- `reference-pages.jsx` — test catalog, clients, and locations setup.
- `label-pages.jsx` — labels/printers/template setup.
- `mapper-pages.jsx` — mapper editor/tester.
- `quality-pages.jsx` — Levey-Jennings, Westgard rules, and QC page.
- `notification-pages.jsx` — TAT notification routing/threshold page.
- `admin-pages.jsx` — admin landing page, DB restore preview modal, and final `Object.assign(window, ...)` registry.

Files removed:

- `other-pages.jsx` deleted cleanly; remaining source/build references now point at the split files.

Other files updated:

- `index.html` cache version bumped to `20260508g`; split JSX scripts added in load order after persistence/runtime scripts and before `app.jsx`; compiled bundle tag retained as a commented no-Babel deployment path.
- `scripts/build-jsx-bundle.cjs` split source list updated; Babel remains the primary transformer, with a TypeScript JSX fallback only when the Babel standalone cache/network is unavailable.
- `compiled/app.bundle.js` regenerated from the split source list.
- `entity-drawer.jsx` comment updated so it no longer points at the removed junk-drawer file.

Tests/checks run:

- `node scripts/build-jsx-bundle.cjs` — passed using the TypeScript JSX fallback because this environment cannot fetch Babel standalone from unpkg and no cache exists.
- Split JSX transpile check across all 12 new page files — passed with TypeScript JSX transpilation.
- `compiled/app.bundle.js` VM smoke — passed; bundle evaluated and all 21 expected page/shared globals were present on `window`.
- Babel standalone transform check — blocked by environment: `.build-cache/babel-standalone-7.29.0.min.js` is missing and outbound fetch to unpkg is blocked.
- Chrome MCP end-to-end checks — not run because no Chrome/Chrome MCP browser tool is available in this container.

Scenarios verified as far as the environment allows:

- Page globals still register on `window` after the split.
- Build source order keeps shared helpers before page domains and keeps `admin-pages.jsx` after all page domains so the final registry sees every component.
- Existing cross-component hook call sites were preserved; the hook implementations still live in `app.jsx`/`entity-drawer.jsx`.

Spotted during split, not fixed:

- Full browser verification still needs a Chrome MCP pass in an environment with browser tooling and Babel network/cache access.

### 2026-05-08 — Proposed `other-pages.jsx` split (pre-execution)

Proposed domain split after an end-to-end survey of `other-pages.jsx`:

- `shared-pages.jsx`
  - Shared screen chrome and reusable table/status helpers: `PageHeader`, `Page`, `EmptyTable`, `TatPill`, `PriorityPill`, `StatusPill`, `SpecimenStatePill`, `ConditionPill`.
- `dashboard-pages.jsx`
  - Operational dashboard and dashboard-only panels: `DashboardPage`, `TatPanel`, `SpecimenStatusPanel`, `PendingReviewPanel`, `ClientVolumePanel`, `DeliveryStatusPanel`, `ActivityPanel`, `ActivityRow`.
- `order-workflow-pages.jsx`
  - Order/specimen/worklist operational queues: `OrdersPage`, `SpecimensPage`, `WorklistsPage`.
- `result-pages.jsx`
  - Result review/correction and patient result context: `ResultsPage`, `CorrectResultModal`, `ResultFlagPill`, `ResultStatusPill`, `DeliveryPill`, `PatientsPage`, `PatientDetail`.
- `interop-pages.jsx`
  - Analyzer/interface and inbound payload tooling: `InstrumentsPage`, `InterfacesPage`, `MapperIntakePanel`, `Hl7IntakePanel`, plus their shared intake constants.
- `reports-pages.jsx`
  - Audit/activity reporting: `ReportsPage`.
- `reference-pages.jsx`
  - Master/reference setup: `TestCatalogPage`, `RefRangeRow`, `CatalogField`, `ClientsPage`, `LocationsPage`, location/department constants.
- `label-pages.jsx`
  - Label template/printer setup: `LabelsPage`, specimen type/default ZPL constants.
- `mapper-pages.jsx`
  - Lattice Mapper Language editor/runtime tester: `MappersPage`.
- `quality-pages.jsx`
  - QC and Westgard configuration: `LeveyJenningsChart`, `WestgardRulesPanel`, `QcPage`, Westgard rule metadata.
- `notification-pages.jsx`
  - TAT notification thresholds/routing: `NotificationsPage`, notification option constants.
- `admin-pages.jsx`
  - Admin landing page and restore preview modal: `AdminPage`, `ImportPreviewModal`, final `Object.assign(window, ...)` registry for existing globals.

Planned load order: shared first, then domain pages, with `admin-pages.jsx` last so the final window registry runs after every page component exists. Existing global nav hooks (`openEntity`, `openNewOrder`, `openOrdersFilteredByClient`, `openCorrectionFor`, `__navTo`) are not being rehomed; this pass only preserves calls to them.

## Next up

- ~~Execute the proposed `other-pages.jsx` split as a structural move only.~~
- ~~Regenerate `compiled/app.bundle.js` from the split file list.~~
- Run a full Chrome MCP smoke in an environment with Chrome MCP/browser tooling: boot, all pages, order → client → order navigation, and safety modals.
- Re-run the Babel standalone transform check when `.build-cache/babel-standalone-7.29.0.min.js` is present or unpkg access is available.

## Decisions log

- 2026-05-08: Use a domain-page split, not a component-by-component module refactor, because the current app runs as browser globals/Babel scripts and this pass is scoped to moving code without changing behavior.
