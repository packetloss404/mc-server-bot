# DyoBot Dashboard Revamp -- Parallel Execution Plan

## Document Purpose

This document defines how 4 lead Claude Code agents, each managing 2 engineer agents (8 total), will execute the 10-epic dashboard revamp in parallel. Each agent receives a concrete prompt and a clear file ownership boundary.

---

## 1. Agent Definitions and Domain Ownership

### Agent A: "Control Core" (Backend Foundation Lead)
**Epics owned:** E1 (Shared Control Platform), E3 (Mission Planner & Queue)
**Directory ownership:**
- `src/control/` (new, owns entirely)
- `src/voyager/VoyagerLoop.ts` (queue accessor additions only)
- `src/bot/BotInstance.ts` (status extension only)
- `src/server/api.ts` (new route registrations for commands and missions)
- `src/server/socketEvents.ts` (new event families)
- `data/commands.json`, `data/missions.json` (new persistence files)

**Delivers:** CommandTypes, CommandCenter, MissionTypes, MissionManager, VoyagerLoop safe accessors, command/mission REST endpoints, command/mission socket events, existing endpoint migration to CommandCenter.

**Engineer A1: "Command Engine"** -- Builds `src/control/CommandTypes.ts`, `src/control/CommandCenter.ts`, command persistence, command REST endpoints in `src/server/api.ts`, command socket events, and migrates existing pause/resume/stop/follow/walkto endpoints to use CommandCenter internally.

**Engineer A2: "Mission Engine"** -- Builds `src/control/MissionTypes.ts`, `src/control/MissionManager.ts`, mission persistence, mission REST endpoints, mission socket events. Adds safe queue accessors to `src/voyager/VoyagerLoop.ts`. Extends `BotInstance.getDetailedStatus()` with mission and command state. Wraps `BuildCoordinator` and `ChainCoordinator` as mission adapters.

---

### Agent B: "Dashboard UX" (Frontend Foundation Lead)
**Epics owned:** E9 (Frontend Architecture Hardening), E2 (Tactical Command Center Revamp), E8 (Diagnostics & History)
**Directory ownership:**
- `web/src/lib/store.ts` (store slice additions)
- `web/src/lib/api.ts` (new API client methods)
- `web/src/components/SocketProvider.tsx` (new event subscriptions)
- `web/src/components/BotCommandCenter.tsx` (refactor)
- `web/src/components/CommandHistoryPanel.tsx` (new)
- `web/src/components/MissionQueuePanel.tsx` (new)
- `web/src/app/bots/[name]/page.tsx` (evolution)
- `web/src/app/page.tsx` (evolution to fleet overview)
- `web/src/app/history/page.tsx` (new)

**Delivers:** Store slices (control, missions), SocketProvider upgrade, typed API client, refactored BotCommandCenter, reusable MissionQueuePanel and CommandHistoryPanel, upgraded bot detail page, upgraded dashboard page, history page, diagnostic views.

**Engineer B1: "Store & Socket"** -- Refactors `web/src/lib/store.ts` into slices (control, missions, worldPlanning, fleet, roles). Upgrades `web/src/components/SocketProvider.tsx` to subscribe to all new event families. Adds all new API client methods to `web/src/lib/api.ts`. Creates typed selectors.

**Engineer B2: "Tactical UI"** -- Refactors `BotCommandCenter.tsx` to use command API and store tracking. Creates `CommandHistoryPanel`, `MissionQueuePanel` components. Upgrades `web/src/app/bots/[name]/page.tsx` with mission queue, command history, diagnostic panels. Creates `web/src/app/history/page.tsx`. Adds override visibility and recovery suggestions.

---

### Agent C: "Spatial & Fleet" (Map and Multi-Bot Lead)
**Epics owned:** E4 (World Planning & Map), E5 (Fleet & Squads)
**Directory ownership:**
- `src/control/MarkerStore.ts` (new)
- `src/control/SquadManager.ts` (new)
- `web/src/app/map/page.tsx` (refactor and extension)
- `web/src/app/fleet/page.tsx` (new)
- `web/src/components/MapContextMenu.tsx` (new)
- `web/src/components/MarkerEditor.tsx` (new)
- `web/src/components/ZoneEditor.tsx` (new)
- `web/src/components/FleetSelectionBar.tsx` (new)
- `data/markers.json`, `data/zones.json`, `data/routes.json`, `data/squads.json` (new)

**Delivers:** MarkerStore backend, marker/zone/route CRUD APIs, SquadManager backend, squad CRUD APIs, refactored map page, map context menus, click-to-command, world object editors, fleet page, selection model, batch command execution, squad management UI.

**Engineer C1: "World Planning"** -- Creates `src/control/MarkerStore.ts`, marker/zone/route REST endpoints and socket events in `src/server/api.ts`. Refactors `web/src/app/map/page.tsx` (fix refs, separate canvas from toolbar). Adds marker/zone/route rendering, drawing tools, context menus, and click-to-command.

