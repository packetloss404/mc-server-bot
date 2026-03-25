How to Use Building Features:

  1. Drop .schem or .schematic files into D:\projects\mc-server-bot\schematics\
  2. In-game, say: list schematics — packetsloth will list available files
  3. Say: build bunker.schem — it'll build the schematic at its current position

 It builds block-by-block. If the bot doesn't have the blocks in inventory, it falls back to /setblock commands (needs the bot to have server permissions for that). If the server allows the bots to use /setblock, it can build anything regardless of inventory.

---

# DyoBot Codebase Review — 2026-03-25

Full codebase review by 10 parallel agents. Findings organized by priority.

---

## Critical Bugs

### Memory Leaks in BotInstance
- **Reflection interval** (`BotInstance.ts:193-199`) — `setInterval` for reflection never stored or cleared on disconnect. Accumulates with each reconnect.
- **`pendingConnectTimeout`** (`BotInstance.ts:56, 1233`) — not cleared in `disconnect()`. Can fire after bot is destroyed.
- **`reconnectTimer`** (`BotInstance.ts:430, 507-526, 1233`) — not cleared on disconnect. Orphaned reconnect callbacks.
- **BotComms listener** (`BotInstance.ts:185-191, 1233`) — `registerListener()` called on spawn but `unregisterListener()` never called on disconnect. Stale listeners accumulate.
- **Duplicate message listeners** (`BotInstance.ts:177-182`) — raw `bot.on('message', ...)` added on every reconnect without removing old ones. N reconnects = N duplicate listeners.

### Container/Furnace Never Closed on Error
- `container.ts:66-72, 87-93` — if `withdraw()`/`deposit()` throws, catch block returns without `container.close()`. Container stays locked.
- `smelt.ts:45-84` — same issue with furnace. Furnace never closed on error path.

### Affinity System Half-Wired
- `onHit()` defined (`AffinityManager.ts:52`) but never called. `BotInstance.ts:247-249` logs attacker name but doesn't update affinity.
- `onGift()` defined (`AffinityManager.ts:62`) but never called anywhere. `giveItem.ts` doesn't trigger it.
- `isHostile()` defined (`AffinityManager.ts:68-70`) but never called. Bots never check hostility before acting.
- `trustThreshold` and `hostileThreshold` config values completely unused.

### File Write Race Conditions
- 19 data managers use `writeFileSync` with no debouncing, locking, or atomic writes.
- **Worst offenders:**
  - `BlackboardManager.ts:250` — persists on every mutation (13 call sites), can burst 50+ writes
  - `AffinityManager.ts:156` — every chat/hit/gift triggers immediate write
  - `SocialMemory.ts:273-276` — `addMemory()`, `reflect()`, `updateEmotionalState()`, `decayMemories()` all write immediately
  - `StatsTracker.ts:115` — every stat update triggers write
  - `BlockerMemory.ts:89` — every failure record triggers write
  - `CurriculumAgent.ts:434-439` — writes 4 files sequentially; crash between writes = inconsistent state
- **No shutdown flush** on AffinityManager, BlackboardManager, SocialMemory, StatsTracker, WorldMemory, BlockerMemory

### Build System False Success
- `BuildCoordinator.ts:542-546` — `/setblock` commands fire-and-forget, counter increments regardless of success
- `BuildCoordinator.ts:485-490` — if all bots disconnect, job reports "completed" with 0 blocks placed
- No block placement verification, no bot disconnect recovery

### Path Traversal in Schematic Endpoint
- `api.ts:956` — `req.params.filename` passed to `path.join(schematicsDir, filename)` without validation

---

## High Priority Bugs

- **walkTo race condition** (`walkTo.ts:18-23`) — `noPath` doesn't call `pathfinder.stop()`
- **attack.ts multiple finish()** (`attack.ts:26-94`) — can resolve/reject promise multiple times
- **Patrol not implemented** (`CommandCenter.ts:690-717`) — only moves to first waypoint
- **Squad missions broken** (`MissionManager.ts:110-114`) — iterates squad IDs not bot names
- **Multi-bot missions** (`MissionManager.ts:471-509`) — completes on first bot finish
- **Override expiry never checked** (`RoleManager.ts:60-73`) — `checkOverrideTimeouts()` never called
- **Autonomy levels cosmetic** (`RoleManager.ts:138-150`) — stored but never enforced
- **Chat cooldown map unbounded** (`BotInstance.ts:62`) — never pruned
- **Voyager pause flag desync** (`BotInstance.ts:814-816, 1040`) — boolean flag, should be ref-counted

---

## Token / Performance Waste

- **ActionAgent prompt ~25% redundant** (`ActionAgent.ts:20-91`) — 3 sections repeat same rules
- **Critic has 11 examples, needs 4** (`CriticAgent.ts:16-119`) — ~3-4K wasted tokens per eval
- **Curriculum/critic ignore config maxTokens** (`CurriculumAgent.ts:352`, `CriticAgent.ts:246`) — hardcoded 1000
- **QA embeddings dead** (`GeminiClient.ts:103-129`) — commented out, fallback is exact string match
- **Socket.IO 2s polling** (`socketEvents.ts:23-91`) — should be event-driven
- **Unused config values:** `ambientChatMinSec`, `ambientChatMaxSec`, `maxConcurrentRequests`
- **No debouncing** on most data managers

---

## Dead / Half-Built Features

- **Bot-to-bot messaging** — `getUnread()` never called (`BotComms.ts:51-59`)
- **`cooperation`/`help_request` events** — defined, never recorded (`AffinityManager.ts:123-124`)
- **Emotional sociability** — tracked, never used (`SocialMemory.ts:28`)
- **`idle_long` event** — defined, never triggered (`SocialMemory.ts:216-219`)
- **Deposit inventory command** — returns stub (`CommandCenter.ts:720-731`)
- **`activeMissionId` on squads** — field exists, never set (`FleetTypes.ts:7`)

---

## Feature Ideas

### Personality & Social
- Wire up affinity (hit/gift/hostile gating)
- Personality-specific task selection (farmers farm, merchants trade)
- LLM-driven reflections that feed back into behavior
- Emotional state affects behavior (lonely → chat more, scared → stay near base)
- Affinity-gated combat (warn high-affinity players before attacking)

### Fleet Intelligence
- Process bot-to-bot messages (parse, respond, coordinate)
- Squad-aware missions (resolve membership to bot names)
- Role-based mission filtering (use preferredMissionTypes)
- Enforce autonomy levels

### Build System
- Block placement verification
- Bot disconnect recovery (reassign blocks)
- Configurable placement speed

### Dashboard
- Mission step drilldown
- Commander plan confidence/warnings display
- Full stats breakdown (mined/crafted/killed by type)
- Experience bars on bot cards
- Equipment hotbar visualization
- Mission dependency graph

### Infrastructure
- Atomic file writes (temp + rename)
- Debounce all data managers
- Persist EventLog to disk
- Event-driven socket updates
- LLM circuit breaker (fallback on high failure rate)
