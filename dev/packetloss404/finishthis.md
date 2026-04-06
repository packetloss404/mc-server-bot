# DyoBot -- Finish This

**Last updated:** 2026-04-05
**Maintainer:** packetloss404
**Status:** Pre-release. Core loop works (spawn bots, voyager tasks, skills). Control platform, fleet management, build system, and supply chains are coded but not wired into the runtime.

---

## How to Read This Document

Each item has:
- **ID** for cross-referencing (e.g. C-1, H-3)
- **Title** and description of what is wrong / missing
- **Files** involved (relative to repo root)
- **Size** estimate: S (<2h), M (2-6h), L (6-16h), XL (16h+)
- **Depends on** other item IDs that must land first or simultaneously
- **Blocks** which downstream items cannot start until this lands

---

## CRITICAL -- System-Breaking

These items represent entire subsystems that are coded but never instantiated, or data-integrity bugs that cause silent corruption. Nothing in the control platform works until C-1 and C-2 land.

---

### C-1: Wire Control Platform into Runtime

**Size: XL**
**Depends on:** nothing
**Blocks:** C-5, H-1, H-2, H-3, H-4, H-6, M-1, M-3, M-4, M-5, M-8

**Problem:**
`CommandCenter`, `MissionManager`, `MarkerStore`, `SquadManager`, and `RoleManager` are fully implemented classes in `src/control/` but are never instantiated anywhere. Neither `src/index.ts` nor `src/server/api.ts` imports or creates them. The ~35 API routes documented in CLAUDE.md (`POST/GET /api/commands`, `/api/missions`, `/api/markers`, `/api/zones`, `/api/routes`, `/api/squads`, `/api/roles/*`, bot override endpoints) do not exist in the running server.

**What to do:**
1. In `createAPIServer()` (or `index.ts`), instantiate:
   - `MarkerStore(io)` -- no other deps
   - `SquadManager(io)` -- no other deps
   - `RoleManager(io)` -- no other deps
   - `CommandCenter(botManager, io, markerStore, roleManager)` -- needs marker + role
   - `MissionManager(botManager, io, commandCenter, squadManager)` -- needs command center + squad
2. Register all CRUD routes for commands, missions, markers, zones, routes, squads, roles, and bot overrides in `api.ts`.
3. Wire `commandCenter` and `missionManager` into the `CommanderService` so `execute()` can actually dispatch.
4. Add all five managers to the shutdown handler so their debounced writes flush on exit.
5. Emit socket events from each manager (they already call `io.emit` internally -- just need to be constructed with a live `io` reference).

**Files:**
- `src/index.ts` -- instantiate managers, pass to createAPIServer
- `src/server/api.ts` -- add ~35 route handlers
- `src/control/CommandCenter.ts` -- already implemented
- `src/control/MissionManager.ts` -- already implemented
- `src/control/MarkerStore.ts` -- already implemented
- `src/control/SquadManager.ts` -- already implemented
- `src/control/RoleManager.ts` -- already implemented

---

### C-2: Wire Build and Supply Chain Coordinators

**Size: L**
**Depends on:** nothing (can run in parallel with C-1)
**Blocks:** M-6, M-7

**Problem:**
`BuildCoordinator` (`src/build/BuildCoordinator.ts`) and `ChainCoordinator` (`src/supplychain/ChainCoordinator.ts`) are fully implemented but never instantiated. No API routes exist for build jobs, schematics, supply chains, or terrain scanning.

**What to do:**
1. Instantiate `BuildCoordinator(botManager, io, eventLog)` and `ChainCoordinator(botManager, io, eventLog)` in `createAPIServer()` or `index.ts`.
2. Register routes:
   - `GET/POST /api/build/jobs`, `GET/PATCH/DELETE /api/build/jobs/:id`, `POST /api/build/jobs/:id/pause|resume|cancel`
   - `GET /api/build/schematics`
   - `GET/POST /api/chains`, `GET/PATCH/DELETE /api/chains/:id`, `POST /api/chains/:id/start|pause|cancel`
3. Add to shutdown handler.

**Files:**
- `src/build/BuildCoordinator.ts`
- `src/supplychain/ChainCoordinator.ts`
- `src/server/api.ts`
- `src/index.ts`

---

### C-3: Fix Dual Store Bug (Frontend)

**Size: M**
**Depends on:** nothing
**Blocks:** M-3, M-4, M-5

**Problem:**
The frontend has two competing store systems:
- `web/src/lib/store.ts` -- main `useBotStore` with markers/zones/routes/commands/missions baked in
- `web/src/lib/controlStores.ts` -- separate `useControlStore`, `useMissionStore`, `useWorldStore` with different type definitions

`SocketProvider` and individual pages import from different stores. When a socket event arrives, it may update `controlStores` while the UI reads from `store.ts` (or vice versa), causing stale/missing data.