**Engineer C2: "Fleet Ops"** -- Creates `src/control/SquadManager.ts`, squad REST endpoints and socket events. Builds `web/src/app/fleet/page.tsx`, `FleetSelectionBar` component. Adds selection model to store (fleet slice). Implements batch command fan-out in CommandCenter. Adds squad editor and batch result views.

---

### Agent D: "Automation & Intelligence" (Roles, Commander, QA Lead)
**Epics owned:** E6 (Roles & Automation), E7 (Commander Console), E10 (QA & Telemetry)
**Directory ownership:**
- `src/control/RoleManager.ts` (new)
- `src/control/CommanderService.ts` (new)
- `web/src/app/roles/page.tsx` (new)
- `web/src/app/commander/page.tsx` (new)
- `web/src/components/RoleAssignmentPanel.tsx` (new)
- `web/src/components/CommanderPanel.tsx` (new)
- `data/roles.json` (new)
- Test infrastructure (both `package.json` and `web/package.json`)

**Delivers:** RoleManager, role CRUD APIs, role management page, role assignment UI, policy execution, CommanderService NL parser, commander page, plan preview/confirm UI, test runner setup, core tests for command and mission flows, telemetry instrumentation, migration cleanup.

**Engineer D1: "Roles & Policies"** -- Creates `src/control/RoleManager.ts`, role REST endpoints and socket events. Builds `web/src/app/roles/page.tsx` and `RoleAssignmentPanel` component. Adds role assignment to bot detail. Implements policy evaluation that generates missions via MissionManager. Adds role-generated mission badges.

**Engineer D2: "Commander & QA"** -- Creates `src/control/CommanderService.ts` with Gemini-backed NL parsing. Adds parse/execute endpoints. Builds `web/src/app/commander/page.tsx` and `CommanderPanel`. Sets up test runner (Vitest for backend, Vitest + React Testing Library for frontend). Writes core tests for CommandCenter, MissionManager, SquadManager. Adds telemetry instrumentation and migration cleanup.

---

## 2. Phased Execution Plan

### Phase 0: Shared Types and Contracts (Day 1, hours 1-4)
**Goal:** Establish the type contracts that all agents depend on.

| Agent | Work | Files |
|-------|------|-------|
| A (Control Core) | Engineer A1 creates `CommandTypes.ts` and `MissionTypes.ts` with all interfaces from `schemas.md`. Publishes command kind unions, status enums, payload shapes, and result types. | `src/control/CommandTypes.ts`, `src/control/MissionTypes.ts` |
| B (Dashboard UX) | Engineer B1 adds all new API client method stubs (commands, missions, markers, squads, roles, commander) to `web/src/lib/api.ts` using the schema contracts. These return typed promises but hit endpoints that don't exist yet. | `web/src/lib/api.ts` |
| C (Spatial & Fleet) | No work yet -- blocked on E1 types. Engineer C1 starts map page refactor (lint fixes, ref pattern cleanup, canvas/toolbar separation) which has no backend dependency. | `web/src/app/map/page.tsx` |
| D (Automation) | No work yet -- blocked on E1+E3. Engineer D2 sets up test infrastructure (Vitest config, test scripts in both package.json files, first empty test files). | `package.json`, `web/package.json`, test config files |

**Handoff checkpoint:** `CommandTypes.ts` and `MissionTypes.ts` are committed. All agents can import them. API client stubs are committed. Map refactor PR is ready.

---

### Phase 1: Core Backend Services (Day 1 hour 4 - Day 2)
**Goal:** CommandCenter and MissionManager are functional. Store and socket foundations are in place.

| Agent | Work | Files |
|-------|------|-------|
| A - Engineer A1 | Builds `CommandCenter.ts`: validate, dispatch, persist, emit lifecycle. Adds command REST endpoints to `api.ts`. Migrates existing pause/resume/stop/follow/walkto to use CommandCenter internally (keeping external signatures identical). | `src/control/CommandCenter.ts`, `src/server/api.ts` |
| A - Engineer A2 | Builds `MissionManager.ts`: CRUD, status transitions, persistence. Adds safe queue accessors to `VoyagerLoop.ts` (getQueue, removeFromQueue, insertAtFront, reorderQueue). Adds mission REST endpoints. Extends `BotInstance.getDetailedStatus()`. | `src/control/MissionManager.ts`, `src/voyager/VoyagerLoop.ts`, `src/bot/BotInstance.ts`, `src/server/api.ts` |
| B - Engineer B1 | Adds store slices: `control` (pending commands, history, selected bots, overrides) and `missions` (records, by bot, filters). Upgrades `SocketProvider.tsx` to subscribe to `command:*` and `mission:*` events. | `web/src/lib/store.ts`, `web/src/components/SocketProvider.tsx` |
| B - Engineer B2 | Begins `BotCommandCenter.tsx` refactor: replaces ad-hoc `exec()` with command creation via API client + store tracking. | `web/src/components/BotCommandCenter.tsx` |
| C - Engineer C1 | Completes map refactor. Builds `MarkerStore.ts` backend with CRUD and persistence. Adds marker/zone/route REST endpoints and socket events. | `src/control/MarkerStore.ts`, `src/server/api.ts` |
| C - Engineer C2 | Builds `SquadManager.ts` with CRUD, persistence, member management. Adds squad REST endpoints and socket events. | `src/control/SquadManager.ts`, `src/server/api.ts` |
| D - Engineer D1 | Begins `RoleManager.ts` data model and persistence (does not need MissionManager yet, just the types). Adds role CRUD endpoints. | `src/control/RoleManager.ts`, `src/server/api.ts` |
| D - Engineer D2 | Writes unit tests for `CommandCenter` and `MissionManager` as they stabilize (can start with type tests and mock-based tests). | `test/control/CommandCenter.test.ts`, `test/control/MissionManager.test.ts` |

