# Milestones

## Milestone Strategy

Deliver the revamp in layers so each milestone builds reusable infrastructure for the next one.

## M1 - Shared Control Model

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

- direct commands no longer depend on one-off handlers only
- per-bot commands emit visible lifecycle updates
- frontend can show pending and completed command states

## M2 - Mission Queue And Planner

### Outcome

Queued work becomes a first-class, inspectable mission system.

### Scope

- add mission domain models
- expose queued player tasks from `VoyagerLoop`
- add queue CRUD and priority operations
- update bot detail page to show queue, history, failures, and interrupt modes

### Exit criteria

- operators can view, add, cancel, reprioritize, and retry missions
- mission state survives refresh and is visible in the UI

## M3 - Spatial Control

### Outcome

Map interactions can create markers, zones, and commands.

### Scope

- marker and zone persistence
- map click actions
- map context menu
- route creation
- marker-aware commands and missions

### Exit criteria

- operator can command a bot or squad from the map
- world objects are reusable across pages

## M4 - Fleet And Squads

### Outcome

Multi-bot control is an intentional product surface.

### Scope

- multi-select model
- named squads
- batch commands
- squad missions
- fleet page and squad detail panel

### Exit criteria

- the operator can issue a single operation to many bots and track partial success

## M5 - Roles And Automation

### Outcome

Bots can hold persistent role assignments with visible policy configuration.

### Scope

- role models and persistence
- role editor UI
- automation policies
- manual override integration

### Exit criteria

- bots can run with durable dashboard-managed roles and visible autonomy state

## M6 - Commander Console

### Outcome

Natural language commands become a safe shell over typed commands and missions.

### Scope

- intent parser service
- preview and confirmation UI
- ambiguity resolution
- execution through shared command and mission services

### Exit criteria

- no natural-language action executes without producing a structured plan first

## M7 - Hardening And Release

### Outcome

The control platform is production-ready for active use.

### Scope

- telemetry and alerting
- QA suite
- docs and operator guides
- cleanup of old control code paths
- performance and lint stabilization in touched areas

### Exit criteria

- feature set is stable enough for real operator workflows
- critical flows are tested
- old and new systems are reconciled cleanly
