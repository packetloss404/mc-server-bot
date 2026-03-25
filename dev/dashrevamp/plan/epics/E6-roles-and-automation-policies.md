# E6 Roles And Automation Policies

Current status: partial

Current-state note:

- role persistence, APIs, page, and assignment panel are present
- policy execution, autonomy enforcement, and strong override semantics are still the major unfinished parts

## Goal

Give bots durable, visible dashboard-managed operating roles.

## PM Workstream

- PM-06 Role Automation

## Repo Impact

- new role service and APIs
- new roles page
- updates to bot detail and fleet views

## Stories

### E6-S1 Add role assignment data model

Status: mostly done

Acceptance criteria:

- role assignments match the schema plan
- each bot can have a visible role and autonomy level

Tasks:

- create `RoleManager`
- persist role assignments to `data/roles.json`
- add CRUD APIs

### E6-S2 Add role management UI

Status: partial

Acceptance criteria:

- operator can assign role, home marker, allowed zones, and autonomy level without leaving the dashboard

Tasks:

- create roles page
- add role assignment editor to bot detail page
- show role summaries on dashboard/fleet cards

### E6-S3 Add policy execution and override rules

Status: missing

Acceptance criteria:

- role-generated work is visible as missions
- manual override semantics are respected

Tasks:

- define arbitration rules between role missions and manual commands
- generate role-origin missions through `MissionManager`
- add visible badge for role-generated missions

## Dependencies

- depends on E3 mission infrastructure and E4 world planning objects