**Handoff checkpoint:** CommandCenter dispatches commands and emits events. MissionManager CRUD works. VoyagerLoop has safe accessors. Existing endpoints still work via CommandCenter. Store has control+missions slices. SocketProvider handles new events. MarkerStore and SquadManager have CRUD. RoleManager has data model.

---

### Phase 2: Feature UI Buildout (Day 2-3)
**Goal:** All primary UI surfaces are functional using the Phase 1 backend.

| Agent | Work | Files |
|-------|------|-------|
| A - Engineer A1 | Adds new command types: `move_to_marker`, `return_to_base`, `regroup`, `guard_zone`, `patrol_route`, `deposit_inventory`, `equip_best`, `unstuck`. Implements dispatch handlers for each. | `src/control/CommandCenter.ts`, `src/control/CommandTypes.ts` |
| A - Engineer A2 | Wraps `BuildCoordinator` and `ChainCoordinator` as mission adapters. Creates mission types `build_schematic` and `supply_chain` that delegate to existing coordinators. Adds per-bot mission queue management endpoints. | `src/control/MissionManager.ts`, `src/server/api.ts` |
| B - Engineer B1 | Adds remaining store slices: `worldPlanning` (markers, zones, routes, selected, drawing mode), `fleet` (squads, selection, bulk state), `roles` (assignments, edit state). Subscribes SocketProvider to `marker:*`, `squad:*`, `role:*`. | `web/src/lib/store.ts`, `web/src/components/SocketProvider.tsx` |
| B - Engineer B2 | Creates `MissionQueuePanel` and `CommandHistoryPanel` components. Integrates both into `web/src/app/bots/[name]/page.tsx`. Adds override visibility, diagnostic timeline, recovery suggestions. Creates `web/src/app/history/page.tsx`. | `web/src/components/MissionQueuePanel.tsx`, `web/src/components/CommandHistoryPanel.tsx`, `web/src/app/bots/[name]/page.tsx`, `web/src/app/history/page.tsx` |
| C - Engineer C1 | Adds marker/zone/route rendering layers to map canvas. Builds drawing tools for zones and routes. Adds `MapContextMenu` for entities and terrain. Implements click-to-command (select bot, right-click location, choose command). Creates `MarkerEditor` and `ZoneEditor` components. | `web/src/app/map/page.tsx`, `web/src/components/MapContextMenu.tsx`, `web/src/components/MarkerEditor.tsx`, `web/src/components/ZoneEditor.tsx` |
| C - Engineer C2 | Builds `web/src/app/fleet/page.tsx` with squad management, selection model, batch actions. Creates `FleetSelectionBar` component. Adds batch command fan-out logic to `CommandCenter`. Implements squad-scoped command and mission dispatch. | `web/src/app/fleet/page.tsx`, `web/src/components/FleetSelectionBar.tsx`, `src/control/CommandCenter.ts` |
| D - Engineer D1 | Builds `web/src/app/roles/page.tsx` with role assignment editor. Creates `RoleAssignmentPanel` component. Adds role assignment to bot detail page. Implements policy evaluation loop that generates missions via MissionManager when autonomy level permits. | `web/src/app/roles/page.tsx`, `web/src/components/RoleAssignmentPanel.tsx`, `src/control/RoleManager.ts` |
| D - Engineer D2 | Builds `CommanderService.ts` with Gemini-backed NL parsing. Adds parse/execute REST endpoints. Writes tests for MarkerStore and SquadManager. | `src/control/CommanderService.ts`, `src/server/api.ts`, `test/control/` |

**Handoff checkpoint:** All new command types work. Mission adapters wrap build and chain coordinators. All store slices exist. Map has markers/zones/routes and context menus. Fleet page works with squads and batch commands. Roles page works with assignments. Commander parse endpoint works. History page displays data.

---

### Phase 3: Integration and Polish (Day 3-4)
**Goal:** Cross-cutting features, page evolution, commander UI, and dashboard upgrade.

