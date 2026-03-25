# E3 Mission Planner And Queue Visibility

Current status: partial

Current-state note:

- mission types, mission manager, mission APIs, and queue inspection are present
- queue control and queue/history UX are still split between shared mission records and raw Voyager task state

## Goal

Expose and control planned work instead of hiding queue state inside `VoyagerLoop`.

## PM Workstream

- PM-03 Mission Planner

## Repo Impact

- `src/voyager/VoyagerLoop.ts`
- `src/bot/BotInstance.ts`
- `web/src/app/bots/[name]/page.tsx`
- `web/src/lib/api.ts`
- `web/src/lib/store.ts`

## Stories

### E3-S1 Add explicit mission models and persistence

Status: done

Acceptance criteria:

- mission records exist independently of UI refreshes
- mission states align with planning docs

Tasks:

- create `src/control/MissionTypes.ts`
- create `src/control/MissionManager.ts`
- persist mission records to `data/missions.json`
- model relationships between mission and queued voyager tasks

### E3-S2 Expose `VoyagerLoop` queue safely

Status: partial

Acceptance criteria:

- queued tasks are inspectable without mutating internal arrays unsafely
- queue supports prepend, append, remove, clear, and reorder operations

Tasks:

- add queue accessors to `src/voyager/VoyagerLoop.ts`
- add queue item IDs and timestamps
- preserve current decompose-and-queue behavior while surfacing intermediate status

### E3-S3 Replace ad hoc task entry UI with mission queue panel

Status: partial

Acceptance criteria:

- bot detail page shows current mission, queued missions, recent failures, and completions
- operator can retry, cancel, reorder, and interrupt work

Tasks:

- add `MissionQueuePanel` component
- add queue mutation APIs
- show `Do now` vs `Do next`
- show blocked reason and retry shortcut

## Dependencies

- depends on E1 and partial `VoyagerLoop` exposure
