# E5 Fleet Selection And Squads

## Goal

Provide intentional multi-bot control.

## PM Workstream

- PM-05 Fleet Ops

## Repo Impact

- new fleet page
- `web/src/lib/store.ts`
- backend squad APIs and services

## Stories

### E5-S1 Add selection model

Acceptance criteria:

- operator can select multiple bots from dashboard, map, or fleet page
- selection state is shared across relevant screens

Tasks:

- add selected bot IDs to store
- add bulk action toolbar
- add shared selection UX pattern

### E5-S2 Add squad persistence

Acceptance criteria:

- squads can be created, renamed, edited, and deleted
- squads persist in `data/squads.json`

Tasks:

- implement `SquadManager`
- add squad REST APIs
- add squad editor UI

### E5-S3 Add batch command execution

Acceptance criteria:

- one UI action can create a command affecting multiple bots
- UI shows per-bot success and failure details

Tasks:

- add squad or selection command fan-out logic in `CommandCenter`
- add aggregated command result model
- add batch result panel in fleet page

## Dependencies

- depends on E1 and E9 shared selection state