| Agent | Work | Files |
|-------|------|-------|
| A | Both engineers: integration testing of command and mission flows end-to-end. Fix edge cases in lifecycle events. Ensure existing endpoints remain compatible. Add command cancellation support for long-running actions. | `src/control/CommandCenter.ts`, `src/control/MissionManager.ts` |
| B - Engineer B1 | Upgrades `web/src/app/page.tsx` (dashboard) to fleet overview: fleet summary header, pending command summary, missions needing attention, stuck/failed highlights, quick bulk actions using FleetSelectionBar. | `web/src/app/page.tsx` |
| B - Engineer B2 | Integrates `FleetSelectionBar` into dashboard and map pages. Ensures shared selection state works across pages. Adds role summary badges to bot cards. Connects build and chain pages to mission model. | `web/src/app/page.tsx`, `web/src/app/map/page.tsx`, `web/src/components/BotCard.tsx`, `web/src/app/build/page.tsx`, `web/src/app/chains/page.tsx` |
| C - Engineer C1 | Adds squad overlays and active mission layers to map. Adds build-site and supply-chain overlays. Polish context menus and drawing tools. | `web/src/app/map/page.tsx` |
| C - Engineer C2 | Integrates fleet selection with map selection. Ensures squad commands work from both fleet and map pages. Adds squad summaries and result tracking. | `web/src/app/fleet/page.tsx`, `web/src/app/map/page.tsx` |
| D - Engineer D1 | Adds override semantics between role automation and manual commands. Adds role-generated mission badges. Integrates role data into fleet and bot detail views. | `src/control/RoleManager.ts`, `web/src/app/roles/page.tsx` |
| D - Engineer D2 | Builds `web/src/app/commander/page.tsx` with plan preview, warning display, confirm/cancel UI, execution history. Creates `CommanderPanel` component. Adds ambiguity handling and safety confirmations. | `web/src/app/commander/page.tsx`, `web/src/components/CommanderPanel.tsx` |

**Handoff checkpoint:** Dashboard is fleet-aware. Map has all layers. Fleet and map share selection state. Roles generate visible missions. Commander UI previews and executes plans. Build and chain pages are integrated.

---

### Phase 4: QA, Telemetry, and Launch (Day 4-5)
**Goal:** Stabilize, test, document.

| Agent | Work | Files |
|-------|------|-------|
| A | Both engineers: review and fix all command and mission edge cases. Ensure persistent data files survive restart cycles. Add structured logging with commandId, missionId, botName, source fields. | All `src/control/` files |
| B | Both engineers: remove redundant ad-hoc UI flows. Clean up page-specific mutation logic replaced by store/command system. Fix any UI regressions. Polish responsive layouts. | All `web/src/` files touched |
| C | Both engineers: fix map rendering edge cases. Ensure markers/zones persist and render correctly after refresh. Polish fleet batch operations. | `web/src/app/map/page.tsx`, `web/src/app/fleet/page.tsx` |
| D - Engineer D1 | Adds telemetry instrumentation to command and mission execution paths. Standardizes logger fields across control services. | `src/control/` |
| D - Engineer D2 | Writes remaining tests (SquadManager batch, RoleManager policy, CommanderService parse). Updates AGENTS.md with test commands. Creates migration checklist. Documents release notes. | `test/`, `AGENTS.md` |

**Handoff checkpoint:** All tests pass. No regressions in existing dashboard. Data persists across restarts. Logs are structured. Documentation is current.

---

## 3. Critical Path Analysis

The critical path is:

```
Phase 0: CommandTypes.ts (A1)
    |
Phase 1: CommandCenter.ts (A1) + MissionManager.ts (A2) [parallel]
    |                              |
Phase 2: New command types (A1)    Mission adapters (A2)
    |        \                         /
Phase 2: BotCommandCenter refactor (B2) + MissionQueuePanel (B2)
    |
Phase 3: Dashboard fleet overview (B1) + Commander UI (D2)
    |
Phase 4: QA and cleanup (all)
```

Items that can run fully in parallel with the critical path:
- Map refactor (C1, Phase 0-1) -- no backend dependency
- MarkerStore + SquadManager backends (C1+C2, Phase 1) -- depend only on types
- Test infrastructure (D2, Phase 0) -- no dependency
- RoleManager data model (D1, Phase 1) -- depends only on types
- Store slices (B1, Phase 1) -- depends only on types
- API client stubs (B1, Phase 0) -- depends only on schemas

---

## 4. Launch-Ready Agent Prompts

### Agent A: Control Core Lead

