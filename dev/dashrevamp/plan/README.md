# Dashboard Revamp Plan

This folder is the working planning package for the web dashboard control revamp for `mc-server-bot`.

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

- `vision.md` - product goals, personas, and control philosophy
- `features.md` - complete feature inventory and requirements
- `milestones.md` - delivery milestones and acceptance criteria
- `sprints.md` - sprint-by-sprint work plan
- `roadmap.md` - rollout sequence from MVP to advanced control
- `backend-architecture.md` - service and module design for backend control systems
- `frontend-architecture.md` - UI architecture, store evolution, and interaction patterns
- `api-plan.md` - repo-specific REST and Socket.IO plan
- `schemas.md` - domain models and persistence shapes
- `backlog.md` - execution backlog with epics, stories, tasks, and PM-style ownership lanes
- `epics/` - one markdown file per epic for easier execution tracking
- `page-plans.md` - page-by-page screen plan
- `wireframes.md` - low-fidelity text wireframes
- `user-flows.md` - core operator workflows
- `implementation-notes.md` - repo-specific extension points and migration guidance
- `risks-and-open-questions.md` - main risks, tradeoffs, and unresolved decisions
- `testing-strategy.md` - validation plan for control features
- `telemetry.md` - metrics, logging, and operational visibility plan
- `migration-plan.md` - how to move from the current dashboard to the new control platform

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

The repo already includes useful building blocks:

- Per-bot direct commands in `web/src/components/BotCommandCenter.tsx`
- Ad hoc task queueing in `web/src/app/bots/[name]/page.tsx` and `web/src/app/manage/page.tsx`
- A map visualization surface in `web/src/app/map/page.tsx`
- A live store in `web/src/lib/store.ts`
- Polling and socket synchronization in `web/src/components/SocketProvider.tsx`
- Existing mutable bot APIs in `src/server/api.ts`
- A hidden player task queue inside `src/voyager/VoyagerLoop.ts`
- Rich orchestration in `src/build/BuildCoordinator.ts` and `src/supplychain/ChainCoordinator.ts`

The core delivery strategy is to unify these into 4 shared concepts:

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
