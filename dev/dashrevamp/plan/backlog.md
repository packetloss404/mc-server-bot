# Implementation Backlog

This backlog translates the planning package into execution-ready epics, stories, and engineering tasks for this repo.

The table below is now also used as a status board for the current repo state.

## Operating Model

The program is split into 10 PM-style workstreams. These are planning lanes that can be owned by one person or shared across a small team.

| PM | Workstream | Status | Primary Outcome | Main Docs |
|---|---|---|---|---|
| PM-01 | Control Platform | Mostly done | Shared command lifecycle and backend control foundation | `features.md`, `current-state.md` |
| PM-02 | Tactical Controls | Partial | Upgraded command center and manual override UX | `features.md`, `current-state.md` |
| PM-03 | Mission Planner | Partial | Visible queueing, planning, retries, and task history | `features.md`, `milestones.md` |
| PM-04 | Spatial Control | Partial | Markers, zones, routes, and map-first control | `features.md`, `current-state.md` |
| PM-05 | Fleet Ops | Partial | Multi-select, squads, and batch operations | `features.md`, `user-flows.md` |
| PM-06 | Role Automation | Partial | Persistent roles, policy settings, and override rules | `features.md`, `frontend-architecture.md` |
| PM-07 | Commander | Partial | Natural language planning and confirmation workflows | `vision.md`, `user-flows.md` |
| PM-08 | Diagnostics | Partial | History, blockers, recovery, and operator confidence | `telemetry.md`, `features.md` |
| PM-09 | Frontend System | Partial | Store, socket, and component architecture cleanup | `frontend-architecture.md`, `current-state.md` |
| PM-10 | QA And Release | Partial | Tests, telemetry, rollout, and migration | `telemetry.md`, `current-state.md` |

## Epic Files

- [E1 Shared control platform](epics/E1-shared-control-platform.md)
- [E2 Tactical command center revamp](epics/E2-tactical-command-center-revamp.md)
- [E3 Mission planner and queue visibility](epics/E3-mission-planner-and-queue-visibility.md)
- [E4 World planning and map control](epics/E4-world-planning-and-map-control.md)
- [E5 Fleet selection and squads](epics/E5-fleet-selection-and-squads.md)
- [E6 Roles and automation policies](epics/E6-roles-and-automation-policies.md)
- [E7 Commander console](epics/E7-commander-console.md)
- [E8 Diagnostics and history](epics/E8-diagnostics-and-history.md)
- [E9 Frontend architecture hardening](epics/E9-frontend-architecture-hardening.md)
- [E10 QA, telemetry, and launch prep](epics/E10-qa-telemetry-and-launch-prep.md)

Each epic file contains:

- goal
- PM workstream ownership
- repo impact
- story-level acceptance criteria
- engineering task list
- major dependencies

## Suggested Build Order

The original build order is now mostly historical. The highest-value remaining order is:

1. E9 Frontend architecture hardening
2. E3 Mission planner and queue visibility
3. E8 Diagnostics and history
4. E5 Fleet selection and squads
5. E6 Roles and automation policies
6. E7 Commander console
7. E10 QA, telemetry, and launch prep

Why this order now:

- the backend control platform is already largely present
- the biggest risks are integration quality and duplicate frontend state
- commander, roles, and diagnostics depend on shared frontend control data behaving consistently

## Highest-Priority Open Work

- unify command, mission, and selection state across frontend stores
- wire `command:*` and `mission:*` socket events into frontend state as the main update path
- finish mission queue actions end to end: reorder, retry, reprioritize, and interrupt behavior
- complete zone/route authoring and richer map command flows
- wire role policies and autonomy enforcement into mission generation
- align commander frontend/backend contracts and persist history/drafts
- expand frontend and integration test coverage

## High-Risk Dependencies

- E2 depends on E1
- E3 depends on E1 and partial `VoyagerLoop` exposure
- E4 depends on E9 map cleanup and E1 command creation
- E5 depends on E1 and E9 shared selection state
- E6 depends on E3 mission infrastructure and E4 world planning objects
- E7 depends on stable E1 and E3 models
- E10 depends on every previous epic reaching stable interfaces
