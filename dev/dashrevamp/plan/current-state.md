# Dashboard Revamp Current State

This document is the current health check for the dashboard revamp planning package.

It compares the original plan to what is actually present in the repo now.

## Overall Status

- Backend control foundations are mostly implemented.
- Frontend page surfaces are mostly present.
- Integration between backend lifecycle models and frontend live state is still incomplete.
- Role automation, reusable routines/templates, and some diagnostics/recovery flows remain unfinished.

## Status By Area

| Area | Status | Notes |
|---|---|---|
| Shared command model | Implemented | Command types, lifecycle, APIs, persistence, and cancellation are in place. |
| Mission system | Partial | Mission models and APIs exist, but queue manipulation is split between mission records and raw Voyager queue access. |
| Tactical UI | Partial | Bot detail, dashboard, history page, mission panel, and command panel exist, but several controls are placeholders or use older activity data. |
| Map-first control | Partial | Marker/zone/route persistence and rendering exist; zone/route authoring and richer command flows are incomplete. |
| Fleet and squads | Partial | Squad backend and fleet page exist; selection state and backend integration are inconsistent. |
| Roles and automation | Partial | Role CRUD and UI exist; policy execution and autonomy enforcement are not wired. |
| Commander | Partial | Parse/execute backend and UI exist; contract drift and missing persistent history/drafts remain. |
| Diagnostics/history | Partial | History and stats surfaces exist, but not all are driven by shared command/mission records. |
| Tests and telemetry | Partial | Backend coverage and metrics exist; frontend tests and standardized control telemetry are still thin. |
| Routines/templates | Missing | No general command macros or reusable mission template system exists yet. |

## Milestone Checklist

### M1 - Shared Control Model

Status: mostly implemented

- Done
  - `src/control/CommandTypes.ts`
  - `src/control/CommandCenter.ts`
  - `POST/GET /api/commands` and cancel endpoints in `src/server/api.ts`
  - legacy pause/resume/stop/follow/walkto routes now create commands internally
- Partial
  - frontend pending/completed command state exists, but is split across stores
  - `command:*` lifecycle events exist on the backend, but frontend socket handling is incomplete
- Remaining
  - unify frontend command state under one store model
  - use command lifecycle sockets as the primary source of truth

### M2 - Mission Queue And Planner

Status: partial

- Done
  - `src/control/MissionTypes.ts`
  - `src/control/MissionManager.ts`
  - mission REST endpoints in `src/server/api.ts`
  - queue inspection helpers added to `src/voyager/VoyagerLoop.ts`
- Partial
  - bot detail page shows mission queue/history surfaces
  - queue visibility is split between mission records and Voyager task queue
- Remaining
  - first-class reorder/prepend/retry/clear flows
  - consistent mission history driven by mission records
  - richer bot detail diagnostics around mission failures and interrupt semantics

### M3 - Spatial Control

Status: partial

- Done
  - `src/control/MarkerStore.ts`
  - marker/zone/route CRUD APIs in `src/server/api.ts`
  - map page renders markers, zones, and routes
  - marker editing and context menu surfaces exist
- Partial
  - map click-to-command exists in a limited form
  - world objects are reused in some screens
- Remaining
  - zone drawing/editor UX
  - route authoring/editor UX
  - mission assignment from selected map objects
  - squad overlays, mission overlays, and richer map-first control flows

### M4 - Fleet And Squads

Status: partial

- Done
  - `src/control/SquadManager.ts`
  - squad CRUD endpoints in `src/server/api.ts`
  - `web/src/app/fleet/page.tsx`
  - `web/src/components/FleetSelectionBar.tsx`
  - backend batch command fan-out exists in `src/control/CommandCenter.ts`
- Partial
  - multi-select exists but is split across store implementations
  - fleet page has squad/batch UX, but not all flows are backend-backed
- Remaining
  - unified cross-page selection state
  - squad mission UI and partial-result tracking polish
  - real use of `activeMissionId` on squads

### M5 - Roles And Automation

Status: partial

- Done
  - `src/control/RoleManager.ts`
  - roles endpoints in `src/server/api.ts`
  - `web/src/app/roles/page.tsx`
  - `web/src/components/RoleAssignmentPanel.tsx`
- Partial
  - role assignment, autonomy level, home marker, and allowed zones are present
  - override tracking exists in backend data
- Remaining
  - policy evaluation that creates missions
  - autonomy enforcement
  - interrupt policy/loadout policy implementation
  - visible role conflict/health views

### M6 - Commander Console

Status: partial

- Done
  - `src/control/CommanderService.ts`
  - parse/execute commander APIs in `src/server/api.ts`
  - `web/src/app/commander/page.tsx`
  - `web/src/components/CommanderPanel.tsx`
- Partial
  - preview, warnings, confidence, and confirm/cancel UX exist
  - execution history exists only as local page state
- Remaining
  - resolve frontend/backend contract drift
  - ambiguity clarification flow beyond warnings
  - persistent commander drafts/history

### M7 - Hardening And Release

Status: partial

- Done
  - backend Vitest setup exists
  - control test files exist under `test/control/`
  - basic command/mission metrics and metrics API are present
- Partial
  - telemetry is present but not fully standardized across control services
  - frontend test setup exists but is mostly placeholder coverage
- Remaining
  - deeper frontend coverage
  - more complete regression coverage for role/fleet/map integrations
  - finish cleanup of legacy UI flows and duplicated stores

## Dev Notes Cross-Check

The old `dev/PACKETLOSS404-DEV-NOTES.md` list is partly stale.

- Still open
  - deposit inventory command is still a stub
  - `activeMissionId` on squads still appears unused
  - `cooperation` and `help_request` events still appear unrecorded
  - `getUnread()` still appears unused in bot-to-bot comms
- No longer fully accurate
  - `idle_long` is now triggered
  - bot-to-bot messaging is at least partially processed

## Recommended Next Documentation Source Of Truth

Use these files together:

- `dev/dashrevamp/plan/current-state.md` for what is done now
- `dev/dashrevamp/plan/milestones.md` for milestone-by-milestone status and remaining work
- `dev/dashrevamp/plan/features.md` for feature scope with implementation notes
- `dev/dashrevamp/plan/roadmap.md` for forward-looking sequencing from the current repo state
