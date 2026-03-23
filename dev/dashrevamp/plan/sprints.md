# Sprint Plan

## Sprint 1 - Control Foundations

### Theme

Create the shared control language.

### Deliverables

- `Command` domain model
- `CommandCenter` backend module
- initial command persistence shape
- command history API
- socket command lifecycle events
- frontend command status store slice

### Engineering notes

- start by wrapping existing endpoints in `src/server/api.ts`
- do not replace `BuildCoordinator` or `ChainCoordinator` yet

## Sprint 2 - Quick Actions And Manual Override

### Theme

Upgrade tactical control.

### Deliverables

- refactor `web/src/components/BotCommandCenter.tsx`
- add quick actions beyond current stop/follow/walk
- display pending and result states
- add manual override state in bot detail

### Risks

- direct command semantics may conflict with voyager execution

## Sprint 3 - Mission Queue

### Theme

Expose and manage queued work.

### Deliverables

- surface queue state from `src/voyager/VoyagerLoop.ts`
- mission API and store slice
- mission queue panel on bot detail page
- queue management controls

### Risks

- player task decomposition happens asynchronously today and will need visible intermediate states

## Sprint 4 - Markers, Zones, And Map Actions

### Theme

Make world planning persistent and actionable.

### Deliverables

- marker CRUD APIs
- zone CRUD APIs
- map creation/edit UI
- click-to-command flow
- route authoring

### Risks

- `web/src/app/map/page.tsx` already has lint and ref-pattern issues; expect cleanup work before major feature additions

## Sprint 5 - Fleet And Squads

### Theme

Add group operations.

### Deliverables

- bot selection model
- squad storage
- batch command execution
- fleet page
- squad summaries and result tracking

## Sprint 6 - Roles And Policies

### Theme

Move from manual operation to sustainable automation.

### Deliverables

- role assignments
- role editor page
- policy evaluation loop
- home markers and allowed zones
- override semantics between role automation and manual missions

## Sprint 7 - Commander Console

### Theme

Natural language planning with safety.

### Deliverables

- parser service
- plan preview model
- confirm/execute UI
- command and mission generation from text

## Sprint 8 - Hardening And Launch Prep

### Theme

Stabilize and document.

### Deliverables

- tests for command and mission flows
- telemetry dashboards
- migration cleanup
- operator docs and demo flows
- final bug scrub
