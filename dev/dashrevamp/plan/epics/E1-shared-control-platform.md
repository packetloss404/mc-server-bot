# E1 Shared Control Platform

Current status: mostly implemented

Current-state note:

- shared command types, command service, APIs, persistence, and cancellation are in the repo now
- the main remaining gap is frontend adoption of lifecycle events and unified command state

## Goal

Create the common backend and event foundation that every control surface uses.

## PM Workstream

- PM-01 Control Platform

## Repo Impact

- new `src/control/` module family
- `src/server/api.ts`
- `src/server/socketEvents.ts`
- `web/src/lib/api.ts`
- `web/src/lib/store.ts`
- `web/src/components/SocketProvider.tsx`

## Stories

### E1-S1 Define shared control types

Status: done

Acceptance criteria:

- repo has typed command status, scope, payload, and result models
- types align with `dev/dashrevamp/plan/schemas.md`
- frontend and backend import from a stable shared contract location or parallel equivalent models

Tasks:

- create `src/control/CommandTypes.ts`
- define command kind unions for current and planned command set
- define validation-friendly payload shapes
- document compatibility mapping from old endpoints to new command types

### E1-S2 Create `CommandCenter`

Status: mostly done

Acceptance criteria:

- commands can be created, started, completed, failed, and cancelled
- commands emit lifecycle events
- command records are queryable after execution

Tasks:

- create `src/control/CommandCenter.ts`
- implement in-memory plus JSON-backed command record persistence in `data/commands.json`
- add command dispatch handlers for existing bot actions: pause, resume, stop, follow, walk
- add structured logging with `commandId`, `bot`, and `source`

### E1-S3 Migrate current direct APIs to shared control service

Status: done

Acceptance criteria:

- existing endpoints remain externally compatible
- `src/server/api.ts` delegates behavior instead of owning it

Tasks:

- wrap `POST /api/bots/:name/pause`
- wrap `POST /api/bots/:name/resume`
- wrap `POST /api/bots/:name/stop`
- wrap `POST /api/bots/:name/follow`
- wrap `POST /api/bots/:name/walkto`
- add `POST /api/commands`
- add `GET /api/commands`
- add `GET /api/commands/:id`

### E1-S4 Emit command lifecycle over Socket.IO

Status: partial

Acceptance criteria:

- frontend can observe queued, started, succeeded, failed, and cancelled events
- event payloads are stable and typed

Tasks:

- extend event emission beyond `src/server/socketEvents.ts` polling model
- emit `command:queued`
- emit `command:started`
- emit `command:succeeded`
- emit `command:failed`
- emit `command:cancelled`

## Dependencies

- foundational epic for E2, E3, E4, E5, and E7
