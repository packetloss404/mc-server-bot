# Changelog

All notable changes to DyoBot are documented in this file.

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
