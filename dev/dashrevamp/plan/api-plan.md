# API Plan

## Current API Surface Relevant To Control

The repo already exposes direct control endpoints in `src/server/api.ts`:

- `POST /api/bots`
- `DELETE /api/bots/:name`
- `POST /api/bots/:name/mode`
- `POST /api/bots/:name/task`
- `POST /api/bots/:name/pause`
- `POST /api/bots/:name/resume`
- `POST /api/bots/:name/stop`
- `POST /api/bots/:name/follow`
- `POST /api/bots/:name/walkto`
- `POST /api/bots/:name/chat`

The revamp should preserve compatibility short term, but route new product behavior through a shared control API.

## API Design Principles

- typed and product-facing, not transport-only
- one consistent mutation path across pages
- explicit IDs for long-running work
- socket updates mirror durable REST objects

## Proposed REST APIs

## Commands

### `POST /api/commands`

Create and dispatch a command.

Example request:

```json
{
  "type": "move_to_marker",
  "scope": "bot",
  "targets": ["Ada"],
  "payload": {
    "markerId": "base-main"
  },
  "priority": "high",
  "source": "dashboard"
}
```

### `GET /api/commands`

List command history with filters.

### `GET /api/commands/:id`

Get full command detail.

### `POST /api/commands/:id/cancel`

Cancel a running or queued command when supported.

## Missions

### `POST /api/missions`

Create a mission.

Mission examples for this repo:

- `queue_task`
- `build_schematic`
- `supply_chain`
- `patrol_zone`
- `gather_items`

### `GET /api/missions`

List missions by status, bot, squad, or type.

### `GET /api/missions/:id`

Get mission detail and history.

### `POST /api/missions/:id/pause`

Pause a mission if the mission executor supports it.

### `POST /api/missions/:id/resume`

Resume a paused mission.

### `POST /api/missions/:id/cancel`

Cancel a mission.

### `POST /api/missions/:id/retry`

Retry a failed mission.

### `POST /api/bots/:name/mission-queue`

Append a mission to one bot's queue.

### `PATCH /api/bots/:name/mission-queue`

Reorder, reprioritize, or remove queued entries.

## World Planning

### `GET /api/markers`
### `POST /api/markers`
### `PATCH /api/markers/:id`
### `DELETE /api/markers/:id`

### `GET /api/zones`
### `POST /api/zones`
### `PATCH /api/zones/:id`
### `DELETE /api/zones/:id`

### `GET /api/routes`
### `POST /api/routes`
### `PATCH /api/routes/:id`
### `DELETE /api/routes/:id`

## Squads

### `GET /api/squads`
### `POST /api/squads`
### `GET /api/squads/:id`
### `PATCH /api/squads/:id`
### `DELETE /api/squads/:id`
### `POST /api/squads/:id/commands`
### `POST /api/squads/:id/missions`

## Roles

### `GET /api/roles`
### `POST /api/roles/assignments`
### `PATCH /api/roles/assignments/:id`
### `DELETE /api/roles/assignments/:id`

## Commander

### `POST /api/commander/parse`

Turns free text into a typed plan preview.

### `POST /api/commander/execute`

Executes a previously parsed and confirmed plan.

## Compatibility Plan With Existing Endpoints

### Keep in place for now

- `POST /api/bots/:name/task`
- `POST /api/bots/:name/pause`
- `POST /api/bots/:name/resume`
- `POST /api/bots/:name/stop`
- `POST /api/bots/:name/follow`
- `POST /api/bots/:name/walkto`

### Internally migrate them to

- command creation via `CommandCenter`
- mission creation via `MissionManager`

## Socket.IO Plan

The frontend already listens to many low-level events in `web/src/components/SocketProvider.tsx`. Add new event families.

### Commands

- `command:queued`
- `command:started`
- `command:succeeded`
- `command:failed`
- `command:cancelled`

Payload shape:

```json
{
  "commandId": "cmd_123",
  "type": "follow_player",
  "targets": ["Ada"],
  "status": "started",
  "timestamp": 1234567890,
  "result": null,
  "error": null
}
```

### Missions

- `mission:created`
- `mission:updated`
- `mission:completed`
- `mission:failed`
- `mission:cancelled`

### World planning

- `marker:created`
- `marker:updated`
- `zone:updated`
- `route:updated`

### Fleet and roles

- `squad:updated`
- `role:updated`

## Repo-Specific API Recommendations

- keep `src/server/api.ts` as a route registration layer only
- extract command and mission logic before adding many more route handlers
- reuse existing `build` and `chain` APIs as specialized mission adapters instead of parallel systems forever
