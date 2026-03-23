# Testing Strategy

## Current Constraint

The repo currently has no committed test runner or single-test workflow. The revamp should introduce tests alongside the control platform work.

## Test Priorities

### Backend

- command validation
- command lifecycle transitions
- mission queue operations
- squad dispatch behavior
- role arbitration with manual override
- marker and zone persistence

### Frontend

- store reducers and slices
- command center interactions
- mission queue UI behavior
- map context menu actions
- commander parse and confirm flow

### Integration

- REST mutation -> socket event -> store update
- mission creation -> queue visibility -> completion update
- squad batch command with partial failure

## Suggested Test Stack

- backend: `vitest` for unit tests
- frontend: `vitest` + React Testing Library
- end-to-end: Playwright for key operator flows

## First Critical Scenarios

1. issue command and receive success lifecycle
2. queue mission and reprioritize it
3. create marker and use it in a command
4. create squad and dispatch batch move
5. assign role and verify manual override wins
6. parse natural-language command into typed preview

## Single-Test Workflow To Add

When tests are introduced, add scripts such as:

- `npm run test`
- `npm run test -- CommandCenter`
- `npm run test -- --runInBand path/to/spec`
- `npm run test --prefix web -- MissionQueuePanel`

Update `AGENTS.md` when the actual runner is chosen.