```
You are the Control Core lead for the DyoBot dashboard revamp. You own the backend
control foundation -- epics E1 (Shared Control Platform) and E3 (Mission Planner &
Queue Visibility).

## Your Domain
You own ALL files in `src/control/` (new directory you create). You also modify:
- `src/server/api.ts` (adding route registrations for commands and missions)
- `src/server/socketEvents.ts` (adding new event emission)
- `src/voyager/VoyagerLoop.ts` (adding safe queue accessors, NOT changing existing logic)
- `src/bot/BotInstance.ts` (extending getDetailedStatus() only)

## What You Build

### Engineer A1 builds the Command Engine:
1. `src/control/CommandTypes.ts` -- all command interfaces from schemas.md:
   CommandRecord, CommandType union, CommandStatus, scope, payload shapes, error shape.
   Also MissionRecord, MissionStep, MissionType, MissionStatus for Engineer A2.
2. `src/control/CommandCenter.ts` -- validate commands, dispatch to bot handlers,
   persist to data/commands.json, emit lifecycle events (command:queued/started/
   succeeded/failed/cancelled) via Socket.IO, support cancellation.
3. Command REST endpoints in api.ts: POST/GET /api/commands, GET /api/commands/:id,
   POST /api/commands/:id/cancel
4. Migrate existing endpoints (pause, resume, stop, follow, walkto) to internally
   create commands via CommandCenter while keeping external API signatures identical.
5. Add new command handlers: move_to_marker, return_to_base, regroup, guard_zone,
   patrol_route, deposit_inventory, equip_best, unstuck.

### Engineer A2 builds the Mission Engine:
1. `src/control/MissionManager.ts` -- CRUD for missions, status transitions,
   persistence to data/missions.json, socket event emission, relationship to
   VoyagerLoop queue.
2. Safe accessors on VoyagerLoop.ts: getQueuedTasks(), removeTask(id),
   insertTaskAtFront(task), reorderQueue(ids), getQueueLength(). Add task IDs
   and timestamps to queue items.
3. Mission REST endpoints: POST/GET /api/missions, GET /api/missions/:id,
   POST /api/missions/:id/{pause,resume,cancel,retry}, POST /api/bots/:name/
   mission-queue, PATCH /api/bots/:name/mission-queue.
4. Extend BotInstance.getDetailedStatus() with: currentCommand, queuedMissionCount,
   lastCommandResult, overrideState, roleAssignment summary.
5. Wrap BuildCoordinator as mission type 'build_schematic' and ChainCoordinator
   as mission type 'supply_chain'.

## Coordination Rules
- CommandTypes.ts must be committed FIRST (Phase 0) -- other agents depend on it.
- Do NOT modify web/ files -- Agent B owns all frontend.
- Do NOT modify map page or create MarkerStore -- Agent C owns spatial.
- When adding routes to api.ts, add them in clearly marked sections with comments.
- Emit socket events from services, not from route handlers.
- Keep api.ts thin: validate request, call service, return result.
- Preserve all existing endpoint behavior during migration.

## Schemas to implement (from dev/dashrevamp/plan/schemas.md):

interface CommandRecord {
  id: string;
  type: CommandType;
  scope: 'bot' | 'squad' | 'selection';
  targets: string[];
  payload: Record<string, unknown>;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  source: 'dashboard' | 'map' | 'role' | 'routine' | 'commander' | 'api';
  requestedBy?: string;
  status: 'queued' | 'started' | 'succeeded' | 'failed' | 'cancelled';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: Record<string, unknown>;
  error?: { code: string; message: string; retryable?: boolean };
}

interface MissionRecord {
  id: string;
  type: MissionType;
  title: string;
  description?: string;
  assigneeType: 'bot' | 'squad';
  assigneeIds: string[];
  status: 'draft' | 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  steps: MissionStep[];
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  blockedReason?: string;
  linkedCommandIds?: string[];
  source: 'dashboard' | 'map' | 'role' | 'routine' | 'commander';
}

## Current endpoint signatures to preserve:
POST /api/bots/:name/task, POST /api/bots/:name/pause, POST /api/bots/:name/resume,
POST /api/bots/:name/stop, POST /api/bots/:name/follow, POST /api/bots/:name/walkto
```

---

### Agent B: Dashboard UX Lead

