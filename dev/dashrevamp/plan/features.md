# Feature Inventory

## Scope Summary

This plan covers the full dashboard control program across six control directions:

- command center
- mission planner
- map-first control
- squad control
- role-based automation
- chat-as-control

## 1. Command Center

### Goals

- let operators intervene instantly
- minimize clicks for common actions
- provide visible command feedback

### Core features

- per-bot quick actions
- bulk quick actions for selected bots
- command pending/running/success/failure states
- inline feedback and history
- manual override indicators

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

### Future command set

- escort player
- transfer items between bots
- reserve a chest or station
- assist another bot
- scout route
- avoid zone

## 2. Mission Planner

### Goals

- make planned work visible and manageable
- expose queue operations currently hidden inside `VoyagerLoop`
- support interrupt vs append semantics

### Core features

- visible current mission and queued missions
- mission priorities
- append, prepend, cancel, retry, clear, reorder
- blocked / failed / completed states
- mission templates
- mission dependencies
- per-bot and multi-bot missions

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

### Goals

- make the map a command surface, not just a viewer
- turn world planning into reusable data

### Core features

- click-to-move
- right-click action menu
- drag-to-define zone
- save named markers
- create patrol routes
- assign mission from a selected map object
- display squad locations, trails, areas, build sites, and danger zones

### World objects

- point markers: `Base`, `Mine`, `Village`, `Storage A`
- zones: circle or rectangle
- routes: ordered waypoints
- build sites
- resource nodes
- hazard zones

## 4. Squad Control

### Goals

- operate on many bots at once without copy-pasting commands
- support durable teams for shared jobs

### Core features

- multi-select bots
- ad hoc groups from current selection
- named squads
- squad default roles
- batch commands with per-bot result tracking
- squad missions
- regroup and formation helpers

### Example squads

- Builders
- Guards
- Miners
- Haulers
- Scouts

## 5. Role-Based Automation

### Goals

- reduce repetitive operator work
- support persistent bot specialization

### Core features

- assign role to bot
- role configuration panel
- role home marker
- allowed / preferred zones
- restock policy
- interruption policy
- autonomy level
- visible role health and status

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

### Goals

- support fast high-level operator intent
- preserve visibility and safety by turning text into typed plans

### Core features

- command console input
- parser output preview
- confirmation before execution for impactful actions
- structured plan display
- execution history
- suggested clarifications for ambiguous inputs

### Example prompts

- send all guards to the village
- have Ada smelt all iron and deposit it at Storage A
- pause every codegen bot except builders
- move the builders to Build Site 2 and start the schematic

## 7. Recovery, Diagnostics, and Ops Tooling

### Goals

- make failures actionable
- reduce time spent guessing why a bot is stuck

### Core features

- last command result
- last mission failure and reason
- blocked state explanation
- retry suggestions
- quick recovery actions
- command and mission history
- bot detail diagnostics timeline

## 8. Saved Routines And Templates

### Goals

- make repeatable control easy

### Core features

- command macros
- reusable mission templates
- preset squad operations
- named loadouts

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
