# Dashboard Revamp -- Sprint Plan (3 Sprints, 10 Agents Each)

Generated April 5, 2026 from `dev/packetloss404/dashrevamp-remaining.md`

---

## Codebase Orientation

Key locations:

- **Backend control platform**: `src/control/` -- CommandCenter.ts, MissionManager.ts, SquadManager.ts, RoleManager.ts, MarkerStore.ts, CommanderService.ts, FleetTypes.ts, MissionTypes.ts, CommandTypes.ts, WorldTypes.ts
- **Server**: `src/server/api.ts` (Express routes), `socketEvents.ts`
- **Frontend stores**: `web/src/lib/store.ts` (7 Zustand stores: useBotStore, useControlStore, useFleetStore, useRoleStore, useMissionStore, useWorldStore, useSchematicPlacementStore), plus duplicates in `fleetStore.ts`, `mapStore.ts`, `controlStore.ts` (re-export), `missionStore.ts` (re-export)
- **Frontend pages**: `web/src/app/` -- page.tsx (dashboard), fleet/, map/, commander/, roles/, history/, bots/[name]/, activity/, build/, chains/, coordination/, chat/, manage/, skills/, social/, stats/
- **Frontend components**: `web/src/components/` -- BotCard, CommanderPanel, MissionQueuePanel, FleetSelectionBar, RoleAssignmentPanel, SocketProvider, map/ (MapContextMenu, MapEntitySidebar, MapToolbar, MarkerEditor, mapDrawing.ts)
- **Backend tests**: `test/control/` -- 7 test files covering CommandCenter, CommanderService, MarkerStore, MissionManager, RoleManager, SquadManager, integration
- **Frontend tests**: `web/__tests__/components/` -- only CommanderPanel.test.tsx, MapContextMenu.test.tsx
- **Bot comms**: `src/social/BotComms.ts` -- has `getUnread()` unused
- **Actions**: `src/actions/container.ts` -- has chest interaction logic but `deposit_inventory` command in CommandCenter is still a stub

Key structural issues found:
- `fleetStore.ts` defines a completely separate `useFleetStore` with a different `Squad` type and `roles` array, conflicting with the `useFleetStore` in `store.ts`
- `mapStore.ts` defines a separate `useMapStore` with its own `MapMarker`/`MapZone` types, while `store.ts` has `useWorldStore` with `MarkerRecord`/`ZoneRecord` types from the API
- `controlStore.ts` and `missionStore.ts` are just re-exports of `store.ts` -- harmless but misleading
- SocketProvider has 3 polling intervals (bots 5s, world 30s, players 10s) alongside socket events
- `evaluateAutomation()` in RoleManager does generate missions but only for `autonomous` and `assisted` levels; `manual` is skipped. The real gap is that autonomy levels are not enforced in bot behavior (the VoyagerLoop does not check them)
- `blockedReason` exists in data and is shown in MissionQueuePanel and history, but not on bot cards or the main dashboard
- `activeMissionId` on SquadRecord (FleetTypes.ts line 7) is set in api.ts line 938 but never read by the frontend

---

## SPRINT 1: Foundations and Integration Fixes

**Goal**: Consolidate fragmented state, eliminate polling where sockets exist, wire up backend logic that is defined but disconnected, and build shared infrastructure that Sprint 2 features depend on.

---

### Agent 1-1: Store Consolidation -- Eliminate Duplicate Stores

**Deliverable**: A single source of truth for all Zustand state. Delete the duplicate/divergent stores and normalize the type system.

**Files touched**:
- `web/src/lib/store.ts` -- primary: merge all state here
- `web/src/lib/fleetStore.ts` -- delete or convert to re-export
- `web/src/lib/mapStore.ts` -- delete or convert to re-export
- `web/src/lib/controlStore.ts` -- already a re-export, keep
- `web/src/lib/missionStore.ts` -- already a re-export, keep
- All importers of the deleted stores (fleet page, map page, etc.)

**Work**:
1. Audit every import of `useFleetStore` from `fleetStore.ts` vs `store.ts` -- they have different shapes (fleetStore.ts has `roles` array; store.ts has separate useRoleStore). Resolve to the canonical `store.ts` versions.
2. Delete or empty `fleetStore.ts` -- either re-export from store.ts or leave a deprecation comment and re-export.
3. For `mapStore.ts`: its `MapMarker`/`MapZone` types diverge from the `MarkerRecord`/`ZoneRecord` used by `useWorldStore` in store.ts. The map page appears to use `useWorldStore` (from store.ts) for the authoritative data. Determine if `useMapStore` is used anywhere in the map page for local editing state (interaction mode, editing IDs). If so, keep it but rename to `useMapEditingStore` for clarity and remove the duplicate marker/zone lists. If not used, delete.
4. Update all imports across pages and components.

**Acceptance criteria**:
- Only one `useFleetStore` export path exists.
- No duplicate marker/zone state (single source in `useWorldStore`).
- `yarn tsc --noEmit` passes with no import errors.
- App runs, fleet page and map page render correctly.

---

### Agent 1-2: Socket-First Updates -- Eliminate Redundant Polling

**Deliverable**: SocketProvider uses socket events as the primary update path. Polling intervals are fallback-only (increased to 30s+ or removed).

**Files touched**:
- `web/src/components/SocketProvider.tsx`
- `src/server/socketEvents.ts` -- may need new events for players

