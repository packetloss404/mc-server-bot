# Backend Architecture Plan

## Current State

The backend control surface is currently concentrated in `src/server/api.ts`, with behavior executed through:

- `BotManager`
- `BotInstance`
- `VoyagerLoop`
- `BuildCoordinator`
- `ChainCoordinator`

This works for the current feature set, but it will become brittle if every new control mode is added directly to `api.ts`.

## Target Architecture

Introduce a dedicated control domain in `src/control/`.

## Proposed Modules

### `src/control/CommandTypes.ts`

Shared TypeScript types for:

- command kinds
- command scope
- command payloads
- command status
- command result and errors

### `src/control/CommandCenter.ts`

Responsibilities:

- validate commands
- route commands to bot, squad, or mission handlers
- emit lifecycle events
- persist command records
- handle cancellation when supported

### `src/control/MissionManager.ts`

Responsibilities:

- store and retrieve missions
- map mission types to execution handlers
- coordinate with `VoyagerLoop`, `BuildCoordinator`, and `ChainCoordinator`
- manage retries, dependencies, and statuses

### `src/control/MarkerStore.ts`

Responsibilities:

- CRUD for markers, zones, and routes
- world planning persistence under `data/`
- spatial lookup helpers for map features and role policies

### `src/control/SquadManager.ts`

Responsibilities:

- store named squads
- track members and defaults
- dispatch batch commands
- aggregate success/failure across bots

### `src/control/RoleManager.ts`

Responsibilities:

- persist role assignments
- evaluate role policies
- queue role-generated missions
- honor manual override and safety rules

### `src/control/CommanderService.ts`

Responsibilities:

- parse natural-language requests
- generate typed plans
- require confirmation for unsafe or ambiguous plans
- execute via `CommandCenter` and `MissionManager`

## Existing Module Integration

### `BotManager`

Keep it as the source of truth for live bot instances. New control services should depend on it rather than reimplementing bot discovery.

### `BotInstance`

Extend `getDetailedStatus()` to expose richer control state:

- current command
- manual override state
- pause reason
- queued mission count
- last mission outcome

### `VoyagerLoop`

Current hidden queue in `playerTaskQueue` is the seed for explicit mission planning. Add safe accessors and mutators rather than letting API routes manipulate internal arrays directly.

### `BuildCoordinator` and `ChainCoordinator`

Treat these as specialized mission executors. Do not discard them. Wrap them with mission adapters.

## Persistence Strategy

Store control-plane records in `data/`.

### Suggested files

- `data/commands.json`
- `data/missions.json`
- `data/markers.json`
- `data/zones.json`
- `data/routes.json`
- `data/squads.json`
- `data/roles.json`
- `data/routines.json`

For the current repo, synchronous file access is acceptable in startup/load/save paths, matching existing patterns like `src/config.ts` and `src/bot/BotManager.ts`.

## Event Model

Emit lifecycle events from services, not pages or route handlers.

### New event families

- `command:queued`
- `command:started`
- `command:succeeded`
- `command:failed`
- `command:cancelled`
- `mission:created`
- `mission:updated`
- `mission:completed`
- `mission:failed`
- `marker:created`
- `zone:updated`
- `squad:updated`
- `role:updated`

## API Layer Guidance

Keep `src/server/api.ts` thin. It should:

- validate request shape
- call the right service
- return IDs and current records
- never own business logic once the control layer exists

## Concurrency And Safety

Important arbitration rules:

- manual commands can interrupt role automation
- batch commands should degrade gracefully when some bots are offline
- long-running missions need resumable state
- socket events must reflect partial success, not only binary outcomes