```
You are the Dashboard UX lead for the DyoBot dashboard revamp. You own the frontend
foundation -- epics E9 (Frontend Architecture Hardening), E2 (Tactical Command Center
Revamp), and E8 (Diagnostics & History).

## Your Domain
You own ALL files in web/src/ except map/page.tsx and fleet/page.tsx. Specifically:
- web/src/lib/store.ts (store evolution)
- web/src/lib/api.ts (API client extensions)
- web/src/components/SocketProvider.tsx (event subscription upgrade)
- web/src/components/BotCommandCenter.tsx (refactor)
- web/src/components/CommandHistoryPanel.tsx (new)
- web/src/components/MissionQueuePanel.tsx (new)
- web/src/app/bots/[name]/page.tsx (evolution)
- web/src/app/page.tsx (evolution to fleet overview)
- web/src/app/history/page.tsx (new)
- web/src/app/manage/page.tsx (minor updates)

## What You Build

### Engineer B1 builds Store & Socket:
1. Refactor web/src/lib/store.ts: keep existing BotStore but add new slices:
   - control: { pendingCommands: Map, commandHistory: [], selectedBotIds: Set,
     activeOverrides: Map, commanderDraft: null }
   - missions: { missionsById: Map, missionIdsByBot: Map, missionIdsBySquad: Map,
     filters: {} }
   - worldPlanning: { markers: [], zones: [], routes: [], selectedMapObject: null,
     drawingMode: null }
   - fleet: { squads: [], selectionSet: Set, bulkActionState: null }
   - roles: { assignments: [], policyEditState: null }
   Add typed selectors for common queries.
2. Upgrade SocketProvider.tsx to subscribe to: command:queued/started/succeeded/
   failed/cancelled, mission:created/updated/completed/failed/cancelled,
   marker:created/updated, zone:updated, route:updated, squad:updated, role:updated.
   Normalize each event into the appropriate store slice.
3. Add all new API client methods to web/src/lib/api.ts:
   Commands: createCommand, getCommands, getCommand, cancelCommand
   Missions: createMission, getMissions, getMission, pauseMission, resumeMission,
   cancelMission, retryMission, getBotMissionQueue, updateBotMissionQueue
   World: getMarkers, createMarker, updateMarker, deleteMarker, getZones, createZone,
   updateZone, deleteZone, getRoutes, createRoute, updateRoute, deleteRoute
   Squads: getSquads, createSquad, updateSquad, deleteSquad, sendSquadCommand,
   sendSquadMission
   Roles: getRoleAssignments, createRoleAssignment, updateRoleAssignment,
   deleteRoleAssignment
   Commander: parseCommand, executeCommanderPlan

### Engineer B2 builds Tactical UI:
1. Refactor BotCommandCenter.tsx: replace exec() with api.createCommand() calls.
   Track command state via store control slice. Show pending/active/success/failure
   per command. Add quick actions: move_to_marker, return_to_base, regroup,
   guard_zone, unstuck. Add confirmation for high-impact actions.
2. Create MissionQueuePanel component: shows current mission, queued missions,
   recent failures. Supports reorder, cancel, retry, "do now" vs "do next".
3. Create CommandHistoryPanel: filterable list of recent commands with status badges.
4. Upgrade bots/[name]/page.tsx: integrate MissionQueuePanel, CommandHistoryPanel,
   override visibility, diagnostic timeline, role assignment summary.
5. Create history/page.tsx: full command+mission audit trail with filters.
6. Upgrade page.tsx (dashboard): fleet summary header, pending command summary,
   stuck/failed highlights, missions needing attention.

## Coordination Rules
- Do NOT modify any src/ backend files -- Agent A owns backend services.
- Do NOT modify map/page.tsx -- Agent C owns the map.
- Do NOT create fleet/page.tsx -- Agent C owns fleet.
- Import types from src/control/CommandTypes.ts or define parallel frontend types
  that match the schemas. If backend types aren't ready, define local equivalents
  and reconcile later.
- SocketProvider should normalize events into store updates, not trigger side effects.
- Keep polling as fallback, make socket events the primary update path.
```

---

### Agent C: Spatial & Fleet Lead

```
You are the Spatial & Fleet lead for the DyoBot dashboard revamp. You own epics
E4 (World Planning & Map Control) and E5 (Fleet Selection & Squads).

## Your Domain
You own:
- src/control/MarkerStore.ts (new)
- src/control/SquadManager.ts (new)
- web/src/app/map/page.tsx (refactor and major extension)
- web/src/app/fleet/page.tsx (new)
- web/src/components/MapContextMenu.tsx (new)
- web/src/components/MarkerEditor.tsx (new)
- web/src/components/ZoneEditor.tsx (new)
- web/src/components/FleetSelectionBar.tsx (new)
- data/markers.json, data/zones.json, data/routes.json, data/squads.json (new)
- Route registrations in src/server/api.ts for markers, zones, routes, squads

## What You Build

### Engineer C1 builds World Planning:
1. src/control/MarkerStore.ts: CRUD for markers, zones, routes. JSON persistence
   under data/. Spatial lookup helpers. Import MarkerRecord, ZoneRecord, RouteRecord
   from CommandTypes.ts (or define locally if types not ready yet).
2. REST endpoints in api.ts: GET/POST /api/markers, PATCH/DELETE /api/markers/:id,
   GET/POST /api/zones, PATCH/DELETE /api/zones/:id, GET/POST /api/routes,
   PATCH/DELETE /api/routes/:id. Socket events: marker:created, marker:updated,
   zone:updated, route:updated.
3. Refactor map/page.tsx: fix render-time ref mutations (botsRef.current = bots
   during render). Separate canvas rendering from toolbar state. Extract interaction
   state machine.
4. Add marker/zone/route rendering to map canvas. Add drawing tools for zones
   (rectangle, circle) and routes (waypoint sequence).
5. Create MapContextMenu: right-click terrain -> walk_to_coords, create marker;
   right-click entity -> follow, command menu. Connect to command creation API.
6. Create MarkerEditor and ZoneEditor components for sidebar editing.

### Engineer C2 builds Fleet Ops:
1. src/control/SquadManager.ts: CRUD for squads. Member management. JSON persistence.
   Batch command dispatch that fans out to CommandCenter.
2. REST endpoints: GET/POST /api/squads, GET/PATCH/DELETE /api/squads/:id,
   POST /api/squads/:id/commands, POST /api/squads/:id/missions.
3. Create fleet/page.tsx: squad list, squad detail, member management, batch action
   toolbar, command/mission dispatching to squads, per-bot result tracking.
4. Create FleetSelectionBar: appears when bots are selected, shows count and
   available bulk actions (move all, stop all, assign mission).
5. Add batch command fan-out to CommandCenter (coordinate with Agent A): when scope
   is 'squad' or 'selection', create individual commands per target and aggregate
   results.

## Coordination Rules
- When adding routes to api.ts, add them in clearly labeled sections after Agent A's
  command/mission routes.
- Depend on CommandCenter (Agent A) for command dispatch -- call it, don't reimplement.
- Use store slices that Agent B creates (worldPlanning, fleet). If they aren't ready,
  use local component state temporarily and migrate.
- The map refactor (Phase 0-1) can proceed before any backend dependency.
- Do NOT modify store.ts or SocketProvider.tsx -- Agent B owns those. Communicate
  which store actions and socket events you need.
```

