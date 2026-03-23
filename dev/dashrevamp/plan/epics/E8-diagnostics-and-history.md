# E8 Diagnostics And History

## Goal

Make the dashboard trustworthy when bots fail or behave unexpectedly.

## PM Workstream

- PM-08 Diagnostics

## Repo Impact

- bot detail page
- new history page
- event and command storage

## Stories

### E8-S1 Add command and mission history views

Acceptance criteria:

- operator can inspect recent command and mission activity across bots
- history can be filtered by bot, type, and status

Tasks:

- create history page
- add command history queries
- add mission history queries

### E8-S2 Add blockers and recovery suggestions

Acceptance criteria:

- bot detail page shows why the bot is stuck and what actions are suggested

Tasks:

- expose blocker context from voyager-related services
- show last failure, blocked reason, and suggested actions
- add retry and unstuck shortcuts

## Dependencies

- benefits from E1 and E3, but can start once those interfaces are stable
