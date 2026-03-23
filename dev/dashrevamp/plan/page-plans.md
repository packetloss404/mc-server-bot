# Page Plans

## Dashboard (`web/src/app/page.tsx`)

### New role

Fleet overview and exception handling surface.

### Add

- fleet summary header
- selected bots bar
- pending command summary
- missions needing attention
- stuck / low health / failed mission highlights
- quick bulk actions

## Bot Detail (`web/src/app/bots/[name]/page.tsx`)

### New role

Deep control page for one bot.

### Add

- upgraded command center
- visible manual override state
- mission queue with reorder and cancel
- command history panel
- diagnostic timeline
- role assignment summary
- nearby marker and zone context

## Map (`web/src/app/map/page.tsx`)

### New role

Primary tactical command surface.

### Add

- selection model
- context menu for entities and terrain
- marker creation mode
- zone draw mode
- route authoring mode
- squad overlays
- active missions layer
- build and supply-chain overlays

## Manage (`web/src/app/manage/page.tsx`)

### New role

Administrative setup page rather than daily control page.

### Keep

- create bot
- delete bot
- mode toggles

### Move out

- ad hoc operational task queueing

## Fleet (`new`)

### Purpose

Operate on many bots at once.

### Features

- filter and select bots
- create squads from selection
- run batch commands
- compare health, state, mission, role, and location

## Roles (`new`)

### Purpose

Assign and configure persistent bot roles.

### Features

- role catalog
- per-bot role assignment
- home markers and allowed zones
- autonomy level
- role health and conflict view

## Commander (`new`)

### Purpose

Power-user control through typed natural language.

### Features

- input console
- parsed plan preview
- warnings and ambiguity prompts
- confirm and execute
- recent commands

## History (`new`)

### Purpose

Audit and recovery center.

### Features

- command history
- mission history
- failure trends
- retry shortcuts

## Build (`web/src/app/build/page.tsx`)

### New role

Specialized mission authoring page for build missions.

### Add

- mission abstraction wrapper
- saved build site markers
- squad assignment integration

## Chains (`web/src/app/chains/page.tsx`)

### New role

Specialized mission authoring page for supply-chain missions.

### Add

- shared mission status cards
- assignment and role awareness
- reusable chain templates integrated with the mission model
