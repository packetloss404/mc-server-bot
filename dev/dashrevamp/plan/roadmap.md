# Delivery Roadmap

This roadmap is now forward-looking from the current repo state, not from a blank revamp starting point.

## Phase 0 - Preparation

- status: completed
- shipped: shared control vocabulary, persistence strategy under `data/`, and core page/service ownership in practice
- note: this phase is historical; the repo has already moved beyond planning-only work

## Phase 1 - MVP Control Platform

- status: mostly completed
- shipped
  - shared command model
  - command lifecycle events on the backend
  - command APIs and legacy endpoint migration
- remaining
  - frontend command history should be fully sourced from shared command records
  - command lifecycle socket handling still needs full frontend adoption

## Phase 2 - Visible Work Planning

- status: partial
- shipped
  - mission models and mission APIs
  - mission queue visibility surfaces on bot detail
- remaining
  - reprioritization/retry controls need full end-to-end behavior
  - unified mission history and interrupt semantics still need polish
  - diagnostics should rely on shared mission/control state instead of mixed sources

## Phase 3 - Spatial Operations

- status: partial
- shipped
  - markers, zones, routes, and CRUD APIs
  - map rendering and marker editing
- remaining
  - richer click-to-command flows
  - zone and route authoring UX
  - map overlays for squads, missions, and hazards/build sites

## Phase 4 - Fleet Operations

- status: partial
- shipped
  - squads backend
  - fleet page and selection bar
  - backend batch command fan-out
- remaining
  - shared selection state across pages
  - backend-backed fleet UX for all squad operations
  - richer squad mission assignment and result tracking

## Phase 5 - Persistent Automation

- status: partial
- shipped
  - role persistence and CRUD
  - roles page and assignment panel
  - autonomy settings and zone/home-marker fields
- remaining
  - policy execution
  - autonomy enforcement
  - loadout/restock/interruption behavior

## Phase 6 - High-Level Control

- status: partial
- shipped
  - commander parse/execute backend
  - commander page with preview/warnings/confirm flow
- remaining
  - resolve API/UI contract drift
  - add persistent commander drafts/history
  - implement command templates and routines

## Phase 7 - Production Hardening

- status: partial
- shipped
  - backend tests for major control services
  - basic telemetry and metrics surfaces
- remaining
  - stronger frontend coverage
  - standardize telemetry/log fields across control services
  - finish duplicated-store and legacy-flow cleanup

## Suggested First Release Boundary

The old release boundary was "after Phase 3." The repo is now beyond that point in raw surface area but not yet fully hardened.

The more realistic current release boundary is after these gaps are closed:

- command/mission lifecycle is fully wired into the frontend
- mission queue controls are fully functional
- fleet selection and roles behave consistently across pages
- commander contracts are aligned
- key diagnostics/history views are based on shared records

That would make the revamp feel cohesive instead of just broadly present.
