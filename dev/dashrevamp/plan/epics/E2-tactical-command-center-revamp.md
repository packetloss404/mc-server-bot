# E2 Tactical Command Center Revamp

## Goal

Turn the current command buttons into a richer, reusable tactical control system.

## PM Workstream

- PM-02 Tactical Controls

## Repo Impact

- `web/src/components/BotCommandCenter.tsx`
- `web/src/app/bots/[name]/page.tsx`
- `web/src/app/page.tsx`
- `web/src/app/manage/page.tsx`

## Stories

### E2-S1 Refactor command center to use shared command API

Acceptance criteria:

- command center no longer relies on page-local loading assumptions only
- per-command status reflects socket lifecycle events

Tasks:

- replace ad hoc `exec()` implementation with command creation + store tracking
- show pending state, active state, success, and failure
- show last command result in bot detail page

### E2-S2 Add high-value quick actions

Acceptance criteria:

- command center includes at least 5 new useful actions beyond pause/stop/follow/walk
- buttons degrade gracefully when unsupported or bot is disconnected

Tasks:

- implement backend command handlers for `move_to_marker`, `return_to_base`, `regroup`, `guard_zone`, `unstuck`
- design button grouping for movement, override, and recovery actions
- add confirmation only for high-impact actions

### E2-S3 Add manual override visibility

Acceptance criteria:

- operator can tell when a bot is under manual control
- the source and age of the override are visible

Tasks:

- extend `BotInstance.getDetailedStatus()`
- add override metadata to bot detail page
- add override indicator to cards or fleet lists

## Dependencies

- depends on E1
