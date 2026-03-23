# Migration Plan

## Goal

Introduce the new control platform without breaking existing dashboard flows.

## Step 1 - Preserve Existing UI Behavior

Keep current pages functional while new shared services are introduced.

## Step 2 - Wrap Existing Endpoints

Refactor existing endpoints like:

- `POST /api/bots/:name/task`
- `POST /api/bots/:name/pause`
- `POST /api/bots/:name/resume`
- `POST /api/bots/:name/stop`
- `POST /api/bots/:name/follow`
- `POST /api/bots/:name/walkto`

so they use shared command or mission services under the hood.

## Step 3 - Add New Frontend Store Slices

Add new control slices without deleting existing telemetry slices.

## Step 4 - Upgrade Existing Pages In Place

- extend bot detail first
- extend dashboard second
- refactor map third

This keeps high-value surfaces moving while preserving operator familiarity.

## Step 5 - Introduce New Pages

Add Fleet, Roles, Commander, and History after the shared control model is stable.

## Step 6 - Reconcile Build And Chain Pages

Keep them live, but hook them into the mission model so they become first-class mission types.

## Step 7 - Remove Redundant Ad Hoc Logic

Once new control surfaces are proven:

- reduce page-specific mutation logic
- remove duplicated command states
- centralize history and lifecycle handling

## Rollback Posture

If new control features are unstable, retain compatibility by allowing old direct endpoints and existing pages to continue operating independently while fixes land.
