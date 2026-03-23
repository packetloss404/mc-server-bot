# Implementation Notes

## Current Repo Extension Points

## `src/server/api.ts`

This file is already large and should not continue absorbing major control logic. New work should split route registration from domain behavior.

Recommended sequence:

1. introduce `src/control/` services
2. add route handlers that call the services
3. migrate existing control endpoints to shared services
4. only then add new control endpoints in volume

## `src/voyager/VoyagerLoop.ts`

The existing `playerTaskQueue` is the most important hidden implementation detail for the mission planner.

Add:

- queue inspection
- queue removal
- queue insertion at front
- queue reorder by id
- pause reason exposure
- last success / last failure exposure

Avoid exposing raw internal arrays directly.

## `src/bot/BotInstance.ts`

`getDetailedStatus()` should become the backend's main bot control summary. Extend it with:

- queued mission count
- queued mission previews
- override state
- role assignment summary
- current command
- last command result

## `web/src/lib/store.ts`

The current store is good for live telemetry, but it lacks:

- command state
- mission state
- world planning objects
- squad selection state
- role state
- commander state

Add slices instead of continuing to flatten everything into one object.

## `web/src/components/SocketProvider.tsx`

Expand it to subscribe to control events and normalize updates into the store.

Current polling can remain as fallback, but command and mission state should be event-first.

## `web/src/app/map/page.tsx`

Expect refactor before feature growth. The current implementation already has lint issues around refs during render.

Suggested cleanup order:

1. fix render-time ref writes
2. isolate canvas logic from toolbar UI
3. add selection and context-menu state
4. add marker and zone editing modes

## Build And Chain Reuse

- wrap `BuildCoordinator` as a build mission executor
- wrap `ChainCoordinator` as a supply-chain mission executor
- keep existing pages but connect them to the shared mission model so the product stops feeling fragmented