**What to do:**
1. Decide on a single source of truth per entity (commands, missions, markers, zones, routes).
2. Either merge `controlStores.ts` into `store.ts` or have `store.ts` delegate to `controlStores.ts`.
3. Update all page components and `SocketProvider` to import from the single store.
4. Delete the dead store file or add a re-export shim.

**Files:**
- `web/src/lib/store.ts`
- `web/src/lib/controlStores.ts`
- `web/src/components/SocketProvider.tsx`
- All pages in `web/src/app/` that import either store

---

### C-4: Fix Frontend/Backend Type Mismatches

**Size: L**
**Depends on:** C-1, C-3
**Blocks:** H-2, M-3, M-4, M-5

**Problem:**
Frontend and backend type definitions for the same entities are structurally incompatible:

| Entity | Backend (src/control/) | Frontend (controlStores.ts) | Mismatch |
|--------|----------------------|---------------------------|----------|
| Marker | flat `position: {x,y,z}`, has `kind`, `tags`, `notes` | nested `position: {x,y,z}` (OK), missing `kind`/`tags`/`notes` | Missing fields |
| Zone | `shape: 'circle'|'rectangle'`, `circle?: {...}`, `rectangle?: {minX,minZ,maxX,maxZ}` | `bounds: Record<string,any>` | Completely different shape model |
| Route | `waypointIds: string[]`, `loop: boolean` | `waypoints: {x,y,z}[]` (inline coords, no loop) | IDs vs inline, missing loop |
| Command | `targets: string[]`, status `succeeded` | `botName: string`, status includes `succeeded` (OK) | targets vs botName |
| Mission | `assigneeIds: string[]`, status `running` | `botName: string`, no `running` status | assigneeIds vs botName |

**What to do:**
1. Create a shared `types/` directory or align FE types to match BE exactly.
2. Update all FE components that render these entities.
3. Add adapter functions if backwards compat is needed for existing persisted data.

**Files:**
- `src/control/CommandTypes.ts`, `MissionTypes.ts`, `WorldTypes.ts`, `FleetTypes.ts`
- `web/src/lib/controlStores.ts`
- `web/src/lib/api.ts`
- All pages consuming these types

---

### C-5: Fix CommanderService (parse and execute)

**Size: L**
**Depends on:** C-1
**Blocks:** M-5

**Problem:**
`CommanderService.parse()` uses regex pattern matching to turn natural language into plans. It does not call the LLM even though it accepts an `llmClient` parameter. The `execute()` method creates history entries but does not actually dispatch commands or missions to `CommandCenter`/`MissionManager` because those instances are never passed to it.

**What to do:**
1. Pass `CommandCenter` and `MissionManager` references to `CommanderService` (after C-1 wires them up).
2. In `execute()`, iterate `plan.commands` and call `commandCenter.create()` for each; iterate `plan.missions` and call `missionManager.create()` for each.
3. Optionally upgrade `parse()` to use the LLM for better intent extraction (the regex fallback can remain as offline mode).
4. Wire the `llmClient` from `index.ts` into `commanderService` (currently `llmClient: null` on line 68 of `api.ts`).

**Files:**
- `src/control/CommanderService.ts`
- `src/server/api.ts` (line 67-69, llmClient wiring)
- `src/index.ts`

---

### C-6: Fix Shutdown Handler

**Size: S**
**Depends on:** C-1, C-2
**Blocks:** nothing

**Problem:**
The shutdown handler in `index.ts` (line 149-159) only calls `eventLog.shutdown()` and `botManager.removeAllBots()`. It does not flush:
- `CommandCenter` debounced persist
- `MissionManager` debounced save
- `MarkerStore` debounced save (3 files: markers, zones, routes)
- `SquadManager` debounced save
- `RoleManager` debounced save
- `BuildCoordinator` debounced save
- `ChainCoordinator` debounced save
- `RoutineManager` debounced save
- `AffinityManager`, `SocialMemory`, `BlackboardManager` (already have flush methods but not called)

Data written in the last 1-2 seconds before shutdown is silently lost.

**What to do:**
1. After C-1 and C-2 land, call `flush()` or `shutdown()` on every manager before `process.exit(0)`.
2. Add `flush()` methods where missing.

**Files:**
- `src/index.ts`
- All manager classes listed above

---

### C-7: Fix CLAUDE.md API Documentation

**Size: S**
**Depends on:** C-1, C-2
**Blocks:** nothing

**Problem:**
`CLAUDE.md` documents ~35 control platform routes that do not exist yet, and omits ~40 routes that do exist (commander, routines, templates, diagnostics, metrics, swarm, chat, task, mission-queue, etc.).

**What to do:**
1. After C-1 and C-2 land, audit every `app.get/post/put/patch/delete` in `api.ts`.
2. Rewrite the API section to list every real endpoint with method, path, and one-line description.

