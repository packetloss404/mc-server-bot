# Changelog

All notable changes to DyoBot are documented in this file.

---

## 2026-07-02

### Features — Rail & bunker
- **Town↔island-HQ rail link complete** — Finished the hub-and-spoke rail tunnel under Hollybrook: a 5-tall lit corridor (floor Y=51, track Y=52) with `powered_rail` every 8 blocks, a central hub at `(1700, 51, 180)`, a terminus station, and per-building vertical risers back to the shared corridor. Includes a terrain nearest-probe fix and a bunker spur cart route from the town hub into the sub-bunker vestibule. Documented in `docs/RAILWAY.md`.
- **Grand staircase entrances** — Replaced the old 1×1 riser shafts with 5 grand stone-brick staircases (red-carpet landings, lantern-lit, arched beside the track) plus 4 kiosk heads over the surviving ladder shafts (`docs/RAILWAY.md`, Hollybrook cleanup).

### Documentation
- **Bunker ground-truth audit** — `docs/BUNKER.md` / `docs/BUNKER-MAP.md` correct the earlier "furnished shelter" assumption: the outpost at `(1226, 51, 524)` is a half-finished natural cave shaft (drained 2026-07-01, diamond-block plug left in place), not a built bunker with rooms or rails.

---

## 2026-07-01

### Performance
- **Cut 24/7 LLM burn ~88%** — Reduced always-on LLM cost with a daily budget guardrail and a stranded-bot rescue path.

### Bug Fixes
- **Stop night-shelter dragging the fleet to the HQ zone** — Night-shelter behavior no longer pulls the whole fleet off-task; town buildout fixes alongside.

---

## 2026-06-30

### Features
- **Dashboard telemetry** — Emit per-bot stats/armor/combat state and add a town resource-demand view.

### Bug Fixes
- **Per-bot movement leash** — Keep a caretaker bot pinned to its island instead of wandering.
- **Footprint-aware site selection** — Stop buildings stacking on each other; avoid-aware fallback when no flat site qualifies.
- **Town supply-task hygiene** — Dedup supply tasks (stop unbounded blackboard accumulation), locale-aware position bias when claiming, location-aware supply tasks, and stop routing food gathers as "eat".
- **Voyager guards** — Teach ActionAgent to guard find-then-mine lookups; reject empty-name primitive calls at runtime.
- **Web GUI audit pass** — Remove dead code, fix contract bugs and stale copy, add the supply-queue view.

---

## 2026-06-29

### Bug Fixes
- **Recover zombie disconnects** — Detect and recover bots stuck in a half-disconnected state; break the perpetual iron-explore loop.
- **Per-task LLM routing** — Wire up per-task provider/model routing and repair provider/model API mismatches.

---

## 2026-06-18

### Features
- **Runtime-switchable Minecraft server** — Change the target server at runtime via a new Settings "Server" tab.
- **Walkable stair risers + enclosed-building links** — Building risers are now walkable; footprints persist to the town registry. Town rail-network connector now sources from completed build jobs.

---

## 2026-06-17

### Refactor — API + Town decomposition
- **`api.ts` decomposition** — Split the monolithic `createAPIServer` into focused route modules under `src/server/routes/` (bots, build/tunnel, terrain, schematics, supply-chains, metrics/civilization, missions/commands, commander, control platform (markers/zones/routes/squads/roles), campaigns, routines/templates, runtime-config, skill-library, Java-plugin event relay, Town Builder + `requireMayor`), with shared helpers lifted to `routes/helpers.ts`. Removed imports left unused after the split.
- **TownManager repositories** — Decomposed `TownManager` into per-domain repositories (Building, District, Disaster, Chronicle, StyleObservation, Relationship, Approval) with shared row helpers (`rows.ts`). Consolidated ApprovalManager's second DB connection into TownManager.
- **Build-engine extractions** — Extracted `GatherPlanner` and `SchematicStore` from `BuildCoordinator`.

### Bug Fixes
- **Security + crash-safety hardening (Phase 1)** — Hardened the API surface and crash-safety paths.
- **Town DB migrations** — Version-gated migrations via `user_version`; wrap `deleteBuilding`'s two deletes in a transaction; ApprovalManager awaits rehydration before firing handlers.
- **Build/supply stability** — Rewire ChainCoordinator to worker IPC with a double-exec guard; cancel timed-out site-prep instead of digging on; require explicit confirm to carve the hard-coded tunnel; holes-only verify-repair (stop reverting player edits); keep paused builds paused across restart; make `clearSite` respect the mining geofence; idempotent child-town founding.