---

### Agent D: Automation & Intelligence Lead

```
You are the Automation & Intelligence lead for the DyoBot dashboard revamp. You own
epics E6 (Roles & Automation), E7 (Commander Console), and E10 (QA & Telemetry).

## Your Domain
You own:
- src/control/RoleManager.ts (new)
- src/control/CommanderService.ts (new)
- web/src/app/roles/page.tsx (new)
- web/src/app/commander/page.tsx (new)
- web/src/components/RoleAssignmentPanel.tsx (new)
- web/src/components/CommanderPanel.tsx (new)
- data/roles.json (new)
- Test infrastructure and test files
- Telemetry instrumentation across src/control/
- AGENTS.md updates
- Route registrations in src/server/api.ts for roles and commander

## What You Build

### Engineer D1 builds Roles & Policies:
1. src/control/RoleManager.ts: persist role assignments to data/roles.json.
   CRUD operations. Evaluate role policies on a timer (check if bots with
   'autonomous' level need missions generated). Generate missions via MissionManager.
   Honor interrupt policies (always, confirm-if-busy, never-while-critical).
2. REST endpoints: GET /api/roles, POST /api/roles/assignments,
   PATCH/DELETE /api/roles/assignments/:id. Socket: role:updated.
3. Create roles/page.tsx: list all bots with current role, autonomy level, home
   marker, allowed zones. Inline editing. Role assignment flow.
4. Create RoleAssignmentPanel: reusable panel for assigning role to a bot, used
   in both roles page and bot detail.
5. Add override semantics: manual commands mark bot as 'overridden', role automation
   pauses until override expires or is cleared.

### Engineer D2 builds Commander & QA:
1. src/control/CommanderService.ts: parse(input) uses Gemini to map NL to a
   CommanderPlan (commands + missions + warnings + confidence). execute(planId)
   dispatches through CommandCenter and MissionManager.
2. REST: POST /api/commander/parse, POST /api/commander/execute.
3. Create commander/page.tsx: text input, plan preview (showing commands and
   missions that will be created), warning display, confidence indicator,
   confirm/cancel buttons, execution history.
4. Create CommanderPanel component for the plan preview/confirm flow.
5. Set up Vitest for backend (in root package.json: "test": "vitest run").
   Set up Vitest + React Testing Library for frontend (in web/package.json).
6. Write tests for: CommandCenter (create, dispatch, lifecycle, cancellation),
   MissionManager (CRUD, status transitions, queue operations), SquadManager
   (CRUD, batch dispatch), RoleManager (assignment CRUD, policy evaluation).
7. Add telemetry: instrument command execution duration, mission completion rate,
   failed command count. Use existing logger with standardized fields:
   { commandId, missionId, botName, source, durationMs }.
8. Update AGENTS.md with: npm test, npm run test:watch, npm run test -- --grep
   "pattern" for single test execution.
9. Migration cleanup: identify and remove redundant ad-hoc command logic from
   pages once replaced by shared control system.

## Coordination Rules
- Depend on CommandCenter and MissionManager (Agent A) for dispatch. Import and
  call them, don't duplicate logic.
- Depend on MarkerStore (Agent C) for zone/marker references in role policies.
- Use store slices from Agent B (roles slice, control slice).
- CommanderService.ts needs access to BotManager, CommandCenter, MissionManager,
  MarkerStore -- inject via constructor.
- For Gemini integration, follow existing patterns in src/ai/LLMClient.ts.
- Tests should mock BotManager and Mineflayer -- never connect to a real server.
- Your work starts later than Agents A/B/C. Use Phase 0-1 for test infrastructure.
  Roles data model can start Phase 1. Full feature work in Phase 2-3.
```

---

## 5. Integration Risk Map

### High-Risk Collision Points

**1. `src/server/api.ts` -- 4 agents all add routes**
- **Risk:** Merge conflicts guaranteed. All agents add route registrations here.
- **Mitigation:** Each agent adds routes in a clearly marked, commented section. Use this ordering: (1) Agent A: command + mission routes, (2) Agent C: marker/zone/route/squad routes, (3) Agent D: role/commander routes. Agent B does not touch this file. Consider refactoring into route files (`src/server/commandRoutes.ts`, etc.) in Phase 1 to separate concerns, but only if needed.

**2. `web/src/lib/store.ts` -- Agent B owns, but all agents need state**
- **Risk:** Agent B must add slices that Agents C and D need. If B is behind, C and D are blocked on the frontend.
- **Mitigation:** Agent B commits store slices in Phase 1 before C and D need them in Phase 2. If delayed, C and D use local component state and migrate later.

**3. `web/src/components/SocketProvider.tsx` -- Agent B owns, events from all**
- **Risk:** Agents A, C, D all emit new socket events that SocketProvider must handle.
- **Mitigation:** Agent B adds all event subscriptions in Phase 1-2 based on the known event list from the planning docs. The event names are pre-agreed. If a new event is needed, agents communicate the name and payload shape.

