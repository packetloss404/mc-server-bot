# Feature Inventory

This file now tracks both scope and implementation status.

Status legend:

- Implemented - present and broadly working
- Partial - present but incomplete, inconsistent, or not fully wired
- Missing - not meaningfully implemented yet

## Scope Summary

This plan covers the full dashboard control program across six control directions:

- command center
- mission planner
- map-first control
- squad control
- role-based automation
- chat-as-control

## 1. Command Center

Implementation status: partial

### Goals

- let operators intervene instantly
- minimize clicks for common actions
- provide visible command feedback

### Core features

- per-bot quick actions - implemented
- bulk quick actions for selected bots - partial
- command pending/running/success/failure states - partial
- inline feedback and history - partial
- manual override indicators - partial

### Initial command set

- stop current movement
- pause voyager
- resume voyager
- follow player
- walk to coordinates
- move to marker
- return to base
- regroup to selected leader or marker
- guard area
- patrol route
- deposit inventory
- withdraw loadout
- equip best gear
- eat if needed
- unstuck / recover
- clear override

Current notes:

- backend command handlers cover much of this list
- frontend tactical UI currently exposes only a subset cleanly
- `deposit_inventory` is still stubbed

### Future command set

- escort player
- transfer items between bots
- reserve a chest or station
- assist another bot
- scout route
- avoid zone

## 2. Mission Planner

Implementation status: partial

### Goals

- make planned work visible and manageable
- expose queue operations currently hidden inside `VoyagerLoop`
- support interrupt vs append semantics

### Core features

- visible current mission and queued missions - implemented
- mission priorities - partial
- append, prepend, cancel, retry, clear, reorder - partial
- blocked / failed / completed states - partial
- mission templates - missing
- mission dependencies - partial
- per-bot and multi-bot missions - partial

Current notes:

- mission records exist, but UI/history is not fully driven by them yet
- queue management is still split between `MissionManager` and raw Voyager queue access

### Mission types

- gather item(s)
- craft item(s)
- smelt batch
- deposit / withdraw
- move to marker / zone
- escort / follow
- patrol area
- build schematic
- supply chain run
- custom typed mission composed from subtasks

## 3. Map-First Control

Implementation status: partial

### Goals

- make the map a command surface, not just a viewer
- turn world planning into reusable data

### Core features

- click-to-move - partial
- right-click action menu - partial
- drag-to-define zone - missing
- save named markers - implemented
- create patrol routes - partial
- assign mission from a selected map object - missing
- display squad locations, trails, areas, build sites, and danger zones - partial

### World objects

- point markers: `Base`, `Mine`, `Village`, `Storage A`
- zones: circle or rectangle
- routes: ordered waypoints
- build sites
- resource nodes
- hazard zones

Current notes:

- marker/zone/route persistence exists
- route and zone editing UX is still incomplete
- map-first command flows lag behind backend command capabilities

## 4. Squad Control

Implementation status: partial

### Goals

- operate on many bots at once without copy-pasting commands
- support durable teams for shared jobs

### Core features

- multi-select bots - partial
- ad hoc groups from current selection - partial
- named squads - implemented
- squad default roles - missing
- batch commands with per-bot result tracking - partial
- squad missions - partial
- regroup and formation helpers - missing

Current notes:

- squads backend exists and fleet page exists
- selection state is split across multiple frontend stores
- `activeMissionId` on squads still appears unused

### Example squads

- Builders
- Guards
- Miners
- Haulers
- Scouts

## 5. Role-Based Automation

Implementation status: partial

### Goals

- reduce repetitive operator work
- support persistent bot specialization

### Core features

- assign role to bot - implemented
- role configuration panel - implemented
- role home marker - implemented
- allowed / preferred zones - partial
- restock policy - missing
- interruption policy - missing
- autonomy level - partial
- visible role health and status - missing

Current notes:

- CRUD exists, but policy execution and autonomy enforcement are still missing
- overrides are tracked in backend state but not yet surfaced consistently in UI

### Proposed roles

- guard
- builder
- hauler
- farmer
- miner
- scout
- merchant
- free agent

## 6. Chat-As-Control

Implementation status: partial

### Goals

- support fast high-level operator intent
- preserve visibility and safety by turning text into typed plans

### Core features

- command console input - implemented
- parser output preview - partial
- confirmation before execution for impactful actions - implemented
- structured plan display - partial
- execution history - partial
- suggested clarifications for ambiguous inputs - missing

Current notes:

- commander backend and page exist
- frontend/backend response contracts need alignment
- history is currently page-local, not a persistent shared record

### Example prompts

- send all guards to the village
- have Ada smelt all iron and deposit it at Storage A
- pause every codegen bot except builders
- move the builders to Build Site 2 and start the schematic

## 7. Recovery, Diagnostics, and Ops Tooling

Implementation status: partial

### Goals

- make failures actionable
- reduce time spent guessing why a bot is stuck

### Core features

- last command result - partial
- last mission failure and reason - partial
- blocked state explanation - partial
- retry suggestions - missing
- quick recovery actions - partial
- command and mission history - partial
- bot detail diagnostics timeline - missing

Current notes:

- diagnostics and history surfaces exist
- several still rely on activity/task history instead of shared command/mission records

## 8. Saved Routines And Templates

Implementation status: missing

### Goals

- make repeatable control easy

### Core features

- command macros - missing
- reusable mission templates - missing
- preset squad operations - missing
- named loadouts - missing

Current notes:

- only narrow template-like behavior exists today, such as chain templates

### Examples

- Resupply builder
- Guard perimeter
- Smelt all ore
- Harvest wheat loop
- Return inventory to base

## Acceptance Lens

Every feature must answer:

- What object does it create or mutate?
- How does the operator see progress and failure?
- How does it behave when voyager is running?
- Can it be applied to one bot and many bots?
- Can it be triggered from another surface such as the map or commander?
