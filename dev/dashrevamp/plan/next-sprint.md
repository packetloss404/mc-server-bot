# Next Sprint Plan

This sprint plan is derived from `current-state.md` and the updated milestone backlog.

Goal: make the revamp feel coherent end to end, not just broadly present.

## Sprint Outcome

By the end of this sprint:

- command and mission lifecycle state should update the UI from shared records
- mission queue actions should work for real
- selection state should behave consistently across dashboard, fleet, and map
- commander and role flows should stop drifting from backend contracts

## Priority 1 - Frontend Control State Unification

Why:

- this is the biggest blocker for tactical UI, diagnostics, fleet UX, and commander polish

Targets:

- consolidate overlapping state in `web/src/lib/store.ts`, `web/src/lib/controlStore.ts`, and `web/src/lib/missionStore.ts`
- make one source of truth for:
  - selected bots
  - pending/active/completed commands
  - mission records and queue state
  - override state

Definition of done:

- dashboard, bot detail, fleet, and map use the same selection and command/mission state

## Priority 2 - Socket-Driven Command And Mission Updates

Why:

- the backend already emits lifecycle events, but the frontend still falls back to older polling/data paths too often

Targets:

- wire `command:*` and `mission:*` event families into `web/src/components/SocketProvider.tsx`
- normalize events into the shared frontend store
- update tactical views to render from shared records instead of ad hoc activity/task history where possible

Definition of done:

- creating or updating a command/mission is reflected in the UI without manual refresh or custom page-local state

## Priority 3 - Mission Queue End-To-End Actions

Why:

- queue visibility exists, but the revamp still lacks trustworthy queue control

Targets:

- make `MissionQueuePanel` controls functional for retry, cancel, reorder, and priority changes
- align queue APIs and UI behavior around actual mission records where possible
- expose clearer blocked/failure reasons and interrupt semantics

Definition of done:

- an operator can view and mutate queue order/work state from the bot detail surface with predictable results

## Priority 4 - Fleet Selection Consistency

Why:

- multi-bot UX exists but is fragmented because state is split across pages/stores

Targets:

- unify selection across dashboard, fleet, and map
- ensure `FleetSelectionBar` reflects the same selection everywhere
- align batch command UX with backend fan-out results

Definition of done:

- selecting bots on one control surface immediately carries to the others

## Priority 5 - Commander And Role Integration Cleanup

Why:

- both features exist, but they are not yet dependable enough to treat as finished surfaces

Targets:

- align commander parse/execute frontend contracts with backend responses
- persist commander history or draft state beyond page-local memory
- fix role assignment update/delete flow mismatches
- start wiring role policy execution through `MissionManager`

Definition of done:

- commander preview/execute works cleanly, and roles no longer feel CRUD-only

## Stretch Goals

- add zone editor and route authoring UX on the map
- replace history/activity fallbacks with true command/mission record views
- add regression tests for commander, fleet selection, and mission queue actions

## Suggested Task Order

1. unify frontend stores
2. wire `command:*` and `mission:*` socket handlers
3. make mission queue actions real
4. unify selection across dashboard/fleet/map
5. fix commander contracts and role assignment flow
6. add focused tests for the new shared flows
