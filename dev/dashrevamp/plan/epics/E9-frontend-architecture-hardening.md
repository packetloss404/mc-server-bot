# E9 Frontend Architecture Hardening

Current status: partial

Current-state note:

- reusable components were added, but frontend architecture is still one of the biggest open risks
- duplicated stores and incomplete socket-first control syncing are the main blockers for the rest of the revamp

## Goal

Keep the frontend maintainable while feature count rises.

## PM Workstream

- PM-09 Frontend System

## Repo Impact

- `web/src/lib/store.ts`
- `web/src/components/SocketProvider.tsx`
- major app pages and new reusable components

## Stories

### E9-S1 Split store into logical slices

Status: partial

Acceptance criteria:

- store supports telemetry, control, missions, world planning, fleet, and roles cleanly
- new features do not pile unrelated state into one flat object

Tasks:

- refactor store shape
- add typed selectors
- avoid regression in existing live bot views

### E9-S2 Upgrade socket provider to event-first control sync

Status: partial

Acceptance criteria:

- command and mission state updates come primarily from sockets
- polling remains fallback only

Tasks:

- subscribe to `command:*`, `mission:*`, `marker:*`, `squad:*`, `role:*`
- normalize event handling into store updates

### E9-S3 Create reusable control components

Status: mostly done

Acceptance criteria:

- queue, command, selection, and editor UIs are shared instead of page-specific clones

Tasks:

- create `MissionQueuePanel`
- create `CommandHistoryPanel`
- create `FleetSelectionBar`
- create `MapContextMenu`
- create `RoleAssignmentPanel`

## Dependencies

- should begin early; E4 especially depends on this cleanup