**Files:**
- `CLAUDE.md`

---

## HIGH -- Feature-Breaking

These items prevent specific features from working correctly even after the Critical tier lands.

---

### H-1: Wire Social System into Voyager Loop

**Size: L**
**Depends on:** nothing (independent of control platform)
**Blocks:** nothing

**Problem:**
The social system (`src/social/SocialMemory.ts`, `src/social/BotComms.ts`, `src/personality/`) has memory storage, emotional state tracking, and bot-to-bot communication. However:
- `socialContext` is built in `personality.ts` prompts but never populated from `SocialMemory`.
- `addMemory()` and `updateEmotionalState()` exist but are never called from game events.
- `BotComms` is not wired into the `VoyagerLoop` or `BotInstance`.
- `NEGATIVE_WORDS` array for sentiment analysis is empty.
- `entityHurt` event handler references `onHit` which may not exist.
- `isHostile()` affinity check is defined but never called before combat decisions.

**What to do:**
1. In bot worker thread, call `socialMemory.addMemory()` on chat, trade, combat events.
2. Pass `socialContext` from `SocialMemory.getContextFor(botName, targetName)` into `buildSystemPrompt()`.
3. Wire `BotComms` so bots can message each other and store conversation history.
4. Populate `NEGATIVE_WORDS` with a reasonable word list.
5. Fix `entityHurt` handler to use the correct event signature.
6. Call `isHostile()` before attacking mobs/players.

**Files:**
- `src/social/SocialMemory.ts`
- `src/social/BotComms.ts`
- `src/personality/` (all files)
- `src/ai/prompts/personality.ts`
- `src/bot/BotInstance.ts` or worker thread entry
- `src/voyager/VoyagerLoop.ts`

---

### H-2: Wire Map Features (Zones, Routes, Overlays)

**Size: L**
**Depends on:** C-1 (MarkerStore must be live), C-4 (types must match)
**Blocks:** nothing

**Problem:**
The map page has components for drawing zones and routes, and overlay types for missions/squads, but none of it is connected:
- Zone drawing mode creates `DrawnZone` objects but never POSTs to `/api/zones`.
- Route drawing mode is not integrated.
- Mission/squad overlays are defined as types but never rendered on the canvas.
- Coordinate utilities may have Y-axis issues (Minecraft Y is height, map renders X/Z).

**What to do:**
1. Connect zone drawing submit to `POST /api/zones` (requires C-1).
2. Connect route drawing submit to `POST /api/routes`.
3. Fetch and render existing zones/markers/routes on map canvas.
4. Add mission/squad overlay rendering (show bot positions grouped by squad, mission areas).
5. Fix coordinate mapping between map canvas and Minecraft world coords.

**Files:**
- `web/src/app/map/page.tsx`
- `web/src/components/map/` (all files)
- `web/src/lib/api.ts` (add zone/route API calls)
- `web/src/lib/store.ts` or `controlStores.ts`

---

### H-3: Fix Socket Event Payloads

**Size: M**
**Depends on:** C-1 (managers must be live to emit events)
**Blocks:** nothing

**Problem:**
Several socket event payloads from the backend do not match what the frontend expects:
- `squad:updated` -- manager emits the full squads array; frontend expects a single `SquadRecord`.
- `role:updated` -- manager emits a compound `{ assignment, approvals }` object; frontend expects a flat `RoleAssignmentRecord`.
- `build:progress` / `chain:stage` events use `chainId` not `id` as the key.
- `command:queued/started/succeeded/failed` events are missing `createdAt` field.
- No socket event is emitted for marker/zone/route changes (the constants are defined but not used until managers are live).

**What to do:**
1. After C-1 lands, audit every `io.emit()` call in each manager.
2. Standardize: each event emits the single changed record, not the full collection.
3. Ensure all timestamp fields are present.
4. Update `SocketProvider.tsx` handlers to match.

**Files:**
- `src/control/SquadManager.ts`
- `src/control/RoleManager.ts`
- `src/build/BuildCoordinator.ts`
- `src/supplychain/ChainCoordinator.ts`
- `src/control/CommandCenter.ts`
- `web/src/components/SocketProvider.tsx`

---

### H-4: Fix Socket Reconnection State Sync

**Size: M**
**Depends on:** C-1
**Blocks:** nothing

**Problem:**
When the WebSocket reconnects after a disconnect, the frontend needs to re-fetch all state (bots, commands, missions, markers, zones, routes, squads, roles). Currently the `SocketProvider` reconnection handler does nothing -- the UI shows stale data until a full page refresh.