### Documentation
- Added the staff-engineer repo review + working notes (`REPO_REVIEW.md`, `REPO_REVIEW_NOTES.md`).

---

## 2026-06-01

### Documentation
- **README rewrite** — Rewrote `README.md` to reflect actual implemented features from a code-grounded audit.

---

## 2026-05-28

### Bug Fixes — Stability & memory
- **Unbounded-growth caps** — GC terminal blackboard tasks (and drop deep-clone on read); FIFO-cap `exploredChunks` at 50000; cap reputation events at 5000 with hourly auto-decay; evict terminal build jobs from in-memory maps after a 1h grace; global blackboard GC loop independent of town state; 60s memory-usage diagnostics with per-collection sizes.
- **Town-build resilience** — Per-kind build-failure backoff in TownBrain; persist the brain paused flag; relax SiteSelector flatness and enable clearSite/snapToGround for town builds; raise SiteSelector budgets to fit town-scale schematics; pick the closest connected bot as the probe; cascade-delete `style_observations` on `deleteBuilding`.
- **Voyager** — Tolerate any direction shape in `exploreUntil`; suppress LLM-proposed tasks with strong blockers; seed auto-flat site spiral at the caller origin.

---

## 2026-05-26

### Bug Fixes — Overnight stability
- **Unattended uptime** — Bump `maxReconnectAttempts` 30→1000 for overnight uptime; disable always-on cognition timers to stop the keepalive bounce.
- **Town↔build linkage** — Reconcile building rows on `build:completed` so linkage survives restart; bound the `startBuild` pre-job phase so site-selection can't freeze the tick loop; wire town↔build linkage so auto-builds can't deadlock.

---

## 2026-05-25

### Features
- **Town-build resilience + tunnel tooling** — Town-build resilience improvements, mining geofence, and cleanup + tunnel tooling.

---

## 2026-05-24

### Security
- **Bot impersonation detection** — When someone logs in under a bot's username, Minecraft kicks the real bot with a duplicate-login reason. The bot now recognizes that kick, **quarantines itself** (new `BotState.QUARANTINED`, stops the reconnect tug-of-war), and alerts via the dashboard activity feed + log, optional in-game chat broadcast, and an optional Discord/Slack webhook (`IMPERSONATION_ALERT_WEBHOOK`). A corroborating "ghost name online" signal catches it when another bot sees the impostor. New: `GET /api/security/impersonation`, `POST /api/bots/:name/quarantine/release`, `security.impersonationDetection` config (on by default).

### Features — Project Sid concepts (flag-gated, OFF by default)
Inspired by *Project Sid: Many-agent simulations toward AI civilization* (arXiv:2411.00114). See `docs/project-sid-roadmap.md`. All behavior-changing features are gated and default off; the codebase is a verified no-op with every flag at its default.
- **P1 — Civilization metrics + emergent roles** (read-only, on): infers each bot's role from its action tallies (`GET /api/bots/:name/observed-role`) and reports role-distribution entropy, action exclusivity, and cumulative unique items (`GET /api/metrics/civilization`) with a dashboard card.
- **P2 — Governance that bites** (`governance.enabled`): mayor decrees persist as standing town rules that bias task scoring and are injected into resident prompts; bots propose rules through the existing approval/vote workflow. New: `GET /api/towns/:id/rules`, `POST /api/towns/:id/propose-rule`.
- **P3 — Culture & social spread** (`social.botAffinity`, `social.culture`): bot↔bot affinity edges gate cooperation (declining disliked peers); emergent keyword "memes" adopted from trusted peers bias ambient chat + goals. Added a main-thread `BotComms` relay so inter-bot messages cross worker threads. New: `GET /api/culture`.
- **P4 — PIANO cognition** (`cognition.perceptionTick`, `cognition.cognitiveController`): an independent perception tick + per-bot `AgentState` so threats are perceived mid-task; a `CognitiveController` emits a structured decision broadcast so chat coheres with the current action.

### Maintenance
- **Document systemd deployment** — `CLAUDE.md` now documents the `dyobot` (3001) + `dyobot-web` (3000) services, log paths, and the IPv6 `next-server` lsof caveat, replacing the old foreground-run notes.
- **Tests** — ~110 unit tests added across the security and Project Sid modules (394 total, green).
- Snapshot the learned skill library; add the small-medieval-town-hall schematic.

---

