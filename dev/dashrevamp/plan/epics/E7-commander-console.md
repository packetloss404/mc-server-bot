# E7 Commander Console

Current status: partial

Current-state note:

- commander parse/execute backend and UI are implemented
- the biggest remaining work is contract alignment, persistent history/drafts, and stronger ambiguity handling

## Goal

Support natural language planning without losing transparency or safety.

## PM Workstream

- PM-07 Commander

## Repo Impact

- new commander page
- parser backend service
- command and mission preview models

## Stories

### E7-S1 Add parse-only planner endpoint

Status: mostly done

Acceptance criteria:

- free text returns a typed plan preview without executing
- warnings and confidence are visible

Tasks:

- implement `CommanderService.parse`
- add `POST /api/commander/parse`
- map intents to command and mission records

### E7-S2 Add commander UI

Status: partial

Acceptance criteria:

- operator can edit, confirm, or cancel a proposed plan
- execution goes through the normal command and mission services

Tasks:

- create commander page
- add preview panel and warning UI
- add execution history and drafts

### E7-S3 Handle ambiguity and safety

Status: partial

Acceptance criteria:

- ambiguous or risky commands require clarification or confirmation
- safe simple commands can still feel fast

Tasks:

- define ambiguity rules
- define destructive-action confirmations
- add structured warning list to plan object

## Dependencies

- depends on stable E1 and E3 models