**What to do:**
1. In `SocketProvider.tsx`, on `connect` event (after initial or reconnect), fetch all state:
   - `GET /api/bots`
   - `GET /api/commands` (after C-1)
   - `GET /api/missions` (after C-1)
   - `GET /api/markers` (after C-1)
   - `GET /api/zones` (after C-1)
   - `GET /api/routes` (after C-1)
   - `GET /api/squads` (after C-1)
   - `GET /api/roles/assignments` (after C-1)
2. Push fetched data into stores.

**Files:**
- `web/src/components/SocketProvider.tsx`
- `web/src/lib/api.ts`

---

### H-5: Fix Event Listener Leaks in Actions

**Size: M**
**Depends on:** nothing
**Blocks:** nothing

**Problem:**
Multiple action files attach `bot.on(...)` listeners for pathfinding/movement events (`goal_reached`, `path_update`, `goal_cancelled`) but do not reliably remove them on error, timeout, or early return. Over time this causes listener accumulation and erratic behavior.

Affected actions: `placeBlock`, `giveItem`, `buildSchematic`, `wander`, `walkTo`, `followPlayer`, plus `CodeExecutor` moveTo.

**What to do:**
1. Create a shared `moveNearWithCleanup(bot, goal, range, timeoutMs)` helper in `src/actions/` that:
   - Attaches `goal_reached` and `path_update` listeners.
   - Returns a promise.
   - Always removes listeners in `finally` block.
   - Has a timeout.
2. Replace all manual movement listener patterns with this helper.

**Files:**
- `src/actions/walkTo.ts`
- `src/actions/placeBlock.ts`
- `src/actions/giveItem.ts`
- `src/actions/buildSchematic.ts`
- `src/actions/wander.ts`
- `src/actions/followPlayer.ts`
- `src/voyager/CodeExecutor.ts`
- New: `src/actions/moveHelper.ts` (the shared helper)

---

### H-6: Add Bot Action Endpoints

**Size: M**
**Depends on:** C-1 (CommandCenter to dispatch)
**Blocks:** nothing

**Problem:**
The diagnostics panel references recovery action endpoints like `/api/bots/:name/resume`, `/api/bots/:name/task` which partially exist, but there are no endpoints for:
- `POST /api/bots/:name/pause` -- pause voyager
- `POST /api/bots/:name/resume` -- resume voyager
- `POST /api/bots/:name/stop` -- stop current action
- `POST /api/bots/:name/follow/:target` -- follow a player
- `POST /api/bots/:name/walkto` -- walk to coordinates
- `POST /api/bots/:name/return-to-base` -- go to home marker
- `POST /api/bots/:name/unstuck` -- run unstuck routine
- `POST /api/bots/:name/equip-best` -- equip best gear

These could be thin wrappers around `CommandCenter.create()` or direct worker commands.

**What to do:**
1. Add route handlers that either dispatch through `CommandCenter` (preferred) or send direct worker commands.
2. Emit activity events for each action.

**Files:**
- `src/server/api.ts`

---

### H-7: Add ConversationManager Persistence

**Size: S**
**Depends on:** nothing
**Blocks:** nothing

**Problem:**
`ConversationManager` stores all active conversations in memory. On restart, all conversation history is lost. The bot forgets mid-conversation context.

**What to do:**
1. Add `save()` and `load()` methods (JSON file in `data/conversations.json`).
2. Debounce writes.
3. Call `load()` on startup, add to shutdown flush.

**Files:**
- `src/personality/ConversationManager.ts` (or wherever it lives)
- `src/index.ts` (shutdown handler)

---

### H-8: Fix Metrics Endpoint Data

**Size: S**
**Depends on:** nothing
**Blocks:** nothing

**Problem:**
The `/api/metrics` endpoint (api.ts line 713-909) reads from persisted JSON files and uses wrong status values / field names:
- Commands: filters by `status === 'completed'` but backend type uses `succeeded`.
- Commands: filters by `status === 'pending'` but backend type uses `queued`.
- Squads: reads `squadsData.squads` then checks `s.members` but the type uses `botNames`.
- Squads: wraps in `.squads` property assuming file has that wrapper (may be a raw array).

**What to do:**
1. Align status string comparisons to match `CommandTypes.ts` and `MissionTypes.ts`.
2. Fix squad field to `s.botNames`.
3. Handle both `{ squads: [...] }` and raw array `[...]` formats for resilience.

**Files:**
- `src/server/api.ts` (lines 766-855)

---

## MEDIUM -- Quality and Polish

These items affect reliability, developer experience, or UI correctness but do not block core functionality.

---

### M-1: Add Debounce to Synchronous Writers

**Size: M**
**Depends on:** C-1
**Blocks:** nothing

**Problem:**
Several managers call `fs.writeFileSync()` on every mutation:
- `CommandCenter.persist()` -- every command state change
- `MissionManager.save()` -- every mission state change
- `SkillLibrary.saveIndex()` -- every skill addition
- `BotManager.saveBots()` -- every bot add/remove

