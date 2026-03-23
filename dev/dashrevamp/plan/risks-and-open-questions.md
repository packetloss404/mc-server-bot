# Risks And Open Questions

## Key Risks

### 1. Control model fragmentation

If quick actions, missions, map commands, and commander plans all create their own object types, the product will become difficult to reason about.

### 2. Voyager conflict semantics

Manual commands, role automation, and autonomous voyager behavior can collide. Arbitration rules must be explicit.

### 3. API sprawl in `src/server/api.ts`

Without service extraction, the backend will become harder to maintain and review.

### 4. Map complexity

The map page is already dense. Adding editing, selection, and command modes without refactoring could make it unstable.

### 5. Lack of tests

The repo currently has no committed test runner or test suites. This raises regression risk for a feature-heavy revamp.

## Product Questions

- What actions should always interrupt current work?
- Which actions need explicit confirmation?
- Should commanders be able to execute immediately for safe commands?
- How much persistence should mission history have?
- Should squads have durable defaults beyond member lists?

## Technical Questions

- How should command cancellation behave for long-running Mineflayer actions?
- How much of mission state should live in `VoyagerLoop` vs an external mission manager?
- Should markers and zones be global only, or can bots have private ones?
- Should role-generated missions appear identically to operator-created missions?

## Recommended Defaults

- manual command interrupts current movement and queued automation only when marked `urgent`
- commander always previews before execute unless command is trivially safe
- role-generated missions are visible but visually differentiated
- markers and zones are global in v1
