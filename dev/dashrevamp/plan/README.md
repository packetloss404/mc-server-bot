# Dashboard Revamp Plan

This folder is the working planning package for the web dashboard control revamp for `mc-server-bot`.

The package started as a forward-looking implementation plan. It now also doubles as a current-state reference.

Read `current-state.md` first if you want to know what is already built versus what is still planned.

It is tailored to the current repo shape:

- Backend control and bot runtime live in `src/`
- Dashboard UI lives in `web/src/`
- Existing control endpoints are concentrated in `src/server/api.ts`
- Live telemetry is emitted from `src/server/socketEvents.ts`
- Current dashboard state is centralized in `web/src/lib/store.ts`
- Existing orchestration already exists in `src/build/BuildCoordinator.ts` and `src/supplychain/ChainCoordinator.ts`

## Planning Goals

- Turn the dashboard into the primary control plane for bots
- Support all requested control directions: command center, mission planner, map-first control, squad control, role automation, and chat-as-control
- Unify these features behind shared control primitives instead of building isolated one-off flows
- Get the work ready for engineering execution with enough detail for backend, frontend, product, and QA

## Planning Package

- `current-state.md` - current implementation health check, milestone checklist, and stale-doc corrections
- `next-sprint.md` - highest-value next slice of work based on the current repo state
- `vision.md` - product goals, personas, and control philosophy
- `features.md` - complete feature inventory and requirements
- `milestones.md` - delivery milestones and acceptance criteria
- `roadmap.md` - rollout sequence from MVP to advanced control
- `frontend-architecture.md` - UI architecture, store evolution, and interaction patterns
- `backlog.md` - execution backlog with epics, stories, tasks, and PM-style ownership lanes
- `epics/` - one markdown file per epic for easier execution tracking
- `user-flows.md` - core operator workflows
- `telemetry.md` - metrics, logging, and operational visibility plan

## Ten PM Workstreams

To "manage the hell out of it," the revamp is split into 10 PM-style workstreams. They are coordination tracks, not required headcount.

1. Control model and command lifecycle
2. Mission planner and queueing
3. Map interactions and world planning
4. Fleet and squad operations
5. Role automation and guardrails
6. Commander console and natural language planning
7. Bot diagnostics, history, and recovery tooling
8. Backend architecture and persistence
9. Frontend state, UX system, and design consistency
10. QA, telemetry, rollout, and release operations

## Current-State Summary

The repo now includes a large portion of the planned control platform:

- shared backend control services under `src/control/`
- command and mission APIs in `src/server/api.ts`
- map world-object persistence and CRUD
- squad, role, and commander backend services
- new dashboard pages for fleet, roles, commander, and history
- frontend tactical components for command, mission queue, and selection UX
- backend control tests and basic telemetry/metrics

The main remaining gap is no longer raw feature absence. It is integration quality:

- frontend state is split across overlapping stores
- command and mission lifecycle sockets are not the primary UI source of truth yet
- several UI panels still use older activity/task data instead of shared control records
- role automation, routines/templates, and some diagnostics flows remain incomplete

The core product model is still organized around 4 shared concepts:

- `Command` - an immediate action applied to one or more bots
- `Mission` - a structured, trackable multi-step objective
- `Marker` - a named location, route, or zone in the Minecraft world
- `Assignment` - a persistent relationship between bots and automation systems such as squads, roles, or routines

## Definition Of Done For Planning

This package is ready for engineering when:

- Backend engineers can start creating modules and endpoints without major product ambiguity
- Frontend engineers can map the screens and state model without re-inventing control concepts
- PM and QA can track scope, milestones, and acceptance criteria
- The plan explains how to evolve the current repo without breaking existing dashboard behavior

For current execution status, use `current-state.md` and the status sections in `features.md`, `milestones.md`, `roadmap.md`, and `backlog.md`.