Under load this causes I/O bottlenecks and potential corruption if writes overlap.

**What to do:**
1. Add a debounce wrapper (similar to what `MarkerStore` already uses with `DEBOUNCE_MS = 1000`).
2. Ensure `flush()` can force an immediate write for shutdown.

**Files:**
- `src/control/CommandCenter.ts`
- `src/control/MissionManager.ts`
- `src/voyager/SkillLibrary.ts`
- `src/bot/BotManager.ts`

---

### M-2: Add Atomic Writes Universally

**Size: S**
**Depends on:** nothing
**Blocks:** nothing

**Problem:**
Only `AffinityManager`, `SocialMemory`, and `BlackboardManager` use the safe write-to-temp-then-rename pattern. All other JSON writers (`CommandCenter`, `MissionManager`, `MarkerStore`, `SquadManager`, `RoleManager`, `RoutineManager`, `ChainCoordinator`, `BuildCoordinator`) use direct `writeFileSync` which can leave corrupted files on crash.

**What to do:**
1. Create a shared `atomicWriteJson(filePath, data)` utility.
2. Replace all `writeFileSync` calls with it.

**Files:**
- New: `src/util/atomicWrite.ts`
- All manager files that persist to disk

---

### M-3: Fix Roles Page

**Size: S**
**Depends on:** C-1, C-3, C-4
**Blocks:** nothing

**Problem:**
- Mutations (assign/update/delete role) do not refresh the UI after success.
- Loading condition is wrong (shows loading forever or never).
- No initial data fetch on page mount.

**What to do:**
1. Add `useEffect` to fetch `/api/roles/assignments` on mount.
2. After each mutation, either re-fetch or optimistically update the store.
3. Fix loading state logic.

**Files:**
- `web/src/app/roles/page.tsx`

---

### M-4: Fix Fleet Page

**Size: S**
**Depends on:** C-1, C-3
**Blocks:** nothing

**Problem:**
- `setSelection` is called but does not exist on the store (should be `selectAll` or similar).
- `missionTitles` closure captures stale state due to missing dependency in `useCallback`.

**What to do:**
1. Add `setSelection` to the store or rename the call.
2. Fix `useCallback` dependency array to include `missions`.

**Files:**
- `web/src/app/fleet/page.tsx`
- `web/src/lib/store.ts` or `controlStores.ts`

---

### M-5: Fix Commander Page

**Size: M**
**Depends on:** C-1, C-4, C-5
**Blocks:** nothing

**Problem:**
- Commander page expects `{ entries }` from `/api/commander/history` but the endpoint returns `{ entries }` (this one is actually OK).
- Plan object expects fields that `CommanderService.parse()` may not populate (e.g., `commands`, `missions` arrays may be empty because parse uses regex not LLM).
- `planId` is sometimes undefined when calling `/api/commander/execute`.

**What to do:**
1. Ensure `parse()` always returns a plan with all required fields (even if empty arrays).
2. Validate `planId` before calling execute.
3. Handle the case where the plan has no commands/missions (show "nothing to execute" message).

**Files:**
- `web/src/app/commander/page.tsx`
- `src/control/CommanderService.ts`

---

### M-6: Fix Build System Gaps

**Size: L**
**Depends on:** C-2
**Blocks:** nothing

**Problem:**
- No block verification after placement (build assumes `/setblock` always succeeds).
- No survival-mode building support (`buildSchematic.ts` exists in actions but `BuildCoordinator` uses `/setblock` commands).
- No permission check for `/setblock` (fails silently if server denies it).

**What to do:**
1. After each `/setblock`, verify the block is actually placed (query block at position).
2. Add a `survivalMode` flag to `BuildJob` that uses `buildSchematic.ts` action instead of `/setblock`.
3. Add error handling for denied commands.

**Files:**
- `src/build/BuildCoordinator.ts`
- `src/actions/buildSchematic.ts`

---

### M-7: Fix Supply Chain Completion Logic

**Size: M**
**Depends on:** C-2
**Blocks:** nothing

**Problem:**
- Stage completion is detected by substring match on task description, not by task ID.
- Item handoff between stages is not verified (assumes chest contents are correct).
- Stale detection window may be too aggressive or too lenient.

**What to do:**
1. Track stage completion by the actual task ID returned from `queueTask`.
2. After a stage completes, verify output chest contains expected items before advancing.
3. Make stale threshold configurable.

**Files:**
- `src/supplychain/ChainCoordinator.ts`

---

### M-8: Fix Config Wiring

**Size: S**
**Depends on:** nothing
**Blocks:** nothing

**Problem:**
- `config.yml` has `maxConcurrentRequests` but it is never read or enforced.
- `config.yml` has `logging.level` but the logger is not configured from it.
- `.env.example` and `config.yml` disagree on which settings go where.