**Work**:
1. The 5s bot poll, 10s player poll, and 30s world poll are redundant with socket events already being received (`bot:position`, `bot:health`, `bot:state`, `bot:inventory`, `bot:spawn`, `bot:disconnect`, `player:position`, `player:join`, `player:leave`).
2. Change bot poll from 5s to 30s (keep as reconnect-recovery fallback).
3. Change player poll from 10s to 60s.
4. For `squad:updated` and `role:updated` socket events: currently they re-fetch the full list from API. Change to accept the payload directly from the socket event (the backend already emits the full data for `role:updated` at RoleManager.ts line 332).
5. Add socket-driven fleet metrics update if commander/mission data changes arrive.
6. Verify `command:*` events work end-to-end (currently they refetch via API on each event -- keep this pattern or switch to direct payload, but at least document the approach).

**Acceptance criteria**:
- No poll interval shorter than 30s.
- Socket events are the primary data path for bots, players, markers, zones, routes, missions, commands, roles, and squads.
- Disconnecting the socket and reconnecting restores state within one poll cycle.
- No regressions in real-time position updates.

---

### Agent 1-3: Shared Selection State Across Pages

**Deliverable**: Bot selection (the `selectedBotIds` Set in `useControlStore`) is shared across the fleet page, map page, and dashboard, so selecting a bot on the map selects it on fleet and vice versa.

**Files touched**:
- `web/src/lib/store.ts` -- `useControlStore` (already has `selectedBotIds`)
- `web/src/app/map/page.tsx` -- wire map entity clicks to `useControlStore.toggleBotSelection`
- `web/src/app/fleet/page.tsx` -- already uses `useControlStore`
- `web/src/app/page.tsx` -- dashboard page, show selection badge on bot cards
- `web/src/components/BotCard.tsx` -- already reads `useControlStore.selectedBotIds`
- `web/src/components/map/MapEntitySidebar.tsx`

**Work**:
1. Map page currently has its own selection state for entities. Wire it to `useControlStore.selectedBotIds` so that clicking a bot on the map also selects it in fleet and dashboard.
2. On the dashboard page, if `selectedBotIds` is non-empty, show a selection indicator (count badge or highlight on BotCards).
3. Add a `selectedMapObject` sync: when a zone or marker is selected on the map, store it in `useWorldStore.selectedMapObject` (already exists there). Other pages that care can read it.
4. Ensure FleetSelectionBar reflects map-based selections.

**Acceptance criteria**:
- Selecting a bot on the map page highlights it on the fleet page (and vice versa) without page refresh.
- The dashboard shows which bots are currently selected.
- Selecting a bot on the fleet page and switching to map shows that bot highlighted.

---

### Agent 1-4: Role Policy Enforcement in Bot Behavior

**Deliverable**: Autonomy levels and interrupt policies actually govern bot behavior. The VoyagerLoop respects the role assignment.

**Files touched**:
- `src/control/RoleManager.ts` -- minor: expose a `shouldBotAcceptTask(botName)` helper
- `src/voyager/VoyagerLoop.ts` -- check role assignment before accepting player tasks
- `src/control/CommandCenter.ts` -- before dispatching commands, check interrupt policy
- `src/bot/BotInstance.ts` -- wire RoleManager reference

**Work**:
1. In VoyagerLoop, before executing a queued player task, check if the bot's role assignment has `autonomyLevel === 'manual'`. If so, reject autonomous task generation (but still allow explicit commands/missions from the dashboard).
2. In CommandCenter, before dispatching a command to a bot, check `interruptPolicy`. If `never-while-critical` and the bot is running a critical mission, reject the command with a clear error. If `confirm-if-busy` and the bot has an active mission, require a `force: true` flag or return a confirmation-needed response.
3. Implement a `shouldBotAcceptTask()` utility on RoleManager that checks autonomy level, override status, and interrupt policy, returning a verdict + reason.
4. Wire `loadoutPolicy` checking -- for now, just log a warning if a bot's inventory does not match its loadout policy (full enforcement is Sprint 2).

**Acceptance criteria**:
- A bot with `autonomyLevel: 'manual'` does not auto-generate tasks in its VoyagerLoop.
- A bot with `interruptPolicy: 'never-while-critical'` rejects non-urgent commands while running a mission.
- `shouldBotAcceptTask()` is callable and returns a structured verdict.
- Existing tests in `test/control/RoleManager.test.ts` still pass; new tests added for the enforcement logic.

---

### Agent 1-5: Override Visibility on Bot Detail and Bot Cards

**Deliverable**: Override info (from RoleManager) is visible on the bot detail page and bot cards, not just the `/roles` page.

**Files touched**:
- `web/src/components/BotCard.tsx` -- show override badge
- `web/src/app/bots/[name]/page.tsx` -- show override status section
- `web/src/lib/store.ts` -- `useRoleStore` already has `overrides`

**Work**:
1. In `BotCard.tsx`: read `useRoleStore.overrides` for the bot name. If an override exists, show a small "Override" badge with the reason text as a tooltip. Use the same style as the existing role badge.
2. In `bots/[name]/page.tsx`: add an "Override Status" card below the role assignment section. Show the override reason, command ID that triggered it, and time since override was set (with expiry countdown).
3. Also surface `blockedReason` from missions: if the bot has a running mission with a `blockedReason`, show it prominently on both the bot card (as a warning icon) and the bot detail page.

**Acceptance criteria**:
- BotCard shows an orange "Override" badge when the bot has an active override.
- Bot detail page shows override details with expiry countdown.
- `blockedReason` from active missions is shown on bot cards and bot detail.
- No change to the `/roles` page (it already shows overrides).

