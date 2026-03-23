# Telemetry And Ops Visibility

## Goals

- understand operator usage
- debug command and mission failures quickly
- measure whether the revamp improves controllability

## Metrics

### Command metrics

- commands created per type
- command success rate
- command failure rate by type
- median command start latency
- median command completion latency

### Mission metrics

- missions created per type
- mission completion rate
- mission retries per type
- mission blocked rate
- mission cancellation rate

### Fleet metrics

- bots under manual override
- bots with active roles
- squads active per hour
- operators using map commands vs button commands

### Commander metrics

- parse success rate
- confirmation rate
- abandonment rate
- ambiguity prompts triggered

## Logging Guidance

Use the shared logger in `src/util/logger.ts` and log structured fields like:

- `commandId`
- `missionId`
- `bot`
- `squadId`
- `role`
- `markerId`
- `source`

## Dashboard Health Panels

The UI should eventually show:

- commands failing most often
- bots needing attention
- most-used markers and missions
- stuck role assignments