**What to do:**
1. Read `maxConcurrentRequests` in the LLM client and enforce it (semaphore/queue).
2. Pass `logging.level` to the pino logger on startup.
3. Reconcile `.env.example` and `config.yml` documentation.

**Files:**
- `src/config.ts`
- `src/util/logger.ts`
- `src/ai/AnthropicClient.ts`, `src/ai/GeminiClient.ts`
- `.env.example`, `config.yml`

---

### M-9: Add npm test Script and Test Infrastructure

**Size: M**
**Depends on:** nothing
**Blocks:** M-14

**Problem:**
`package.json` has no `"test"` script. No test framework is installed. Zero tests exist.

**What to do:**
1. `npm install -D vitest` (or jest).
2. Add `"test": "vitest run"` to `package.json`.
3. Add a `vitest.config.ts`.
4. Write at least one smoke test to prove the harness works.

**Files:**
- `package.json`
- New: `vitest.config.ts`
- New: `tests/` directory

---

### M-10: Fix attack.ts Event Handling

**Size: S**
**Depends on:** nothing
**Blocks:** nothing

**Problem:**
- Uses `entityGone` event which does not exist in mineflayer; should be `entityDead` or check `entity.isValid`.
- No handler for bot death during combat.
- No health-based flee logic (bot fights to the death).

**What to do:**
1. Replace `entityGone` with `entityDead` or validity check.
2. Add `health` event listener; if health < threshold, disengage and flee.
3. Add death handler to clean up combat state.

**Files:**
- `src/actions/attack.ts`

---

### M-11: Fix noPath Handling in Actions

**Size: S**
**Depends on:** nothing
**Blocks:** nothing

**Problem:**
Several actions call `bot.pathfinder.goto()` but do not handle `path_update` events that indicate no path was found. The bot silently stops moving and the action hangs until timeout.

Affected: `container.ts` (moveNear to chest), `craft.ts` (move to crafting table), `followPlayer.ts`.

**What to do:**
1. Add `path_update` listener that checks for `noPath` status and rejects the promise.
2. This is largely solved by H-5's shared `moveNearWithCleanup()` helper.

**Files:**
- `src/actions/container.ts`
- `src/actions/craft.ts`
- `src/actions/followPlayer.ts`

---

### M-12: Fix Container Timeout

**Size: S**
**Depends on:** nothing
**Blocks:** nothing

**Problem:**
`openContainer()` and `openFurnace()` calls in `container.ts` and `smelt.ts` have no timeout. If the server never responds (chunk unloaded, permission denied), the action hangs forever.

**What to do:**
1. Wrap open calls in a `Promise.race` with a timeout (e.g., 10 seconds).
2. On timeout, reject with a clear error message.

**Files:**
- `src/actions/container.ts`
- `src/actions/smelt.ts`

---

### M-13: Remove Dead Code After Consolidation

**Size: S**
**Depends on:** C-3
**Blocks:** nothing

**Problem:**
After C-3 consolidates the stores, the losing store file should be deleted. Also audit `web/src/lib/api.ts` for unused API wrapper functions that call endpoints that do not exist.

**What to do:**
1. Delete unused store file.
2. Remove or stub API wrappers for non-existent endpoints (to avoid confusion).

**Files:**
- `web/src/lib/controlStores.ts` (likely candidate for deletion)
- `web/src/lib/api.ts`

---

### M-14: Add API Route Tests

**Size: L**
**Depends on:** M-9
**Blocks:** nothing

**Problem:**
Zero HTTP endpoint tests. No way to verify routes return correct shapes or handle edge cases.

**What to do:**
1. Install `supertest`.
2. Write test suite for core routes: `/api/bots`, `/api/status`, `/api/metrics`, `/api/commander/*`.
3. Add tests for control platform routes after C-1 lands.

**Files:**
- New: `tests/api/` directory
- `package.json` (add supertest devDep)

---

### M-15: Fix Duplicate createMission Route

**Size: S**
**Depends on:** C-1
**Blocks:** nothing

**Problem:**
If/when mission routes are added in C-1, care must be taken: Express allows duplicate route definitions and the last one wins silently. The audit found a pattern where `POST /api/missions` was registered twice in draft code. Ensure exactly one handler per method+path.

**What to do:**
1. When implementing C-1 routes, grep for duplicate registrations.
2. Add a startup check or linter rule that flags duplicate Express routes.

**Files:**
- `src/server/api.ts`

---

## LOW -- Nice-to-Have

These are minor issues, edge cases, or enhancements that do not affect core functionality.

---

### L-1: Hardcoded Y=64 in guard_zone Command

**Size: S** | **Depends on:** C-1 | **Blocks:** nothing

