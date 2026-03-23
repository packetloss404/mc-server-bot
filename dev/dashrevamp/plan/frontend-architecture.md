# Frontend Architecture Plan

## Current State

The dashboard already has a strong base:

- route structure under `web/src/app/`
- shared API client in `web/src/lib/api.ts`
- Zustand state in `web/src/lib/store.ts`
- live synchronization in `web/src/components/SocketProvider.tsx`

Today the store is telemetry-focused. The revamp needs it to become operator-focused too.

## Frontend Design Goals

- one interaction model across pages
- reusable control primitives
- live state and mutation history in one place
- no page-specific command logic that cannot be reused elsewhere

## Store Evolution

Extend `web/src/lib/store.ts` with new slices.

### `control` slice

- pending commands by id
- recent command history
- selected bot ids
- active manual overrides
- current commander draft plan

### `missions` slice

- mission records by id
- mission ids by bot
- mission ids by squad
- filters and active view state

### `worldPlanning` slice

- markers
- zones
- routes
- selected map object
- drawing mode

### `fleet` slice

- squads
- current selection set
- bulk action state

### `roles` slice

- role assignments
- policy edit state

## Component System

Create reusable control components under `web/src/components/`.

### Proposed components

- `CommandButtonGroup`
- `CommandHistoryPanel`
- `MissionQueuePanel`
- `MissionComposer`
- `FleetSelectionBar`
- `MapContextMenu`
- `MarkerEditor`
- `ZoneEditor`
- `RoleAssignmentPanel`
- `CommanderPanel`

## Page Strategy

### Evolve existing pages

- `web/src/app/page.tsx` becomes the fleet overview and exception dashboard
- `web/src/app/bots/[name]/page.tsx` becomes the deep individual control page
- `web/src/app/map/page.tsx` becomes the primary tactical map surface
- `web/src/app/manage/page.tsx` becomes admin setup and lower-frequency bot management, not the main control page
- `web/src/app/build/page.tsx` and `web/src/app/chains/page.tsx` become specialized mission surfaces integrated with the shared mission model

### Add pages

- `web/src/app/fleet/page.tsx`
- `web/src/app/roles/page.tsx`
- `web/src/app/commander/page.tsx`
- `web/src/app/history/page.tsx`

## Data Flow

### Read path

- initial load from REST
- live updates from Socket.IO
- selective polling only for fallbacks or slow-changing objects

### Write path

- page triggers API mutation through `web/src/lib/api.ts`
- optimistic UI only for clearly safe operations
- final state reconciled by socket lifecycle events

## UX Guidance

- surface command and mission state visibly where the action was launched
- support keyboard workflows for power users
- preserve low-friction one-click actions
- keep confirmation prompts for high-impact operations only

## Repo-Specific Notes

- `web/src/app/map/page.tsx` has existing lint issues around ref usage; budget refactor time before layering on major interaction features
- `web/src/components/SocketProvider.tsx` should subscribe to new `command:*`, `mission:*`, `marker:*`, `squad:*`, and `role:*` events
- `web/src/lib/api.ts` should become the typed source of truth for new control APIs
