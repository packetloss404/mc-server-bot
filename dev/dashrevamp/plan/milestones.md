# Milestones

## Milestone Strategy

Deliver the revamp in layers so each milestone builds reusable infrastructure for the next one.

## M1 - Shared Control Model

### Current status

Mostly implemented

### Outcome

The repo has a unified command model and explicit command lifecycle events.

### Scope

- add control domain types
- create backend command service
- expose command APIs
- emit `command:*` socket events
- add command history and pending state in frontend store
- convert current direct controls to the shared model

### Exit criteria

- direct commands no longer depend on one-off handlers only - done
- per-bot commands emit visible lifecycle updates - partial
- frontend can show pending and completed command states - partial

## M2 - Mission Queue And Planner

### Current status

Partial

### Outcome

Queued work becomes a first-class, inspectable mission system.

### Scope

- add mission domain models
- expose queued player tasks from `VoyagerLoop`
- add queue CRUD and priority operations
- update bot detail page to show queue, history, failures, and interrupt modes

### Exit criteria

- operators can view, add, cancel, reprioritize, and retry missions - partial
- mission state survives refresh and is visible in the UI - partial

## M3 - Spatial Control

### Current status

Partial

### Outcome

Map interactions can create markers, zones, and commands.

### Scope

- marker and zone persistence
- map click actions
- map context menu
- route creation
- marker-aware commands and missions

### Exit criteria

- operator can command a bot or squad from the map - partial
- world objects are reusable across pages - partial

## M4 - Fleet And Squads

### Current status

Partial

### Outcome

Multi-bot control is an intentional product surface.

### Scope

- multi-select model
- named squads
- batch commands
- squad missions
- fleet page and squad detail panel

### Exit criteria

- the operator can issue a single operation to many bots and track partial success - partial

## M5 - Roles And Automation

### Current status

Partial

### Outcome

Bots can hold persistent role assignments with visible policy configuration.

### Scope

- role models and persistence
- role editor UI
- automation policies
- manual override integration

### Exit criteria

- bots can run with durable dashboard-managed roles and visible autonomy state - partial

## M6 - Commander Console

### Current status

Partial

### Outcome

Natural language commands become a safe shell over typed commands and missions.

### Scope

- intent parser service
- preview and confirmation UI
- ambiguity resolution
- execution through shared command and mission services

### Exit criteria

- no natural-language action executes without producing a structured plan first - partial

## M7 - Hardening And Release

### Current status

Partial

### Outcome

The control platform is production-ready for active use.

### Scope

- telemetry and alerting
- QA suite
- docs and operator guides
- cleanup of old control code paths
- performance and lint stabilization in touched areas

### Exit criteria

- feature set is stable enough for real operator workflows - partial
- critical flows are tested - partial
- old and new systems are reconciled cleanly - partial

## Current Priority Gaps

- unify frontend control state and lifecycle subscriptions
- finish mission queue actions and history fidelity
- complete map/fleet/role integrations on top of shared control records
- align commander contracts and persistence
- deepen automated test coverage, especially frontend and cross-feature flows
