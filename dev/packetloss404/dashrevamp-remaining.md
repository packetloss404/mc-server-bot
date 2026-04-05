# Dashboard Revamp - Remaining Work

Condensed from `dev/dashrevamp/plan/` (21 planning docs, now deleted).
Backend control platform and frontend pages are substantially implemented.
This file captures only what's **not yet done**.

## Unbuilt Features

### Routines & Templates (entirely missing)
- Command macros (record/replay sequences)
- Reusable mission templates
- Preset squad operations
- Named loadouts

### Role Policy Enforcement (backend structure exists, logic not wired)
- `evaluateAutomation()` in RoleManager doesn't generate missions in practice
- Autonomy levels (manual/assisted/autonomous) tracked but not enforced in bot behavior
- Interrupt policy (`always`, `never-while-critical`, `confirm-if-busy`) defined but not actively used
- Loadout/restock policies defined in schema but unimplemented

### Map Authoring UX (CRUD works, drawing tools missing)
- No drag-to-draw zone creation on map canvas
- No route waypoint drawing tool
- Mission assignment from clicking map objects not wired
- Squad/mission overlays on map missing

### Diagnostics & Recovery (surfaces exist, depth missing)
- No "why is this bot stuck?" diagnostic panel
- No retry/recovery suggestions UI
- No bot diagnostic timeline view
- History page doesn't fully integrate command + mission records
- `blockedReason` on missions exists in data but not prominently surfaced

## Incomplete Integration

### Frontend Store Consolidation
- 5+ separate Zustand stores (`store.ts`, `controlStore.ts`, `missionStore.ts`, `fleetStore.ts`, `mapStore.ts`)
- Not unified into single source of truth
- Selection state not shared across pages (fleet, map, dashboard)

### Socket-Driven Updates
- `command:*` and `mission:*` socket events are wired in SocketProvider
- Some stores still rely on polling instead of socket as primary update path

### Mission Queue UX
- Queue visibility works
- Reorder/prepend/clear UI flows incomplete
- "Do now" vs "Do next" distinction not labeled in UI
- History split between mission records and older activity data

### Commander Polish
- Frontend/backend contract may drift (plan types not shared)
- Persistent history is in-memory only (max 100, not saved to disk)
- Drafts use localStorage only
- No interactive disambiguation/clarification flow
- No command templates or suggested routines

## Missing Components (planned but never built)
- `CommandButtonGroup` - reusable action button bar
- `MissionComposer` - dedicated mission creation form
- `ZoneEditor` - zone shape editor (MarkerEditor exists)

## Testing Gaps
- Frontend: only 2 component tests (`CommanderPanel`, `MapContextMenu`)
- No end-to-end test suite
- No cross-feature integration tests (fleet + role + map interactions)
- Backend coverage decent (~1800 lines in `test/control/`)

## Telemetry Gaps
- `getMetrics()` exists on CommandCenter and MissionManager
- `/api/metrics` endpoint exists but returns minimal data
- No visual health/metrics dashboards in frontend
- Commander metrics not tracked
- Fleet metrics (override rates, squad activity) not collected

## Stale Items (from old dev notes, still open)
- `deposit_inventory` command is a stub (needs async chest interaction)
- `activeMissionId` on squads appears unused
- `cooperation` and `help_request` socket events still unrecorded
- `getUnread()` unused in bot-to-bot comms

## Override Visibility Gap
- Override info available via RoleManager API
- Shown on `/roles` page but NOT on bot detail page or bot cards
