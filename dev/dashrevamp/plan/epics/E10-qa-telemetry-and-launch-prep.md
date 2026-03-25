# E10 QA, Telemetry, And Launch Prep

Current status: partial

Current-state note:

- backend tests and telemetry are present now
- frontend coverage, cross-feature integration tests, telemetry standardization, and migration cleanup still need work

## Goal

Ship the revamp with enough testing and observability to be credible.

## PM Workstream

- PM-10 QA And Release

## Repo Impact

- new test runner setup
- telemetry instrumentation
- release docs and cleanup

## Stories

### E10-S1 Add test foundations

Status: partial

Acceptance criteria:

- repo has a committed test runner for backend and frontend
- at least the highest-risk control flows are covered

Tasks:

- choose test stack
- add scripts to `package.json` and `web/package.json`
- add first tests for command lifecycle, mission queue, and squad dispatch
- update `AGENTS.md` with real test and single-test commands

### E10-S2 Add telemetry and logging

Status: partial

Acceptance criteria:

- command and mission execution can be measured and debugged

Tasks:

- instrument command and mission metrics
- standardize logger fields
- add operator-facing status insights where useful

### E10-S3 Launch prep and migration cleanup

Status: partial

Acceptance criteria:

- old and new control paths are reconciled cleanly
- key docs are current

Tasks:

- remove redundant ad hoc UI flows after replacement
- finish migration checklists
- document release notes and operator usage guidance

## Dependencies

- depends on every previous epic reaching stable interfaces
