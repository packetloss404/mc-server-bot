# E4 World Planning And Map Control

## Goal

Make the map a first-class command surface.

## PM Workstream

- PM-04 Spatial Control

## Repo Impact

- `web/src/app/map/page.tsx`
- `web/src/lib/store.ts`
- `web/src/lib/api.ts`
- new backend world-planning services

## Stories

### E4-S1 Refactor map page for extensibility

Acceptance criteria:

- map page stops mutating refs during render
- toolbar state and canvas state are easier to extend

Tasks:

- fix existing render-time ref patterns
- separate canvas renderer from interaction state
- add selected object state and mode state

### E4-S2 Add markers, zones, and routes

Acceptance criteria:

- operators can create, edit, and delete markers, zones, and routes
- objects persist across refreshes

Tasks:

- create `MarkerStore` backend module
- add REST APIs for markers, zones, and routes
- add map drawing tools and editors
- add list or detail panel for world objects

### E4-S3 Add click-to-command and context menus

Acceptance criteria:

- operator can select bot(s) and issue move or guard commands directly from the map
- selected map objects can be reused in missions and roles

Tasks:

- add terrain context menu
- add entity context menu
- connect map actions to command creation
- display command results on map or side panel

## Dependencies

- depends on E9 map cleanup and E1 command creation