---

### Agent 1-6: Mission Queue UX Improvements

**Deliverable**: Complete the mission queue reorder/prepend/clear UI flows and add "Do now" vs "Do next" labeling.

**Files touched**:
- `web/src/components/MissionQueuePanel.tsx` -- add reorder drag, clear button, "Do now"/"Do next" labels
- `web/src/lib/api.ts` -- ensure `reorderBotMissionQueue`, `clearBotMissionQueue` API functions exist
- `src/server/api.ts` -- add/verify `PUT /api/bots/:name/mission-queue` for reorder and `DELETE` for clear
- `src/control/MissionManager.ts` -- `updateBotMissionQueue` already supports `reorder` and `clear` actions

**Work**:
1. MissionQueuePanel currently shows the queue but lacks reorder controls. Add drag-to-reorder (using a simple move-up/move-down button pair, or a drag handle). When reordered, call `api.reorderBotMissionQueue(botName, fromIndex, toIndex)`.
2. Add a "Clear Queue" button that calls `api.clearBotMissionQueue(botName)`.
3. Label the first mission in the queue as "Do now" (or "Running" if status is `running`). Label the second as "Do next". The rest are just numbered.
4. Add a "prepend" option: when creating a new mission for a bot, offer "Add to front" vs "Add to back" of the queue.
5. Verify API endpoints exist on the server for reorder and clear. If missing, add them using `missionManager.updateBotMissionQueue()`.

**Acceptance criteria**:
- User can reorder missions in the queue via UI controls.
- User can clear all queued missions for a bot.
- "Do now" and "Do next" labels appear on the first two queue items.
- Prepend option is available when creating missions from the bot detail page.

---

### Agent 1-7: History Page Integration -- Unified Command + Mission Records

**Deliverable**: The history page shows a single, merged timeline of commands and missions, filterable by bot, status, and type.

**Files touched**:
- `web/src/app/history/page.tsx` -- redesign to merge tabs or add unified view
- `web/src/lib/api.ts` -- ensure both command and mission fetching work with time-range filtering

**Work**:
1. History page currently has tabs for "commands" and "missions" shown separately. Add a "unified" (or "all") view that interleaves both record types sorted by timestamp.
2. Add bot filter dropdown (list of known bots).
3. Show `blockedReason` and `linkedCommandIds` prominently when present -- currently the detail view shows blockedReason but it is easy to miss.
4. For missions with `linkedCommandIds`, show a link to the associated command records.
5. Show commander history entries (from CommanderService) in the timeline as well, so users can see the NL input that generated a set of commands/missions.

**Acceptance criteria**:
- A single chronological timeline shows commands, missions, and commander plans interleaved.
- Clicking a commander plan shows the NL input, parsed intent, and resulting commands/missions.
- Bot filter works.
- `linkedCommandIds` are clickable links within the timeline.

---

### Agent 1-8: Commander Persistence and Draft Improvements

**Deliverable**: Commander history is persisted to disk (not in-memory only). Drafts are saved to a backend endpoint instead of localStorage only.

**Files touched**:
- `src/control/CommanderService.ts` -- add file-based persistence for history
- `src/server/api.ts` -- add `GET/POST /api/commander/drafts` endpoints
- `web/src/app/commander/page.tsx` -- use API for drafts instead of localStorage

**Work**:
1. CommanderService.history is capped at 100 entries in memory (line 96). Add `save()` / `load()` methods mirroring the pattern in RoleManager (debounced write to `data/commander-history.json`).
2. Add a `drafts` array to CommanderService for saved draft plans. Expose via API.
3. On the frontend commander page, switch from localStorage to the API for saving/loading drafts.
4. Add `shutdown()` method to flush on process exit.

**Acceptance criteria**:
- Commander history survives server restart (loaded from `data/commander-history.json`).
- Drafts are stored server-side and accessible from any browser.
- History is still capped at 100 entries.
- Existing CommanderService tests pass; new tests cover persistence.

---

### Agent 1-9: Shared Type Contracts Between Frontend and Backend

**Deliverable**: A shared types package or barrel file that the frontend API client and backend both import from, preventing drift.

**Files touched**:
- `src/control/FleetTypes.ts` -- already defines shared types
- `src/control/CommandTypes.ts` -- backend command types
- `src/control/MissionTypes.ts` -- backend mission types
- `src/control/WorldTypes.ts` -- backend world types
- `web/src/lib/api.ts` -- frontend type definitions (currently redefined, not imported)
- New file: `shared/types.ts` or a `src/control/index.ts` barrel that the frontend also imports via path alias