## [Unreleased] — 2026-03-25

### Bug Fixes
- **Fix player task responsiveness** — Player chat tasks now interrupt autonomous tasks instead of queuing behind them. Auto-resumes voyager loop if paused. Removed task decomposition for chat requests (was turning "scout for an island" into "mine logs → craft planks → craft boat").
- **Fix memory leaks in BotInstance** — Reflection interval, pendingConnectTimeout, reconnectTimer now cleared on disconnect. BotComms listener unregistered. Duplicate message listeners on reconnect prevented. Chat cooldown map cleared. Inventory debounce timer cleared. EventEmitter listeners cleaned up.
- **Fix container/furnace never closing on error** — All container and furnace operations now use try-finally to guarantee close() runs even on exceptions.
- **Wire up affinity system** — `onHit()` now fires when players attack bots (affinity penalty). `isHostile()` checked before auto-attacking players. `onGift()` callback added to giveItem action.
- **Fix file write race conditions** — Added 2-second debounced writes with atomic temp-file-then-rename to BlackboardManager, AffinityManager, SocialMemory, StatsTracker, BlockerMemory, and WorldMemory. Added shutdown flush chain from index.ts through all managers.
- **Fix walkTo race condition** — Added `finished` guard to prevent double promise resolution. Added `pathfinder.stop()` on noPath. Proper listener cleanup.
- **Fix attack.ts double resolve** — Added `finished` guard in `finish()` to prevent multiple resolve/reject calls from concurrent code paths.
- **Fix path traversal vulnerability** — Schematic filename validation now rejects `..`, `/`, `\` in GET and POST endpoints.
- **Fix override expiry never checked** — `checkOverrideTimeouts()` now runs on 30-second interval in RoleManager.
- **Fix voyager pause flag desync** — Replaced boolean `voyagerPausedByInstinct` with Set-based `pauseReasons` system. `forceResume()` clears all reasons for player/dashboard overrides.
- **Fix squad mission resolution** — Missions with `assigneeType: 'squad'` now resolve squad IDs to actual bot names. `cancelMission()` also resolves correctly. Empty squads fail immediately instead of creating zombie missions.
- **Fix multi-bot mission progress** — Progress check now waits for ALL assignees to complete instead of completing on first bot finish.
- **Fix inventory listener crash on startup** — Moved `inventory.on('updateSlot')` into spawn handler since mineflayer inventory isn't available until after spawn.
- **Fix bot-to-bot message loop risk** — Tightened keyword detector to require direct request phrases ("please", "can you", etc.) to avoid matching status chatter.
- **Auto-cleanup build bots** — Bots created specifically for a build job are automatically removed when the build completes.

### Features
- **Personality-specific task selection** — Each personality type (farmer, merchant, builder, guard, explorer, blacksmith, elder) now has a weighted task pool. 65% chance to pick personality-appropriate tasks before falling back to generic progression.
- **Emotional state drives behavior** — Bot mood now affects ambient chat frequency: lonely bots chat more (5-10 min), annoyed bots chat less (20-40 min), scared bots are quiet (15-30 min). Idle detection triggers `idle_long` → lonely mood after 10 minutes of no interaction.
- **Bot-to-bot task coordination** — Bots can now process incoming inter-bot messages and queue tasks from direct requests (e.g., "can you mine some iron").
- **Event-driven socket updates** — Position, health, state, and inventory changes now emit immediately via EventEmitter instead of relying solely on 2-second polling. Polling interval reduced to 10-second fallback.
- **Dashboard control platform consolidation** — Unified frontend command/mission state, normalized dashboard API contracts, and live `command:*` / `mission:*` socket updates now drive tactical UI state more consistently.
- **Mission and history UX upgrade** — Mission queue actions now support real retry/cancel/reorder behavior, and history/commander surfaces are tied more closely to shared command and mission records.
- **Fleet, roles, and commander polish** — Fleet actions now use shared commands, role management supports override visibility and policy fields, and commander drafts/history persist locally with richer execution audit views.
- **Map-first control expansion** — Map supports marker/zone/route creation and editing, selected-object actions for missions and commands, squad and mission overlays, and canvas-level selection for more world objects.

### Maintenance
- **Planning docs refreshed** — Updated `dev/dashrevamp/plan/` with current-state health checks, milestone/epic status, and next-sprint guidance.
- **Frontend tests expanded** — Replaced placeholder web tests with shared control store/helper coverage and added more tactical control assertions.

### Performance
- **Trim ActionAgent prompt** — Consolidated duplicate rules sections, ~60% line reduction.
- **Trim Critic prompt** — Reduced examples from 11 to 5 covering distinct evaluation patterns.

---

## 2026-03-24

### Maintenance
- Add `diagnostics/` to .gitignore.

---

## 2026-03-23

### Bug Fixes
- Fix OOM on schematic loading: skip parsing for large files, add volume guard (max 2M voxels, 10MB file size).
- Increase Node heap to 8GB, raise schematic limits, add file size guard.
- Restore missing social memory, bot comms, and players API endpoints.
- Restore build/schematic/chain endpoints lost during dashboard revamp merges.
- Guard marker.position access for markers with missing position data.
- Fix duplicate /fleet nav item and null guard on pendingCommands.targets.
- Fix runtime guards for persisted data with missing fields in metrics.
- Fix Phase 3 integration: resolve merge conflicts and type errors.
- Fix Phase 2 frontend integration: restore build/chain store, fix map/role type refs.
- Fix remaining merge conflict markers across control services.
- Fix CommanderService merge conflicts and duplicate log lines.

### Features — Dashboard Revamp (Phases 1-4)
- **Phase 4**: QA, telemetry, polish, and launch prep. Comprehensive tests, health endpoint, standardized logging, graceful shutdown.
- **Phase 3**: Visual schematic placement with inline mini-map, footprint preview, and click-to-place. Map rendering polish, keyboard shortcut help. Fleet batch operations, empty states, squad management UX.
- **Phase 2**: Commander page with natural language input, plan preview, and execution. Mission queue panel, command history panel, history page. Role badges on bot cards, build/chain connected to missions. Squad overlays, mission indicators, build site overlay on map. Manual override tracking, role-command integration, override UI.
- **Phase 1**: CommandCenter service with dispatch, persistence, and endpoint migration. MissionManager with lifecycle tracking and VoyagerLoop bridge. MarkerStore with CRUD, persistence, and world planning endpoints. SquadManager with CRUD and squad endpoints. RoleManager with CRUD, persistence, and role endpoints. CommanderService with NL parsing and execution. Unit tests for all control platform services.
- Add metrics endpoint.

---

## 2026-03-22

### Features
- **Control platform foundation** — Shared type system, control/mission store slices, SocketProvider upgrade.
- **BlackboardManager** — Shared task blackboard with swarm goals, bot goals, task claiming, resource reservations, and message posting.
- **Swarm directives** — Anthropic Claude support for multi-bot coordination via swarm override system.
- **Supply chain automation** — Multi-stage supply chains with input/output chests, stage sequencing, loop support, and templates.
- **Multi-bot blueprint building** — Schematic loading, Y-layer partitioning across bots, parallel block placement via /setblock commands.
- **Social AI system** — Bot-to-bot communication, social memory with decay, emotional state tracking, periodic reflections.
- **Web dashboard** — Next.js App Router dashboard with bot cards, map, activity feed, chat, stats, skills, relationships, and build pages. Zustand stores, Socket.IO real-time updates.
- **"Create Bots for Task" on Build page** — Auto-spawn builder bots with staggered connections.
- **Vitest test infrastructure** — Backend and frontend test setup.

### Bug Fixes
- Fix build system: balanced Y-layer partitioning, spam protection, bot control.
- Fix Gemini thinking config, auth class selection, and build page errors.
- Fix null-safety crashes in BotInstance.
- Build system hardening and bot management improvements.
- Fix out-of-memory errors (multiple commits).

---

## 2026-03-21

### Features
- **Initial release** — DyoBot AI-powered Minecraft bot with Voyager-style code generation.
- **Mineflayer integration** — Bot lifecycle, connection management, pathfinding, combat.
- **LLM code generation** — Gemini-powered action generation, curriculum agent, critic evaluation, skill library.
- **Personality system** — 6 personality types (merchant, guard, explorer, farmer, blacksmith, elder) with affinity tracking.
- **Instinct system** — Attack, hazard, and drowning instincts with automatic threat response.
- **Primitive actions** — Walk, mine, craft, smelt, attack, place blocks, use containers, patrol, follow, give items.
- **Web dashboard backend** — Express API with Socket.IO for real-time bot monitoring.
- **Conversation system** — Per-player chat history with LLM-driven responses and sentiment analysis.

### Bug Fixes
- Fix chat truncation and improve follow reliability.
- Fix broken conversations and add building capabilities.
- Fix primitives reliability.
