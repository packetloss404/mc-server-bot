# Implementation Backlog

This backlog translates the planning package into execution-ready epics, stories, and engineering tasks for this repo.

## Operating Model

The program is split into 10 PM-style workstreams. These are planning lanes that can be owned by one person or shared across a small team.

| PM | Workstream | Primary Outcome | Main Docs |
|---|---|---|---|
| PM-01 | Control Platform | Shared command lifecycle and backend control foundation | `backend-architecture.md`, `api-plan.md`, `schemas.md` |
| PM-02 | Tactical Controls | Upgraded command center and manual override UX | `features.md`, `page-plans.md` |
| PM-03 | Mission Planner | Visible queueing, planning, retries, and task history | `features.md`, `milestones.md` |
| PM-04 | Spatial Control | Markers, zones, routes, and map-first control | `page-plans.md`, `wireframes.md` |
| PM-05 | Fleet Ops | Multi-select, squads, and batch operations | `features.md`, `user-flows.md` |
| PM-06 | Role Automation | Persistent roles, policy settings, and override rules | `schemas.md`, `frontend-architecture.md` |
| PM-07 | Commander | Natural language planning and confirmation workflows | `vision.md`, `user-flows.md` |
| PM-08 | Diagnostics | History, blockers, recovery, and operator confidence | `telemetry.md`, `features.md` |
| PM-09 | Frontend System | Store, socket, and component architecture cleanup | `frontend-architecture.md`, `implementation-notes.md` |
| PM-10 | QA And Release | Tests, telemetry, rollout, and migration | `testing-strategy.md`, `migration-plan.md` |

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

1. E1 Shared control platform
2. E9 Frontend architecture hardening
3. E2 Tactical command center revamp
4. E3 Mission planner and queue visibility
5. E4 World planning and map control
6. E5 Fleet selection and squads
7. E6 Roles and automation policies
8. E8 Diagnostics and history
9. E7 Commander console
10. E10 QA, telemetry, and launch prep

## High-Risk Dependencies

- E2 depends on E1
- E3 depends on E1 and partial `VoyagerLoop` exposure
- E4 depends on E9 map cleanup and E1 command creation
- E5 depends on E1 and E9 shared selection state
- E6 depends on E3 mission infrastructure and E4 world planning objects
- E7 depends on stable E1 and E3 models
- E10 depends on every previous epic reaching stable interfaces