**Work**:
1. Create a `shared/` directory (or use the existing `src/control/index.ts` barrel) exporting all public types: MissionRecord, MissionType, MissionStatus, CommandRecord, CommandType, CommandStatus, SquadRecord, RoleAssignmentRecord, MarkerRecord, ZoneRecord, RouteRecord, CommanderPlan, etc.
2. Configure the frontend's tsconfig with a path alias (`@shared/*`) pointing to this shared directory.
3. Replace the manually-defined types in `web/src/lib/api.ts` with imports from the shared types.
4. Verify no type mismatches exist (the frontend's `CommandRecord.createdAt` uses `number` while the backend uses ISO string -- resolve this).

**Acceptance criteria**:
- Frontend and backend import mission, command, fleet, and world types from the same source files.
- No duplicate type definitions in `api.ts` (only API function definitions remain, types are imported).
- `tsc --noEmit` passes on both backend and frontend.

---

### Agent 1-10: `deposit_inventory` Command Implementation

**Deliverable**: The `deposit_inventory` command actually deposits items into the nearest chest, using the existing container action logic.

**Files touched**:
- `src/control/CommandCenter.ts` -- `handleDepositInventory` method (line 720)
- `src/actions/container.ts` -- has `inspectContainer` and container interaction logic, needs a `depositItems` export

**Work**:
1. In `container.ts`, add a `depositAllItems(bot, blockName?, position?)` function that opens the nearest chest and deposits all non-essential items (keeping tools and food).
2. In `CommandCenter.handleDepositInventory`, make it async. Use the MarkerStore to find the nearest `storage` marker. Call `depositAllItems` with that position.
3. If no storage marker exists, try to find the nearest chest block within 32 blocks.
4. Handle errors (no chest found, chest full, interrupted by mob).

**Acceptance criteria**:
- `deposit_inventory` command moves the bot to the nearest chest/storage marker and deposits items.
- Returns a result listing deposited items and counts.
- Errors produce clear `CommandError` objects.
- New test in `test/control/CommandCenter.test.ts` covers the happy path.

---

## SPRINT 2: Core Missing Features and UX

**Goal**: Build the major unbuilt features (routines/templates, map drawing tools, diagnostics, MissionComposer, CommandButtonGroup) and enhance commander UX.

**Dependencies from Sprint 1**: Store consolidation (1-1), socket-first updates (1-2), shared selection (1-3), shared types (1-9).

---

### Agent 2-1: Command Macros -- Record and Replay Sequences

**Deliverable**: Users can record a sequence of commands/missions, save it as a named macro, and replay it with one click.

**Files touched**:
- New file: `src/control/RoutineManager.ts` -- backend macro storage
- `src/server/api.ts` -- CRUD routes for routines (`/api/routines`)
- `src/control/index.ts` -- export RoutineManager
- New file: `web/src/app/routines/page.tsx` -- routines list/editor page
- `web/src/lib/api.ts` -- API functions for routines
- `web/src/lib/store.ts` -- add `useRoutineStore`
- `web/src/components/Sidebar.tsx` -- add "Routines" nav link

**Work**:
1. Define a `Routine` type: `{ id, name, description, steps: Array<{ type: 'command'|'mission', data: CreateCommandParams|CreateMissionParams }>, createdAt, updatedAt }`.
2. RoutineManager provides CRUD, persistence to `data/routines.json`, and an `execute(routineId, targetBotNames)` method that replays each step via CommandCenter/MissionManager.
3. API routes: GET/POST/PUT/DELETE `/api/routines`, POST `/api/routines/:id/execute`.
4. Frontend: routines page lists macros, allows editing steps, and has an "Execute" button with bot selector.
5. Add "Record" mode: when enabled, new commands/missions are captured into a draft routine.

**Acceptance criteria**:
- User can create a routine with 1+ steps.
- Executing a routine dispatches all steps in order.
- Routines persist across server restarts.
- "Record" mode captures commands as they are issued.

---

### Agent 2-2: Mission Templates and Preset Operations

**Deliverable**: Reusable mission templates (e.g., "Patrol the base perimeter", "Gather 64 iron ore") and preset squad operations.

**Files touched**:
- `src/control/RoutineManager.ts` (from Agent 2-1, or a separate `TemplateManager.ts`)
- `src/server/api.ts` -- template routes
- New file: `web/src/components/MissionComposer.tsx` -- the missing MissionComposer component
- `web/src/app/commander/page.tsx` -- integrate template picker
- `web/src/lib/api.ts`

**Work**:
1. Define `MissionTemplate` type: `{ id, name, description, missionType, defaultParams, requiredFields, suggestedBotCount }`.
2. Ship 5-8 built-in templates (patrol zone, gather items, craft batch, escort player, supply run, guard area, build schematic, resupply builder).
3. Build MissionComposer component: a form that lets users pick a template, fill in parameters, select assignees (bot or squad), set priority, and create the mission. This replaces the ad-hoc mission creation scattered across pages.
4. Integrate MissionComposer into the commander page as a "quick mission" panel.
5. Named loadouts: allow templates to reference a `loadoutPolicy` that specifies required items.

**Acceptance criteria**:
- MissionComposer is a standalone component usable from any page.
- At least 5 built-in templates are available.
- User can customize template parameters before creating a mission.
- Created missions flow through the existing MissionManager pipeline.

---

### Agent 2-3: Map Drag-to-Draw Zone Creation

**Deliverable**: Users can draw zones directly on the map canvas by click-and-drag.

**Files touched**:
- `web/src/app/map/page.tsx` -- add draw-zone interaction mode
- `web/src/components/map/mapDrawing.ts` -- already defines `MapMode` including `'draw-zone'`; implement the drawing logic
- `web/src/lib/store.ts` -- `useWorldStore.setDrawingMode` already exists
- `web/src/lib/api.ts` -- `api.createZone()` already exists

**Work**:
1. `mapDrawing.ts` already defines `MapMode = 'draw-zone'` but the actual drawing handler is not implemented. Implement mouse-down to start, mouse-move to show rectangle preview, mouse-up to finalize.
2. On finalize, open the existing ZoneEditor (map/page.tsx line 1513) pre-filled with the drawn rectangle coordinates.
3. Support circle zones: alt+drag draws a circle from center outward.
4. Show a semi-transparent overlay of the zone-in-progress while dragging.
5. Integrate with `useWorldStore.setDrawingMode('zone')` to enter/exit the mode.

**Acceptance criteria**:
- User clicks the zone tool in MapToolbar, then draws a rectangle on the map.
- Rectangle preview appears during drag.
- On mouse-up, ZoneEditor opens pre-filled with coordinates.
- Saving the zone creates it via API and it appears on the map immediately (via socket event).

---

### Agent 2-4: Route Waypoint Drawing Tool

**Deliverable**: Users can draw route waypoints on the map by clicking successive points.

**Files touched**:
- `web/src/app/map/page.tsx` -- add draw-route mode
- `web/src/components/map/mapDrawing.ts` -- implement route drawing
- `web/src/components/map/MapToolbar.tsx` -- add route tool button
- `web/src/lib/api.ts` -- `api.createRoute()` exists

**Work**:
1. Add `'draw-route'` mode handling (already in the MapMode type). When active, each click on the map adds a waypoint marker at that position.
2. Draw lines between waypoints as they are placed.
3. Double-click or press Enter to finalize the route. Open a route name/description dialog.
4. Each waypoint is auto-created as a marker of kind `'custom'` (or a new `'waypoint'` kind), then the route references their IDs.
5. Show undo (remove last waypoint) while drawing.

**Acceptance criteria**:
- User can place 2+ waypoints by clicking on the map.
- Lines connect waypoints during drawing.
- Finalizing creates the route and all waypoint markers via API.
- Route appears on map immediately via socket event.

---

### Agent 2-5: Map-Based Mission Assignment

**Deliverable**: Clicking a bot, zone, or marker on the map can directly create a mission assignment.

**Files touched**:
- `web/src/components/map/MapContextMenu.tsx` -- add "Assign Mission" option
- `web/src/components/map/MapEntitySidebar.tsx` -- add mission quick-assign
- `web/src/app/map/page.tsx` -- wire context menu actions
- `web/src/components/MissionComposer.tsx` (from Agent 2-2)

**Work**:
1. In MapContextMenu, add options: "Send selected bots here" (creates walk_to_coords command), "Guard this zone" (creates patrol_zone mission), "Patrol this route" (creates patrol_route command).
2. In MapEntitySidebar, when a zone is selected, show a "Create Mission" button that opens MissionComposer pre-filled with the zone context.
3. When a bot is right-clicked on the map, show context menu with "Assign to zone", "Patrol route", "Return to base".
4. Squad/mission overlays: show colored zone overlays for zones that have active missions, and show mission assignee icons on the map near their assigned zones.

**Acceptance criteria**:
- Right-clicking a zone on the map shows "Guard Zone" and "Create Mission" options.
- Right-clicking a bot shows contextual command options.
- "Send here" creates a walk_to_coords command for all selected bots.
- Active mission zones have colored overlays on the map.

---

### Agent 2-6: Bot Diagnostic Panel -- "Why Is This Bot Stuck?"

**Deliverable**: A diagnostic panel on the bot detail page that analyzes why a bot might be stuck and suggests recovery actions.

**Files touched**:
- New file: `web/src/components/DiagnosticPanel.tsx`
- `web/src/app/bots/[name]/page.tsx` -- add DiagnosticPanel
- `src/server/api.ts` -- add `GET /api/bots/:name/diagnostics` endpoint
- `src/control/CommandCenter.ts` -- add `getDiagnostics(botName)` method
- `src/control/MissionManager.ts` -- expose stale mission info per bot

**Work**:
1. Backend: `GET /api/bots/:name/diagnostics` returns a structured diagnostic report:
   - Is the bot connected? What is its state?
   - Does it have an active mission? Is the mission stale (> 30 min)?
   - What is the `blockedReason` if any?
   - Is there an active override?
   - Last command status and error.
   - Is the VoyagerLoop paused? Why?
   - Recent failed tasks from VoyagerLoop.
2. Frontend: DiagnosticPanel renders this report with clear icons (green check, yellow warning, red X) for each diagnostic check.
3. Suggest recovery actions: "Run unstuck command", "Cancel stale mission", "Clear override", "Resume voyager".
4. Each suggestion is a clickable button that executes the recovery action.

**Acceptance criteria**:
- DiagnosticPanel shows on bot detail page.
- Each diagnostic check has a clear status indicator.
- Recovery action buttons work (they call the appropriate API).
- If the bot is healthy, the panel shows all green.

---

### Agent 2-7: Bot Diagnostic Timeline View

**Deliverable**: A timeline visualization showing a bot's state transitions, commands, and missions over time.

**Files touched**:
- New file: `web/src/components/DiagnosticTimeline.tsx`
- `web/src/app/bots/[name]/page.tsx` -- add timeline tab
- `web/src/lib/api.ts` -- timeline data fetching

**Work**:
1. Fetch the bot's command history, mission history, and activity events in a single API call (or parallel calls).
2. Render a vertical timeline (newest at top) showing:
   - State changes (from activity events)
   - Commands dispatched and their results
   - Missions created, started, completed/failed
   - Override set/cleared events
3. Color-code by event type. Show relative timestamps.
4. Allow filtering by time range (last hour, last 24h, all).
5. Clicking a timeline event expands to show details.

**Acceptance criteria**:
- Timeline shows at least state changes, commands, and missions for a bot.
- Events are correctly ordered by timestamp.
- Filtering by time range works.
- Clicking an event shows its details.

---

### Agent 2-8: CommandButtonGroup Component

**Deliverable**: A reusable `CommandButtonGroup` component that provides a standard action button bar for commanding bots.

**Files touched**:
- New file: `web/src/components/CommandButtonGroup.tsx`
- `web/src/app/fleet/page.tsx` -- use CommandButtonGroup
- `web/src/app/bots/[name]/page.tsx` -- use CommandButtonGroup
- `web/src/components/BotCommandCenter.tsx` -- refactor to use CommandButtonGroup
- `web/src/components/FleetSelectionBar.tsx` -- refactor to use CommandButtonGroup

**Work**:
1. Extract the common command buttons (Pause, Resume, Stop, Follow, Return to Base, Unstuck, Equip Best) into a single reusable component.
2. Props: `targetBotNames: string[]`, `variant: 'compact' | 'full'`, `disabled: boolean`.
3. Each button calls the appropriate `api.createCommand()` and `api.dispatchCommand()`.
4. Show loading state per button while command is in flight.
5. Show success/error toast on completion.
6. Replace duplicated button bars in BotCommandCenter, FleetSelectionBar, and fleet page.

**Acceptance criteria**:
- CommandButtonGroup is used in at least 3 places.
- All command buttons work for single-bot and multi-bot (selection) targets.
- Loading and error states display correctly.
- No duplicate command button implementations remain.

---

### Agent 2-9: Commander Disambiguation and Clarification Flow

**Deliverable**: When the commander parses an ambiguous NL input, it asks the user for clarification instead of just setting low confidence.

**Files touched**:
- `src/control/CommanderService.ts` -- add clarification request logic
- `web/src/app/commander/page.tsx` -- add clarification UI
- `web/src/components/CommanderPanel.tsx` -- extend to show clarification questions

**Work**:
1. When confidence < 0.5 or there are warnings, the CommanderService generates clarification questions (e.g., "Did you mean bot X or bot Y?", "Which zone should they guard?").
2. Add a `clarificationQuestions` field to CommanderPlan.
3. Frontend: if clarification questions exist, show them as selectable options (radio buttons or chips).
4. User's clarification response is appended to the original input and re-parsed.
5. Add "suggested commands" -- when the input is empty or vague, show a list of example commands the user can click to populate.

**Acceptance criteria**:
- Ambiguous inputs show clarification questions.
- User can select answers and re-submit.
- Suggested commands appear when the input is empty.
- Re-parsed plans have higher confidence after clarification.

---

### Agent 2-10: Commander Templates and Suggested Routines

**Deliverable**: The commander page offers pre-built command templates and suggests routines based on context.

**Files touched**:
- `web/src/app/commander/page.tsx` -- add template sidebar/picker
- `src/control/CommanderService.ts` -- add template matching logic
- `web/src/lib/api.ts` -- API for templates

**Work**:
1. Define 10-15 command templates as structured NL examples: "Send all guards to the base", "Have {bot} gather 64 iron ore", "Pause all bots", "Start mining operation at {zone}", etc.
2. Show templates in a sidebar on the commander page. Clicking one populates the input with the template text, with placeholders highlighted for editing.
3. Context-aware suggestions: based on current bot states and role assignments, suggest relevant templates (e.g., if bots are idle, suggest "Start patrol").
4. Integrate with routines from Agent 2-1: saved routines appear as executable templates.

**Acceptance criteria**:
- Template sidebar shows categorized templates.
- Clicking a template fills the commander input.
- Context-aware suggestions appear based on bot state.
- Saved routines appear alongside built-in templates.

---

## SPRINT 3: Polish, Testing, Telemetry, and Stale Cleanup

**Goal**: Comprehensive testing, metrics dashboards, cleanup of stale/unused code, and final polish.

**Dependencies from Sprint 2**: MissionComposer (2-2), DiagnosticPanel (2-6), CommandButtonGroup (2-8), RoutineManager (2-1).

---

### Agent 3-1: Frontend Component Test Suite

**Deliverable**: Component tests for all major components (currently only 2 tests exist).

**Files touched**:
- `web/__tests__/components/` -- new test files
- Tests for: BotCard, MissionQueuePanel, FleetSelectionBar, RoleAssignmentPanel, CommandButtonGroup, CommandHistoryPanel, DiagnosticPanel, MissionComposer, SocketProvider

**Work**:
1. For each component, write tests covering: rendering with typical data, empty state, loading state, user interactions (clicks, form submissions), error states.
2. Mock the Zustand stores and API calls.
3. Use Vitest + React Testing Library (matching existing test setup).
4. Target at least 10 new component test files.

**Acceptance criteria**:
- At least 12 component test files total (2 existing + 10 new).
- All tests pass.
- Each test covers rendering + at least one interaction.
- Mock patterns are consistent across all tests.

---

### Agent 3-2: End-to-End Test Suite

**Deliverable**: E2E tests covering critical user flows.

**Files touched**:
- New directory: `e2e/` or `test/e2e/`
- Test files for: dashboard load, fleet management, mission creation, commander flow, map interactions

**Work**:
1. Set up Playwright or Cypress (choose based on project preferences -- check if any config exists).
2. Write E2E tests:
   - Dashboard loads and shows bot cards
   - Fleet page: create squad, add bots, execute command
   - Commander: type NL input, review plan, execute
   - Mission: create mission via MissionComposer, see it appear in queue
   - Map: place marker, create zone
3. Mock the backend API with fixtures for deterministic tests.
4. Add CI configuration (if applicable).

**Acceptance criteria**:
- At least 5 E2E test scenarios pass.
- Tests can run headlessly.
- Tests are deterministic (no flaky timing issues).

---

### Agent 3-3: Cross-Feature Integration Tests

**Deliverable**: Backend integration tests covering fleet + role + mission interactions.

**Files touched**:
- `test/control/integration.test.ts` -- expand existing
- New test files as needed in `test/control/`

**Work**:
1. Existing `integration.test.ts` covers some flows. Add tests for:
   - Role assignment triggers automatic mission generation (assisted mode with approval, autonomous mode with direct creation).
   - Override prevents mission generation; clearing override resumes it.
   - Interrupt policy enforcement: command rejected when bot has critical mission.
   - Commander parse + execute end-to-end (mocked LLM).
   - Routine execution: create routine, execute, verify commands/missions created.
   - Mission queue reorder/clear operations.
2. Test data fixtures shared across test files.

**Acceptance criteria**:
- At least 15 new integration test cases.
- All tests pass.
- Tests cover cross-manager interactions (RoleManager + MissionManager, CommandCenter + MissionManager, CommanderService + both).

---

### Agent 3-4: Visual Metrics Dashboard

**Deliverable**: A `/metrics` page in the frontend showing health, command, and mission metrics.

**Files touched**:
- New file: `web/src/app/metrics/page.tsx`
- `web/src/components/Sidebar.tsx` -- add nav link
- `web/src/lib/api.ts` -- `api.getMetrics()` function
- `src/server/api.ts` -- expand `/api/metrics` to include commander and fleet metrics

**Work**:
1. Expand the backend `/api/metrics` endpoint to include:
   - Command metrics (already returned by `commandCenter.getMetrics()`)
   - Mission metrics (already returned by `missionManager.getMetrics()`)
   - Commander metrics: total parses, avg confidence, execute count, failure rate
   - Fleet metrics: bots by role, override rates, active squads, automation generation count
2. Frontend: build a metrics page with cards/charts showing:
   - Command success/failure rates (bar chart or donut)
   - Mission completion rates by type
   - Bot activity breakdown (missions per bot)
   - Commander confidence distribution
   - Active vs idle bot count over time (if we add time-series later, show current snapshot for now)
3. Auto-refresh metrics every 30s.

**Acceptance criteria**:
- `/metrics` page loads and shows data from the metrics API.
- Command and mission metrics are visualized.
- Commander and fleet metrics are included.
- Page auto-refreshes.

---

### Agent 3-5: Commander Metrics Tracking

**Deliverable**: CommanderService tracks per-parse and per-execute metrics.

**Files touched**:
- `src/control/CommanderService.ts` -- add `getMetrics()` method
- `src/server/api.ts` -- include commander metrics in `/api/metrics`

**Work**:
1. Track: total parses, successful parses (confidence > 0.5), failed parses, total executions, partial failures, average confidence, most-used command types, most-used mission types.
2. Add `getMetrics()` method to CommanderService.
3. Wire into the `/api/metrics` response.
4. Add test for metrics tracking.

**Acceptance criteria**:
- `commanderService.getMetrics()` returns structured metrics.
- `/api/metrics` includes commander metrics.
- Metrics are accurate after a series of parse/execute calls.

---

### Agent 3-6: Fleet Metrics -- Override Rates and Squad Activity

**Deliverable**: Track and expose fleet-level metrics.

**Files touched**:
- `src/control/RoleManager.ts` -- add `getMetrics()` method
- `src/control/SquadManager.ts` -- add `getMetrics()` method
- `src/server/api.ts` -- include in `/api/metrics`

**Work**:
1. RoleManager metrics: total assignments by role, autonomy level distribution, override count and average duration, approval request counts by status, automation generation count.
2. SquadManager metrics: total squads, average squad size, squads with active missions.
3. Add `getMetrics()` to both managers.
4. Wire into `/api/metrics`.

**Acceptance criteria**:
- Both managers expose metrics.
- `/api/metrics` includes fleet metrics.
- Metrics are tested.

---

### Agent 3-7: Stale Code Cleanup -- `activeMissionId`, `cooperation`/`help_request`, `getUnread()`

**Deliverable**: Clean up unused/stale code identified in the remaining work document.

**Files touched**:
- `src/control/FleetTypes.ts` -- evaluate `activeMissionId` usage
- `src/server/api.ts` -- line 938 sets `activeMissionId`
- `src/social/BotComms.ts` -- `getUnread()` at line 51
- `src/personality/AffinityManager.ts` -- `cooperation`/`help_request` references

**Work**:
1. `activeMissionId` on squads: it is set in api.ts but never read by the frontend. Either wire it into the fleet page (show "Active Mission: X" on each squad card) or remove it. Recommendation: wire it up -- it is useful information.
2. `cooperation` and `help_request` socket events: find where these are emitted (if anywhere). If they are emitted but not recorded in EventLog, add recording. If never emitted, document them as future-use and add TODO comments.
3. `getUnread()` in BotComms: determine if bot-to-bot communication uses this. If it does, wire it into the coordination page. If not, add a comment documenting its intended use.
4. Remove any truly dead code. Add TODO comments for planned-but-unbuilt features.

**Acceptance criteria**:
- `activeMissionId` is either used in the frontend or removed from the type.
- `cooperation`/`help_request` have clear documentation or are wired up.
- `getUnread()` is either used or documented.
- No dead code paths remain without documentation.

---

### Agent 3-8: Retry/Recovery Suggestions UI

**Deliverable**: When a mission fails, the UI offers specific recovery suggestions and retry options.

**Files touched**:
- `web/src/components/MissionQueuePanel.tsx` -- add retry/recovery UI
- `web/src/app/history/page.tsx` -- add retry option on failed missions
- `web/src/components/DiagnosticPanel.tsx` (from Sprint 2) -- integrate

**Work**:
1. When a mission is in `failed` status, show a "Retry" button (calls `api.retryMission(id)` -- backend already has `retryMission()`).
2. Analyze the failure reason and suggest fixes:
   - "Bot not found" -> "Bot may have disconnected. Reconnect and retry."
   - "Task failed" -> "Consider running unstuck command first, then retry."
   - "Stale - running for over 30 minutes" -> "Mission may be stuck. Cancel and create a new one."
3. Show suggestions as actionable cards below the failed mission.
4. Link to the DiagnosticPanel for deeper investigation.

**Acceptance criteria**:
- Failed missions show a "Retry" button.
- At least 3 failure-specific recovery suggestions exist.
- Recovery action buttons are functional.
- Link to DiagnosticPanel works.

---

### Agent 3-9: Map Squad/Mission Overlays

**Deliverable**: The map shows which squads are operating in which zones and where active missions are taking place.

**Files touched**:
- `web/src/app/map/page.tsx` -- add overlay rendering
- `web/src/components/map/mapDrawing.ts` -- add overlay drawing functions
- `web/src/lib/store.ts` -- read mission and squad data for overlays

**Work**:
1. For each active mission that references a zone (via `patrol_zone` type or step payload with `zoneId`), draw a colored overlay on that zone with the mission status color.
2. For each squad with assigned bots, draw a convex hull or bounding box around the squad's bot positions, labeled with the squad name.
3. Show mission assignee bot names near their assigned zones.
4. Add toggle controls in MapToolbar: "Show missions", "Show squads".
5. Overlay transparency so the base map remains visible.

**Acceptance criteria**:
- Active patrol missions show colored zone overlays.
- Squad groupings are visible on the map.
- Overlays can be toggled on/off.
- Overlays update in real-time via socket events.

---

### Agent 3-10: Final Polish -- Sidebar Nav, Tooltips, Loading States

**Deliverable**: Consistent UX polish across all pages.

**Files touched**:
- `web/src/components/Sidebar.tsx` -- add links for new pages (routines, metrics)
- `web/src/app/page.tsx` -- dashboard polish
- Multiple page files -- add loading skeletons, empty states, error boundaries
- `web/src/components/Toast.tsx` -- ensure all user actions show toast feedback

**Work**:
1. Sidebar: add nav links for Routines and Metrics pages. Ensure all pages have consistent nav highlighting.
2. Loading states: every page that fetches data should show a skeleton loader, not a blank page. Audit all pages.
3. Empty states: when there are no bots, squads, missions, etc., show helpful empty state messages with CTAs ("No squads yet. Create one.").
4. Error boundaries: wrap each page in an error boundary that shows a friendly error message.
5. Tooltips: add tooltips to all icon-only buttons (CommandButtonGroup, MapToolbar, etc.).
6. Consistent toast feedback: every mutation action (create, update, delete) shows a success/error toast.

**Acceptance criteria**:
- All new pages (routines, metrics) are in the sidebar.
- Every page has a loading state, empty state, and error handling.
- All icon buttons have tooltips.
- All mutations show toast feedback.

---

## Sprint Dependency Summary

```
Sprint 1 (foundations):
  1-1 Store Consolidation ──────────────────────┐
  1-2 Socket-First Updates ─────────────────────┤
  1-3 Shared Selection ────────────────────────┤── Sprint 2 depends on these
  1-9 Shared Types ─────────────────────────────┤
  1-4 Role Policy Enforcement ──────────────────┤
  1-5 Override Visibility ──────────────────────┤
  1-6 Mission Queue UX ────────────────────────┤
  1-7 History Integration ──────────────────────┤
  1-8 Commander Persistence ────────────────────┤
  1-10 deposit_inventory ───────────────────────┘ (independent)

Sprint 2 (features):
  2-1 Command Macros ───────────────────────────┐
  2-2 MissionComposer + Templates ──────────────┤── Sprint 3 depends on these
  2-3 Zone Drawing ─────────────────────────────┤
  2-4 Route Drawing ────────────────────────────┤
  2-5 Map Mission Assignment (needs 2-2) ───────┤
  2-6 Diagnostic Panel ─────────────────────────┤
  2-7 Diagnostic Timeline ──────────────────────┤
  2-8 CommandButtonGroup ───────────────────────┤
  2-9 Commander Disambiguation ─────────────────┤
  2-10 Commander Templates (needs 2-1) ─────────┘

Sprint 3 (polish):
  3-1 Component Tests (needs 2-8, 2-6, 2-2)
  3-2 E2E Tests
  3-3 Integration Tests (needs 2-1)
  3-4 Metrics Dashboard (needs 3-5, 3-6)
  3-5 Commander Metrics
  3-6 Fleet Metrics
  3-7 Stale Cleanup
  3-8 Recovery UI (needs 2-6)
  3-9 Map Overlays (needs 2-3, 2-4)
  3-10 Final Polish
```