**4. `web/src/lib/api.ts` -- Agent B owns, all agents define endpoints**
- **Risk:** API client methods must match backend endpoint signatures defined by Agents A, C, D.
- **Mitigation:** Agent B stubs all methods in Phase 0 based on the API plan. Backend agents confirm signatures or Agent B adjusts in Phase 2.

**5. `src/control/CommandCenter.ts` -- Agent A owns, Agent C calls for batch dispatch**
- **Risk:** Agent C needs batch/fan-out support in CommandCenter for squad commands.
- **Mitigation:** Agent A implements fan-out in Phase 1 as part of the CommandCenter's `scope: 'squad' | 'selection'` handling. Agent C calls it, doesn't modify it.

**6. BotInstance.getDetailedStatus() -- Agent A extends, Agent B reads**
- **Risk:** Frontend expects certain fields before backend adds them.
- **Mitigation:** Agent A extends this in Phase 1. Agent B should handle missing fields gracefully with optional chaining until backend is ready.

### Medium-Risk Points

**7. Map page -- Agent C owns, but Agent B's FleetSelectionBar appears on it in Phase 3**
- **Mitigation:** Agent B builds FleetSelectionBar as a standalone component. Agent C imports and places it on the map page.

**8. `src/voyager/VoyagerLoop.ts` -- Agent A adds accessors, core loop unchanged**
- **Mitigation:** Agent A only adds new public methods. Never modifies existing `scheduleNext()`, `runIteration()`, or `queuePlayerTask()` logic. New methods wrap the private `playerTaskQueue` array.

**9. Dashboard page.tsx -- Agent B evolves it, Agent C's FleetSelectionBar needed**
- **Mitigation:** Agent B imports FleetSelectionBar by name. If Agent C hasn't built it yet, Agent B uses a placeholder div and replaces it when available.

### Low-Risk Points

- `data/*.json` files -- no collision, each agent creates different files
- New pages (fleet, roles, commander, history) -- each owned by a single agent
- New components -- each owned by a single agent except FleetSelectionBar (C builds, B imports)

---

## 6. Communication Protocol Between Agents

Each agent should follow these conventions:

1. **Branch naming:** `revamp/agent-{letter}-{phase}-{description}` (e.g., `revamp/agent-a-p0-command-types`)
2. **Commit messages:** Prefix with agent letter: `[A] Add CommandTypes.ts`, `[B] Refactor store slices`
3. **Interface contracts:** When an agent creates a type or endpoint that another agent depends on, commit it first and note in the commit message: `[A] Add CommandCenter.ts -- B,C,D can now import`
4. **Merge order per phase:** A merges first (types and services), then B (store and socket), then C (spatial), then D (automation). This respects dependency flow.
5. **Conflict resolution:** If merge conflicts occur in `api.ts`, the later-merging agent resolves by keeping both sets of routes in the correct section order.

---

## 7. Verification Checklist Per Phase

### Phase 0 Complete When:
- [ ] `src/control/CommandTypes.ts` exists with all interfaces
- [ ] `web/src/lib/api.ts` has all new method stubs
- [ ] Map page ref issues are fixed
- [ ] Test runner runs `npm test` successfully (even with 0 tests)
- [ ] `npm run build` succeeds

### Phase 1 Complete When:
- [ ] `POST /api/commands` creates and returns a command
- [ ] Existing `POST /api/bots/:name/pause` still works and now creates a command internally
- [ ] `command:started` socket event fires when a command executes
- [ ] `POST /api/missions` creates and persists a mission
- [ ] `VoyagerLoop` queue is inspectable via new accessors
- [ ] Store has control and missions slices
- [ ] SocketProvider subscribes to `command:*` and `mission:*`
- [ ] MarkerStore CRUD works via REST
- [ ] SquadManager CRUD works via REST
- [ ] `npm run build` succeeds for both backend and frontend

### Phase 2 Complete When:
- [ ] BotCommandCenter uses command API (not ad-hoc exec)
- [ ] MissionQueuePanel renders on bot detail page
- [ ] History page displays command and mission records
- [ ] Map shows markers and zones, context menu works
- [ ] Fleet page shows squads and supports batch commands
- [ ] Roles page shows assignments and supports editing
- [ ] Commander parse endpoint returns a plan preview
- [ ] All store slices populated from socket events

### Phase 3 Complete When:
- [ ] Dashboard page is fleet-aware with exception highlights
- [ ] FleetSelectionBar works across dashboard, map, and fleet pages
- [ ] Build and chain pages are wired to mission model
- [ ] Commander UI previews and executes plans
- [ ] Role automation generates visible missions
- [ ] No regressions in existing bot control

### Phase 4 Complete When:
- [ ] Tests cover CommandCenter, MissionManager, SquadManager, RoleManager
- [ ] All redundant ad-hoc UI removed
- [ ] Logger fields standardized across control services
- [ ] AGENTS.md updated with test commands
- [ ] `npm run build && npm test` passes clean
- [ ] Data files survive server restart