The `guard_zone` command handler in `CommandCenter.ts` sends bots to Y=64 regardless of terrain. Should either use the bot's current Y or query terrain height.

**Files:** `src/control/CommandCenter.ts`

---

### L-2: patrol_route Only Goes to First Waypoint

**Size: S** | **Depends on:** C-1 | **Blocks:** nothing

The `patrol_route` command resolves waypoints from the route but only sends the bot to the first one. Should iterate through all waypoints in sequence (and loop if `route.loop` is true).

**Files:** `src/control/CommandCenter.ts`

---

### L-3: Loadout Policy is a No-Op

**Size: S** | **Depends on:** C-1 | **Blocks:** nothing

`RoleAssignmentRecord.loadoutPolicy` and `TemplateManager.loadoutPolicy` are stored and returned in API responses but never enforced. The bot does not equip items based on the policy before starting a mission.

**Files:** `src/control/RoleManager.ts`, `src/control/TemplateManager.ts`

---

### L-4: Skill Quality Estimator is Heuristic-Only

**Size: M** | **Depends on:** nothing | **Blocks:** nothing

The skill quality score is based on code length and naming heuristics, not on execution success rate. Could track success/failure per skill and weight the score accordingly.

**Files:** `src/voyager/SkillLibrary.ts`

---

### L-5: Stochastic Observation Warmup Drops Fields

**Size: S** | **Depends on:** nothing | **Blocks:** nothing

The observation warmup phase randomly omits fields from the observation to reduce token usage, but this can cause the LLM to hallucinate missing data or make wrong assumptions.

**Files:** `src/voyager/VoyagerLoop.ts` or observation builder

---

### L-6: vm.Script 5s Timeout is Misleading

**Size: S** | **Depends on:** nothing | **Blocks:** nothing

The `vm.Script` timeout only covers the synchronous execution phase. Any async operations (pathfinding, waiting for events) run outside the timeout. The real timeout is the VoyagerLoop's per-task timeout.

**What to do:** Add a comment clarifying this, or add an overall wall-clock timeout wrapper.

**Files:** `src/voyager/CodeExecutor.ts`

---

### L-7: Schematic Filenames with Spaces/Accents

**Size: S** | **Depends on:** C-2 | **Blocks:** nothing

`BuildCoordinator.listSchematics()` may fail or produce broken paths for filenames containing spaces, accents, or special characters.

**Files:** `src/build/BuildCoordinator.ts`

---

### L-8: EventLog Reflections Grow Unbounded

**Size: S** | **Depends on:** nothing | **Blocks:** nothing

`EventLog` has a circular buffer for events (capped at 500) but the reflection/summary strings it generates are appended to an array that is never trimmed.

**Files:** `src/server/EventLog.ts`

---

### L-9: lastGeneratedAt Throttle Resets on Restart

**Size: S** | **Depends on:** nothing | **Blocks:** nothing

The curriculum's `lastGeneratedAt` timestamp (used to throttle LLM calls) is in-memory only. On restart, the first task proposal immediately hits the LLM without any cooldown.

**Files:** `src/voyager/CurriculumAgent.ts`

---

## Dependency Graph

```
                    +-----------+
                    |   C-1     |  Wire Control Platform
                    | (XL)     |
                    +-----+-----+
                          |
          +-------+-------+-------+-------+-------+
          |       |       |       |       |       |
        C-5     C-6     H-2     H-3     H-4     H-6
       (fix CS) (shut) (map)  (sock)  (recon)  (bot EP)
          |                                       |
        M-5                                     M-3,4
     (cmdr pg)                               (roles,fleet)
                                                 |
                                               C-4
                                          (type mismatch)

    +-----------+
    |   C-2     |  Wire Build/Chain
    |   (L)     |
    +-----+-----+
          |
    +-----+-----+
    |           |
   M-6         M-7
  (build)    (chain)

    +-----------+
    |   C-3     |  Fix Dual Store
    |   (M)     |
    +-----+-----+
          |
    +-----+-----+-------+
    |           |       |
   C-4        M-13    M-3,4,5
  (types)   (dead code) (pages)

    +-----------+
    |   M-9     |  Add Test Infra
    |   (M)     |
    +-----+-----+
          |
        M-14
     (API tests)

    H-5 (listener leaks) --> M-11 (noPath) [M-11 largely solved by H-5]
```

Items with no arrows are independent and can be worked in any order:
- H-1 (social system)
- H-5 (listener leaks)
- H-7 (conversation persistence)
- H-8 (metrics fix)
- M-2 (atomic writes)
- M-8 (config wiring)
- M-10 (attack.ts)
- M-12 (container timeout)
- All L-* items

---

## Suggested Sprint Plan

### Sprint 1 -- Foundation (Week 1-2)

**Goal:** Make the control platform actually run.

