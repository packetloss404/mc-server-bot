# Product Vision

## Vision Statement

Transform the dashboard from a monitoring panel into a real-time operations console for managing autonomous Minecraft bots individually and as a fleet.

The dashboard should let an operator do three things well:

- Understand what every bot is doing and why
- Intervene quickly with safe, visible control tools
- Compose bigger coordinated behaviors without dropping into code or raw backend calls

## Product Principles

### Human intent, bot execution

Operators should specify intent at the right altitude. The system should support:

- direct commands for urgent tactical actions
- structured missions for repeatable work
- automation policies for steady-state behavior
- natural-language planning for power users

### Visible autonomy

The dashboard must not feel magical or opaque. Every important bot action should reveal:

- what was requested
- what is executing now
- what is queued next
- what failed
- what the bot needs to recover

### Manual override is sacred

If a human says "do this now," the system should have a clear override model. Autonomy should resume only when the operator wants it to.

### One control model, many surfaces

Map clicks, quick actions, role automations, squad commands, and chat commands should all land on the same backend command and mission systems.

### Safety over cleverness

The system should prefer explicit, reviewable command plans over opaque execution. Especially for multi-bot, destructive, or player-facing operations.

## Primary Personas

### Solo operator

- Runs 1-3 bots
- Wants quick tactical control and visibility
- Cares about easy recovery, movement, and chat interactions

### Fleet operator

- Runs many bots with different roles
- Wants batch control, squads, queues, and automation rules
- Needs status summaries and exception management

### Builder / world organizer

- Coordinates build sites, chests, routes, and shared tasks
- Needs map-first controls, markers, zones, and resource movement

### Power user / AI tinkerer

- Wants high-level command authoring and natural-language planning
- Cares about history, diagnostics, and command transparency

## Product Pillars

### 1. Tactical control

Fast actions like follow, stop, regroup, move, return home, deposit inventory, or unstick a bot.

### 2. Structured execution

Tasks and missions should be explicit objects with state, ownership, retries, and visibility.

### 3. Spatial control

Minecraft is spatial. Markers, zones, routes, and map interactions should become first-class.

### 4. Fleet operations

Multi-bot work should feel intentional, not stitched together from single-bot actions.

### 5. Automation with guardrails

Persistent roles and routines should reduce micromanagement without hiding behavior.

## Success Criteria

The revamp is successful if the dashboard can support all of these without leaving the UI:

- move a bot or squad to a meaningful destination
- queue, inspect, reprioritize, and cancel work
- define places and areas in the world and reuse them across workflows
- assign bots to stable operating roles
- recover bots that are stuck or interrupted
- issue a typed or natural-language command and see a structured execution plan

## Non-Goals For The Initial Revamp

- replacing the entire voyager/autonomy system
- building a full RTS combat AI layer
- introducing multiplayer operator auth or permissions beyond simple admin assumptions
- solving every gameplay primitive before the control model exists

## Product Thesis

This repo becomes much more valuable when the dashboard stops being a pretty status view and becomes the operating system for the bots.