| Item | Size | Parallel? |
|------|------|-----------|
| **C-1** Wire Control Platform | XL | Main track |
| **C-2** Wire Build/Chain | L | Can run in parallel with C-1 |
| **C-3** Fix Dual Store | M | Can run in parallel with C-1 |
| **C-6** Fix Shutdown Handler | S | After C-1 + C-2 merge |
| **H-8** Fix Metrics Endpoint | S | Independent, quick win |
| **M-2** Atomic Writes Utility | S | Independent, quick win |

**Sprint 1 deliverable:** All control platform managers are live, API routes exist and return data, frontend has a single store, server shuts down cleanly.

---

### Sprint 2 -- Integration (Week 3-4)

**Goal:** Frontend and backend speak the same language. Commander works end-to-end.

| Item | Size | Parallel? |
|------|------|-----------|
| **C-4** Fix Type Mismatches | L | Requires C-1, C-3 |
| **C-5** Fix CommanderService | L | Requires C-1 |
| **H-4** Fix Socket Reconnection | M | Requires C-1 |
| **H-3** Fix Socket Event Payloads | M | Requires C-1 |
| **H-6** Bot Action Endpoints | M | Requires C-1 |
| **M-1** Debounce Synchronous Writers | M | Requires C-1 |

**Sprint 2 deliverable:** Commander parse-and-execute flow works end-to-end. Socket events deliver correct data. Frontend reconnects cleanly.

---

### Sprint 3 -- Features (Week 5-6)

**Goal:** Map, fleet, roles, and build pages work correctly.

| Item | Size | Parallel? |
|------|------|-----------|
| **H-2** Wire Map Features | L | Requires C-1, C-4 |
| **M-3** Fix Roles Page | S | Requires C-1, C-3, C-4 |
| **M-4** Fix Fleet Page | S | Requires C-1, C-3 |
| **M-5** Fix Commander Page | M | Requires C-5 |
| **M-6** Fix Build System | L | Requires C-2 |
| **M-7** Fix Supply Chain | M | Requires C-2 |

**Sprint 3 deliverable:** All dashboard pages render real data and mutations work. Build jobs run with verification. Supply chains complete correctly.

---

### Sprint 4 -- Resilience (Week 7-8)

**Goal:** Fix reliability issues and add safety nets.

| Item | Size | Parallel? |
|------|------|-----------|
| **H-1** Wire Social System | L | Independent |
| **H-5** Fix Event Listener Leaks | M | Independent |
| **H-7** Conversation Persistence | S | Independent |
| **M-8** Fix Config Wiring | S | Independent |
| **M-10** Fix attack.ts | S | Independent |
| **M-11** Fix noPath Handling | S | After H-5 |
| **M-12** Fix Container Timeout | S | Independent |

**Sprint 4 deliverable:** Bots are more resilient, social system feeds personality, conversations survive restarts, combat is safer.

---

### Sprint 5 -- Quality (Week 9-10)

**Goal:** Testing, documentation, cleanup.

| Item | Size | Parallel? |
|------|------|-----------|
| **C-7** Fix CLAUDE.md | S | After C-1, C-2 |
| **M-9** Add Test Infrastructure | M | Independent |
| **M-14** Add API Route Tests | L | After M-9 |
| **M-13** Remove Dead Code | S | After C-3 |
| **M-15** Fix Duplicate Route | S | During C-1 |
| **L-1 through L-9** | S each | Independent |

**Sprint 5 deliverable:** Test suite exists, documentation is accurate, dead code is gone, low-priority issues are resolved.

---

## Total Effort Estimate

| Tier | Count | Total Size |
|------|-------|-----------|
| Critical | 7 | ~1 XL + 3 L + 2 M + 1 S = ~50-70h |
| High | 8 | ~2 L + 4 M + 2 S = ~30-45h |
| Medium | 15 | ~2 L + 4 M + 9 S = ~35-50h |
| Low | 9 | ~1 M + 8 S = ~10-15h |
| **Total** | **39** | **~125-180 hours** |

At sustainable pace (one developer, 6h/day productive time), this is roughly 4-6 weeks of focused work. With two developers working the parallel tracks, it compresses to 3-4 weeks.

---

## Quick Reference: File Hotspots

Files touched by the most items (fix these carefully):

| File | Items |
|------|-------|
| `src/server/api.ts` | C-1, C-2, C-5, H-6, H-8, M-15 |
| `src/index.ts` | C-1, C-2, C-5, C-6 |
| `web/src/lib/store.ts` | C-3, C-4, M-4 |
| `web/src/lib/controlStores.ts` | C-3, C-4, M-13 |
| `web/src/components/SocketProvider.tsx` | C-3, H-3, H-4 |
| `src/control/CommandCenter.ts` | C-1, H-3, L-1, L-2, M-1 |
| `src/control/CommanderService.ts` | C-5, M-5 |
