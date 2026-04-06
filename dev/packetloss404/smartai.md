# DyoBot Smart AI: Architecture for Autonomous Minecraft Intelligence

## 1. Executive Vision

DyoBot's endgame is a Minecraft server where AI-driven bots form a functioning civilization that players can visit, collaborate with, and influence -- but that continues to grow, build, trade, and evolve even when no humans are online. Think of it as a living world simulator running on top of Minecraft, where the AI is not just executing tasks but making decisions, forming relationships, and pursuing goals it invented for itself.

To get there, we need three fundamental leaps:

1. **Multi-brain architecture** -- Different cognitive tasks need different models. A bot deciding whether to dodge a creeper needs sub-100ms local inference. A bot planning a cathedral needs deep reasoning from a frontier model. Today we use one LLM for everything; tomorrow we need a router that picks the right brain for the right job.

2. **Persistent world understanding** -- Bots currently have the memory of a goldfish. They generate code, execute it, and move on. We need bots that remember where the iron vein is, that the forest to the north was cleared last week, that player "Steve" prefers diamond tools, and that the east bridge is structurally incomplete.

3. **Emergent coordination** -- Individual bot intelligence is necessary but not sufficient. The real magic happens when bots negotiate, specialize, delegate, and self-organize without a central controller dictating every move.

The technical north star: a fleet of 10+ bots that can, given only the goal "build a village," autonomously survey land, assign roles, gather resources, construct buildings, establish farms, set up defenses, and maintain the settlement indefinitely -- while gracefully integrating human players who show up.

---

## 2. Current AI Capabilities

### What Works

| Component | Status | Notes |
|-----------|--------|-------|
| CurriculumAgent | Functional | LLM-based task proposal with personality-weighted fallback pools. Progression-aware. |
| ActionAgent | Functional | Generates single async functions via LLM. Babel-based parsing with 3 retry attempts. Composable skill references. |
| CriticAgent | Functional | Hybrid programmatic + LLM evaluation. Inventory deltas, movement checks, semantic crafting evaluation. |
| SkillLibrary | Functional | TF-IDF + embedding hybrid search. Quality scoring, success/failure tracking. |
| TaskPlanner | Basic | Hardcoded prerequisite chains for a few recipes (wooden_pickaxe, wooden_hoe). No general-purpose planning. |
| LongTermGoal | Basic | Build state machine (classify -> blueprint -> gather -> build -> verify). Blueprint generation for simple houses. |
| BlackboardManager | Exists | Task claiming, reservations, messages. Not wired into VoyagerLoop decision-making. |
| BotComms | Exists | Message queues with listener pattern. `getUnread()` implemented but never called. |
| WorldMemory | Basic | Records workstations, containers, resources by position. 200 record cap. No spatial indexing. |
| CommanderService | Stub | Regex-only intent parsing. `execute()` is a no-op that returns empty arrays. No LLM integration. |
| SocialMemory | Exists | Relationship tracking. Not connected to task selection. |

### What Doesn't Work

- **No multi-model routing**: Single LLMClient shared across curriculum, action, and critic agents. Every call pays the same latency and cost regardless of complexity.
- **No fallback chain**: If the configured provider errors, the entire loop fails. No retry with alternate providers.
- **CommanderService can't execute**: `execute()` returns `{ commands: [], missions: [] }`. The parse is regex heuristics producing confidence scores but never generating actual CommandCenter dispatches or MissionManager creates.
- **BotComms is dead code**: The TODO on line 60 of `BotComms.ts` says "Wire into VoyagerLoop tick so bots actually process incoming" -- this was never done. Bots cannot influence each other's behavior.
- **BlackboardManager is disconnected**: Tasks get posted but never consumed by the VoyagerLoop's task selection. The `activeBlackboardTask` field exists in VoyagerLoop but the consumption logic is minimal.
- **WorldMemory is primitive**: Linear scan over 200 records. No spatial indexing, no decay, no confidence scoring. A bot can remember that iron_ore exists at (100, 40, 200) but can't efficiently ask "what resources are within 100 blocks of me?"
- **TaskPlanner is hardcoded**: Only handles wooden_pickaxe, wooden_hoe, and a few special cases. Cannot plan arbitrary multi-step tasks.
- **No token tracking**: `inputTokens` and `outputTokens` are returned by both clients but never aggregated or used for cost optimization.

---

## 3. Multi-Provider Architecture

### 3.1 The Model Router

The core idea: different cognitive tasks have fundamentally different requirements.

```
                          +------------------+
                          |   ModelRouter    |
                          |                  |
                          | taskType ------> |---> providerChain[]
                          | complexity ----> |---> latency budget
                          | tokenBudget --> |---> cost constraint
                          +--------+---------+
                                   |
            +----------+-----------+-----------+----------+
            |          |           |           |          |
       +----v---+ +----v---+ +----v----+ +----v---+ +----v------+
       | Claude | | Gemini | | Ollama  | | GPT-4o | | Fallback  |
       | Opus   | | Flash  | | Local   | | Mini   | | Static    |
       +--------+ +--------+ +---------+ +--------+ +-----------+
```

**File: `src/ai/ModelRouter.ts`**

```typescript
interface ModelProfile {
  provider: string;           // 'anthropic' | 'gemini' | 'ollama' | 'openai'
  model: string;
  capabilities: Set<string>;  // 'code_gen' | 'reasoning' | 'chat' | 'fast' | 'embed'
  costPer1kInput: number;     // USD
  costPer1kOutput: number;
  avgLatencyMs: number;       // measured, not theoretical
  maxTokens: number;
  reliability: number;        // 0-1, updated from actual success rate
}

interface RouteDecision {
  primary: ModelProfile;
  fallbacks: ModelProfile[];
  reason: string;
}

type TaskCategory =
  | 'code_generation'      // ActionAgent: needs best code quality
  | 'task_planning'        // CurriculumAgent: needs reasoning
  | 'task_evaluation'      // CriticAgent: needs accuracy but simpler
  | 'chat_response'        // Personality chat: needs speed + personality
  | 'command_parsing'      // CommanderService: needs structured output
  | 'skill_search'         // Embedding generation: needs embed capability
  | 'quick_decision'       // Combat/flee/eat: needs <100ms latency
  | 'world_analysis';      // Perception: needs multimodal (future)
```

### 3.2 Routing Strategy

| Task Category | Primary | Fallback 1 | Fallback 2 | Rationale |
|--------------|---------|------------|------------|-----------|
| code_generation | Claude Sonnet / Gemini 2.5 Pro | Gemini Flash (thinking) | Static templates | Code quality is critical. Worth paying for. |
| task_planning | Gemini Flash (thinking) | Claude Haiku | Static fallback pool | Needs reasoning but happens infrequently. |
| task_evaluation | Gemini Flash | Local Ollama (Qwen) | Programmatic only | High volume, low complexity. Cost-optimize aggressively. |
| chat_response | Local Ollama (Llama 3.2) | Gemini Flash | Canned responses | Latency matters more than quality. Players notice delay. |
| command_parsing | Gemini Flash | Claude Haiku | Regex fallback (current) | Structured output. Medium complexity. |
| quick_decision | Local Ollama | Rule-based | -- | Must be <100ms. No network round-trip. |
| skill_search | Gemini Embedding | Local sentence-transformers | TF-IDF only | Embedding quality matters for skill retrieval. |

### 3.3 Cost Tracking

Every LLM call should flow through a `TokenLedger`:

**File: `src/ai/TokenLedger.ts`**

```typescript
interface TokenUsageRecord {
  timestamp: number;
  provider: string;
  model: string;
  taskCategory: TaskCategory;
  botName: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  success: boolean;
}
```

The ledger enables:
- Per-bot cost breakdown (which bot is most expensive?)
- Per-task-type cost analysis (is code gen 80% of spend?)
- Automatic downgrade when budget thresholds are hit
- Dashboard visualization of token spend over time

### 3.4 Local Model Integration

For sub-100ms decisions (combat triage, hunger response, flee-or-fight), we need local inference.

**Ollama integration** (`src/ai/OllamaClient.ts`):
- Implements the existing `LLMClient` interface
- Connects to `http://localhost:11434/api/generate`
- Models: `qwen2.5-coder:3b` for quick code patches, `llama3.2:3b` for chat/decisions
- No embedding support (use Gemini embedding API as fallback)

**When to use local models:**
- Instinct-level decisions (eat, flee, attack) -- currently hardcoded in `src/bot/` instinct handlers, could be upgraded to LLM-guided with local inference
- Chat responses where personality flavor matters more than factual depth
- CriticAgent evaluation for simple pass/fail checks (did inventory change? did bot move?)
- Rapid re-planning when a task step fails and we need a quick pivot

### 3.5 Fallback Chain Implementation

```
Request --> Primary Provider
              |
              +--> Success? --> Return
              |
              +--> Failure/Timeout --> Fallback 1
                                         |
                                         +--> Success? --> Return
                                         |
                                         +--> Failure --> Fallback 2
                                                           |
                                                           +--> Success? --> Return
                                                           |
                                                           +--> All failed --> Static/Rule-based
```

Critical: failures should update the `reliability` score in `ModelProfile`, causing the router to gradually shift traffic away from unreliable providers without manual intervention.

---

## 4. Autonomous Bot Intelligence

### 4.1 Self-Improving Task Decomposition

The current `TaskPlanner.ts` has hardcoded plans for ~5 recipes. We need a general-purpose decomposer.

**Approach: LLM-generated plans with learned corrections**

1. When CurriculumAgent proposes a complex task, ask the LLM to decompose it into ordered steps with dependency annotations.
2. Store successful decomposition chains in `data/plan_templates.json`.
3. On subsequent similar tasks, retrieve the stored template and adapt it (change quantities, substitute materials).
4. When a plan step fails, feed the failure context back into the planner for mid-execution replanning (this partially exists via `replanTaskStep` but is only called for blocker-based replanning).

**File: `src/voyager/PlanLibrary.ts`**

```typescript
interface PlanTemplate {
  goal: string;                    // "craft iron pickaxe"
  steps: PlanStep[];
  successCount: number;
  failureCount: number;
  avgCompletionMs: number;
  lastUsed: number;
  embedding?: number[];            // for semantic search
}

interface PlanStep {
  description: string;
  preconditions: string[];         // ["has:oak_log:3", "has:crafting_table"]
  postconditions: string[];        // ["has:oak_planks:12"]
  estimatedDurationMs: number;
  failureRate: number;
}
```

The plan library becomes a form of procedural memory -- the bot "remembers" how to accomplish goals without re-deriving plans from scratch.

### 4.2 Persistent Spatial Memory

Replace the flat `WorldMemory` record list with a spatially-indexed, time-decaying knowledge graph.

**Architecture:**

```
WorldKnowledgeGraph
  |
  +-- SpatialIndex (R-tree or grid-based)
  |     |
  |     +-- query: "resources within 100 blocks of (x,y,z)"
  |     +-- query: "nearest crafting_table"
  |     +-- query: "all explored chunks"
  |
  +-- TemporalDecay
  |     |
  |     +-- confidence = f(time_since_observed, observation_count)
  |     +-- stale records get lower priority in planning
  |     +-- very stale records trigger "verify" tasks
  |
  +-- SemanticLayer
        |
        +-- "the forest to the north" --> spatial region + resource composition
        +-- "our base" --> marker with associated structures
        +-- "the dangerous cave" --> location + threat assessment
```

**File: `src/voyager/SpatialIndex.ts`**

Use a simple grid-based spatial hash (chunk-aligned, 16x16 cells) rather than a full R-tree. This is Minecraft -- the world is already chunked.

```typescript
interface SpatialCell {
  chunkX: number;
  chunkZ: number;
  records: WorldRecord[];
  lastVisited: number;
  explorationScore: number;  // 0-1, how well-explored is this chunk
}

interface WorldRecord {
  id: string;
  kind: string;
  name: string;
  position: Vec3;
  confidence: number;        // decays over time
  observedBy: string[];      // which bots have seen this
  firstSeen: number;
  lastSeen: number;
  metadata: Record<string, unknown>;
}
```

### 4.3 Dynamic Goal Setting

Bots should generate their own goals based on world state, not just follow the curriculum.

**Goal Generator** (`src/voyager/GoalGenerator.ts`):

```
Inputs:
  - Bot's current state (health, hunger, inventory, equipment)
  - WorldKnowledgeGraph (what do we know about the world?)
  - Personality profile (farmer vs guard vs explorer)
  - Server state (time of day, weather, nearby threats)
  - Social state (other bots' needs, player requests)
  - Role assignment (from RoleManager)

Output:
  - Prioritized goal stack with urgency scores

Priority hierarchy:
  1. SURVIVAL   (health < 6, hunger < 4, drowning)     -- instinct, no LLM needed
  2. SAFETY     (hostile mobs nearby, night without shelter)
  3. OBLIGATION (player-assigned task, mission queue)
  4. SOCIAL     (help another bot, respond to trade request)
  5. ROLE       (personality-driven: farm, guard, explore, build)
  6. GROWTH     (learn new skills, explore new areas, progress tech tree)
  7. CREATIVE   (build something new, experiment, optimize)
```

This replaces the current system where CurriculumAgent is the sole task source. The GoalGenerator sits above the CurriculumAgent and feeds it context about *why* a task should be attempted.

### 4.4 Economy and Trade

Bots should have a concept of value and exchange.

**Resource Valuation:**
- Track supply (how much of each resource exists across all bot inventories + known storage)
- Track demand (how many pending tasks need each resource)
- Compute dynamic value: `value = demand_weight / (supply + 1)`
- Bots with surplus of high-value resources become natural trade partners

**Trade Protocol:**
Wire into the existing `BotComms` system:

```
Bot A: {type: "request", content: "need 8 iron_ingot, offering 16 oak_log"}
Bot B: {type: "inform", content: "accept trade: 8 iron_ingot for 12 oak_log"}
Bot A: {type: "inform", content: "deal accepted, meeting at chest(100, 64, 200)"}
```

Implementation: A `TradeNegotiator` class that generates and evaluates offers based on each bot's inventory, current tasks, and resource valuation. Initially rule-based (accept if the offered resource's value exceeds the requested resource's value by the bot's personality-adjusted threshold), with LLM-based negotiation for complex multi-resource trades.

### 4.5 Emergent Social Dynamics

Wire the existing `SocialMemory` and `AffinityManager` into the VoyagerLoop:

- **Affinity affects cooperation**: Bots with high mutual affinity prioritize each other's help requests. Low-affinity bots may refuse or delay.
- **Reputation system**: Track each bot's reliability (does it complete tasks it claims on the blackboard? does it follow through on trades?). Unreliable bots get fewer cooperation offers.
- **Specialization emergence**: As bots complete tasks, they build domain expertise (tracked via skill success rates per category). Other bots learn to delegate tasks to the specialist. The farmer bot becomes the go-to for food, the guard for mob clearing, etc.

---

## 5. Autonomous Server Vision

### 5.1 Bot Civilization

The fully realized vision is a bot settlement that exhibits emergent civilization behaviors:

```
+------------------------------------------------------------------+
|                    DyoCraft Server                                |
|                                                                   |
|  +------------------+    +------------------+                     |
|  |   Town Center    |    |   Farm District  |                     |
|  |   (Elder bot)    |    |   (Farmer bots)  |                     |
|  |   - Governance   |    |   - Wheat fields |                     |
|  |   - Task board   |    |   - Animal pens  |                     |
|  |   - Trade hub    |    |   - Compost      |                     |
|  +--------+---------+    +--------+---------+                     |
|           |                       |                               |
|  +--------v---------+    +--------v---------+                     |
|  |  Mining Quarter  |    |  Guard Towers    |                     |
|  |  (Miner bots)    |    |  (Guard bots)    |                     |
|  |  - Strip mine    |    |  - Perimeter     |                     |
|  |  - Smelter       |    |  - Night watch   |                     |
|  |  - Ore storage   |    |  - Mob reports   |                     |
|  +------------------+    +------------------+                     |
|                                                                   |
|  [Player enters] --> Greeted by Elder --> Assigned guest house    |
|                  --> Given tour --> Invited to contribute          |
+------------------------------------------------------------------+
```

### 5.2 AI-Generated World Events

A meta-AI (the "Dungeon Master") observes the server state and generates events:

- **Resource scarcity**: "The iron veins near base have been depleted. A new deposit has been discovered 500 blocks north, but it's in a dangerous cave system." -- Forces exploration and risk/reward decisions.
- **Mob invasions**: "A pillager raid is approaching from the east in 10 minutes." -- Tests defenses, triggers guard mobilization, forces resource allocation for weapons/armor.
- **Weather events**: "A thunderstorm is approaching. Lightning may strike builds without lightning rods." -- Motivates infrastructure upgrades.
- **Discovery events**: "An ancient ruin has been discovered at (X, Z). It may contain rare loot but is guarded by strong mobs." -- Rewards exploration.
- **Diplomatic events**: "A wandering trader has arrived with unusual goods. Bots must negotiate trades." -- Exercises the trade system.

**Implementation**: A `DungeonMaster` service that runs on a timer (every 30-60 minutes of server time), analyzes the current world state via the shared WorldKnowledgeGraph, and generates events using an LLM. Events are posted to the BlackboardManager and trigger missions via MissionManager.

### 5.3 Player-Bot Economy

Players interact with the bot civilization as participants, not just commanders:

- **Service requests**: Players can ask bots for help via chat ("Can someone mine me 32 iron?"). The request flows through CommanderService -> MissionManager -> bot assignment.
- **Resource exchange**: Players can trade with merchant bots. Bots set prices based on supply/demand.
- **Collaborative building**: Players can describe a structure ("Build a castle here"), and bots decompose it into tasks and execute over time, with players able to contribute manually.
- **Reputation**: Players build reputation with the bot community through positive interactions (tracked in AffinityManager).

### 5.4 Self-Balancing Difficulty

The server adjusts its behavior based on the player population:

- **No players online**: Bots focus on infrastructure, farming, and preparation. Slower pace.
- **1-2 players**: Bots are helpful companions. Reduced autonomous aggression. More proactive communication.
- **5+ players**: Bots become more independent. They pursue their own goals more aggressively. Events become more challenging.
- **Player skill detection**: If players are clearly experienced (diamond armor, elytra), events scale up. If players are new, bots offer more guidance.

---

## 6. Smarter Code Generation

### 6.1 Tool Use / Function Calling

The biggest reliability improvement we can make to ActionAgent is switching from free-form code generation to structured tool use.

**Current approach** (fragile):
```
LLM generates: async function mineOakLogs(bot) {
  await mineBlock('oak_log', 3);
  await craftItem('oak_planks', 12);
}
```
The LLM sometimes forgets `await`, calls nonexistent APIs, uses wrong argument order, wraps in try/catch despite instructions, etc.

**Proposed approach** (structured):
```json
{
  "plan": [
    {"action": "mineBlock", "args": {"name": "oak_log", "count": 3}},
    {"action": "craftItem", "args": {"name": "oak_planks", "count": 12}}
  ]
}
```

The ActionAgent produces a JSON action plan. A `PlanExecutor` translates each step into actual function calls with validated arguments. Benefits:
- No parse errors (JSON is simpler than JavaScript)
- Argument validation before execution
- Easier to inspect and debug plans
- Plans can be modified mid-execution (insert/remove/reorder steps)
- Can mix with free-form code gen for truly novel tasks

**Hybrid approach**: Use structured tool calling for common patterns (90% of tasks). Fall back to free-form code gen only when the task doesn't fit any known action template.

### 6.2 Action Templates

**File: `src/voyager/ActionTemplates.ts`**

Pre-built, tested action sequences for common Minecraft operations:

```typescript
const TEMPLATES: Record<string, ActionTemplate> = {
  'mine_and_store': {
    params: ['resource', 'count', 'containerLocation?'],
    steps: [
      { action: 'findNearest', args: { block: '{resource}' } },
      { action: 'mineBlock', args: { name: '{resource}', count: '{count}' } },
      { action: 'depositItem', args: { container: '{containerLocation}', item: '{resource}', count: '{count}' }, condition: 'containerLocation != null' },
    ]
  },
  'craft_with_prerequisites': {
    params: ['item', 'count'],
    steps: [
      { action: 'lookupRecipe', args: { item: '{item}' } },
      { action: 'gatherMaterials', args: { recipe: '{recipe}' } },
      { action: 'findOrCraftWorkstation', args: { type: '{recipe.station}' } },
      { action: 'craftItem', args: { name: '{item}', count: '{count}' } },
    ]
  },
  'explore_and_report': {
    params: ['direction', 'distance'],
    steps: [
      { action: 'exploreUntil', args: { direction: '{direction}', maxTime: '{distance * 1000}' } },
      { action: 'scanSurroundings', args: {} },
      { action: 'reportFindings', args: { via: 'blackboard' } },
    ]
  }
};
```

The CurriculumAgent can reference these templates, and the ActionAgent only needs to fill in parameters rather than generating entire functions.

### 6.3 Multi-Step Planning with Dependency Resolution

Upgrade `TaskPlanner.ts` from hardcoded recipes to a general dependency resolver.

```
Goal: "Craft an iron pickaxe"
  |
  +-- Need: iron_ingot x3
  |     +-- Need: raw_iron x3
  |     |     +-- Need: stone_pickaxe (to mine iron_ore)
  |     |     |     +-- Need: cobblestone x3 + stick x2
  |     |     |           +-- Need: wooden_pickaxe (to mine stone)
  |     |     |                 +-- Need: oak_planks x3 + stick x2
  |     |     |                       +-- Need: oak_log x2
  |     |     +-- Action: mine iron_ore x3
  |     +-- Need: furnace
  |     |     +-- Need: cobblestone x8
  |     +-- Action: smelt raw_iron x3
  +-- Need: stick x2
  |     +-- Need: oak_planks x2
  +-- Action: craft iron_pickaxe
```

**Implementation**: A `DependencyResolver` that takes Minecraft recipe data (can be extracted from `minecraft-data` npm package which mineflayer already depends on) and recursively resolves prerequisites, checking current inventory at each node to prune already-satisfied branches.

### 6.4 Parallel Multi-Bot Task Execution

The BlackboardManager already supports task claiming. The missing piece is a coordinator.

**File: `src/voyager/SwarmCoordinator.ts`**

```
SwarmCoordinator
  |
  +-- decomposeGoal("build a house")
  |     |
  |     +-- Task: "gather 64 oak_log"     --> assign to Bot with 'gatherer' role
  |     +-- Task: "gather 32 cobblestone"  --> assign to Bot with 'miner' role
  |     +-- Task: "clear build site"       --> assign to nearest Bot
  |     +-- Task: "build walls"            --> depends on gather tasks, assign to 'builder'
  |     +-- Task: "build roof"             --> depends on walls, assign to 'builder'
  |
  +-- monitorProgress()
  |     |
  |     +-- Check BlackboardTask statuses
  |     +-- Reassign stalled tasks
  |     +-- Detect and resolve resource conflicts (two bots trying to mine same block)
  |
  +-- handleBlocker(botName, blockerDescription)
        |
        +-- Reassign task to different bot
        +-- Or decompose blocker into sub-task and assign helper
```

### 6.5 Cross-Bot Skill Learning

When Bot A learns a skill that succeeds, it should be available to all bots. This already partially works (shared `skills/` directory), but we can make it smarter:

- **Attribution**: Track which bot discovered each skill and in what context
- **Adaptation**: When Bot B retrieves Bot A's skill, the ActionAgent can reference it but adapt parameters for Bot B's current situation
- **Quality voting**: If multiple bots use a skill and it works, its quality score rises. If it fails for a specific personality or context, add negative metadata so it's deprioritized for similar situations.

---

## 7. Advanced Perception & Communication

### 7.1 World State Understanding

**Threat Assessment** (`src/voyager/ThreatAssessor.ts`):
- Scan nearby entities every tick (already done in Observation.ts)
- Classify threats: hostile mob within aggro range, player with weapon drawn, environmental hazard (lava, cactus, fall)
- Output a threat level (0-10) that influences GoalGenerator priority

**Opportunity Detection** (`src/voyager/OpportunityDetector.ts`):
- Scan nearby blocks for valuable resources the bot hasn't targeted
- Detect structures (villages, temples, dungeons) from block patterns
- Identify abandoned player builds (chests with items, unfinished structures)
- Feed opportunities into the GoalGenerator as low-priority goals

### 7.2 Player Intent Prediction

Use recent player actions to anticipate needs:

```
Player mines obsidian x10 --> likely building Nether portal
  --> Bot could proactively: "I see you're collecting obsidian. Want me to
      craft a flint and steel for the Nether portal?"

Player places crafting table + furnace --> setting up a base
  --> Bot could: "Looks like you're setting up here. I can help gather
      materials. What are you planning to build?"

Player repeatedly dies in same area --> struggling with combat
  --> Bot could: "That area seems dangerous. Want me to clear the mobs
      first, or I can craft you some armor?"
```

**Implementation**: A `PlayerIntentModel` that maintains a rolling window of player actions (block placed, block broken, item crafted, entity killed, movement direction) and uses pattern matching or a small LLM call to infer intent.

### 7.3 Server-Wide Situation Awareness

**Shared World Model** (`src/voyager/SharedWorldModel.ts`):

Every bot contributes observations to a shared model:

```typescript
interface SharedWorldState {
  exploredChunks: Map<string, ChunkExplorationData>;
  knownResources: SpatialIndex<ResourceRecord>;
  knownStructures: SpatialIndex<StructureRecord>;
  threatMap: SpatialIndex<ThreatRecord>;
  botPositions: Map<string, Vec3>;
  botStates: Map<string, BotState>;        // idle, working, combat, trading
  playerPositions: Map<string, Vec3>;
  serverTime: number;
  weather: string;
  recentEvents: ServerEvent[];
}
```

This is the "nervous system" of the bot civilization. Every bot reads from it and writes to it. The GoalGenerator uses it to avoid duplicate work (don't send two bots to mine the same vein) and to identify gaps (no bot is guarding the east side).

### 7.4 Communication Intelligence

**Decision Narration**:
Wire into the VoyagerLoop's task lifecycle events:

```typescript
// In VoyagerLoop, after task selection:
if (shouldNarrate(task, personality)) {
  const narration = await generateNarration(task, context, personality);
  bot.chat(narration);
}

// Examples by personality:
// Farmer: "The wheat's looking ready. Time to harvest!"
// Guard:  "Movement detected to the east. Investigating."
// Elder:  "We're running low on iron. I've asked the miners to prioritize that."
```

**Proactive Communication**:
When a bot discovers something notable (diamond vein, dungeon, player in danger), it should announce it:

```typescript
// In OpportunityDetector or ThreatAssessor:
if (discovery.significance > ANNOUNCE_THRESHOLD) {
  const announcement = formatDiscovery(discovery, personality);
  bot.chat(announcement);
  blackboard.postMessage(botName, 'info', announcement);
}
```

**Inter-Bot Negotiation**:
Use the existing BotComms infrastructure but add a `NegotiationProtocol`:

```
1. Bot A posts need to blackboard: "need 8 iron_ingot for iron_pickaxe"
2. Bot B sees need, checks inventory: has 12 iron_ingot
3. Bot B sends offer via BotComms: {type: "inform", content: "I have iron_ingot. What can you offer?"}
4. Bot A evaluates offer based on surplus: {type: "inform", content: "I can give you 16 oak_log"}
5. If accepted, both bots navigate to meeting point (nearest chest or direct toss)
```

---

## 8. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-3)
*Theme: Make the existing systems actually work*

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| Wire BotComms into VoyagerLoop tick | P0 | S | None |
| Wire BlackboardManager task consumption into VoyagerLoop | P0 | M | None |
| Implement TokenLedger for cost tracking | P0 | S | None |
| Add OllamaClient implementing LLMClient interface | P1 | S | None |
| Implement ModelRouter with config-driven provider chains | P1 | M | OllamaClient, TokenLedger |
| Wire CommanderService.execute() to CommandCenter + MissionManager | P0 | L | None |
| Add LLM-based parsing to CommanderService.parse() | P1 | M | ModelRouter |
| Upgrade WorldMemory with chunk-based spatial indexing | P1 | M | None |

### Phase 2: Intelligence (Weeks 4-6)
*Theme: Make bots smarter individually*

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| Build PlanLibrary with LLM-generated plan templates | P0 | L | Phase 1 |
| Build DependencyResolver using minecraft-data recipes | P0 | L | None |
| Implement GoalGenerator with priority hierarchy | P1 | L | WorldMemory upgrade |
| Add structured tool-use mode to ActionAgent (JSON plans) | P1 | L | PlanLibrary |
| Implement ActionTemplates for common patterns | P1 | M | Tool-use mode |
| Add ThreatAssessor for real-time danger evaluation | P2 | M | None |
| Add OpportunityDetector for resource/structure discovery | P2 | M | WorldMemory upgrade |
| Temporal decay + confidence scoring for WorldMemory | P2 | S | WorldMemory upgrade |

### Phase 3: Coordination (Weeks 7-10)
*Theme: Make bots work together*

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| Build SwarmCoordinator for multi-bot task decomposition | P0 | L | PlanLibrary, BlackboardManager |
| Implement SharedWorldModel aggregating all bot observations | P0 | L | WorldMemory upgrade |
| Resource valuation system (supply/demand tracking) | P1 | M | SharedWorldModel |
| Trade negotiation protocol via BotComms | P1 | M | Resource valuation, BotComms wiring |
| Cross-bot skill attribution and quality voting | P2 | M | SkillLibrary |
| Decision narration system (bots explain what they're doing) | P2 | S | None |
| Proactive communication (announcements, warnings) | P2 | S | ThreatAssessor, OpportunityDetector |

### Phase 4: Civilization (Weeks 11-16)
*Theme: Emergent society*

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| DungeonMaster event generator | P1 | L | SharedWorldModel, MissionManager |
| PlayerIntentModel for anticipatory assistance | P1 | M | Phase 3 |
| Bot reputation system (reliability tracking) | P2 | M | Phase 3 |
| Self-balancing difficulty based on player population | P2 | M | DungeonMaster |
| Settlement planning AI (zone assignment, build ordering) | P2 | XL | SwarmCoordinator, Blueprint system |
| Governance simulation (elder bot makes server-wide decisions) | P3 | L | Everything |

**Effort key**: S = 1-2 days, M = 3-5 days, L = 1-2 weeks, XL = 2-4 weeks

---

## 9. Technical Risks

### 9.1 Cost Explosion

**Risk**: With 10 bots each making multiple LLM calls per task cycle (curriculum + action + critic), costs can spiral. At 2-second task cooldown, that's 30 calls/minute per bot, 300/minute for 10 bots.

**Mitigation**:
- ModelRouter aggressively routes to cheapest adequate model
- TokenLedger with hard budget caps per hour/day
- Local models for high-volume, low-complexity calls
- Increase `taskCooldownMs` for non-urgent tasks
- Cache common CurriculumAgent outputs (same state often produces same task)
- Batch embedding calls (already done in SkillLibrary)

### 9.2 Coordination Deadlocks

**Risk**: Bot A needs iron from Bot B, Bot B needs wood from Bot A, neither will release their current resource.

**Mitigation**:
- Trade protocol with timeout (if no agreement in 30s, both bots fall back to self-sufficient plans)
- Blackboard-based resource sharing (deposit surplus into shared chests, any bot can withdraw)
- SwarmCoordinator detects circular dependencies and breaks them by assigning a third bot

### 9.3 LLM Unreliability

**Risk**: LLM outputs are nondeterministic. A task that worked yesterday may produce broken code today.

**Mitigation**:
- Fallback chains (already in ModelRouter design)
- Structured tool-use reduces surface area for errors
- Static fallback tasks in CurriculumAgent (already exists)
- Programmatic CriticAgent checks catch most failures before they compound
- Skill library means successful code is reused, not regenerated
- ActionAgent's parse-retry loop (already exists, 3 attempts)

### 9.4 World State Desynchronization

**Risk**: SharedWorldModel becomes stale or contradictory (Bot A says there's iron at X, Bot B arrives and it's been mined).

**Mitigation**:
- Confidence decay (records become less trusted over time)
- Verification tasks (periodically send a bot to confirm high-value records)
- Event-driven updates (when a bot mines a block, immediately update the shared model)
- Conflict resolution: most recent observation wins, but flag the conflict for review

### 9.5 Player Experience Degradation

**Risk**: Bots become so autonomous they ignore players, or so chatty they spam the chat.

**Mitigation**:
- Player interactions always have higher priority than autonomous goals (OBLIGATION > ROLE in GoalGenerator)
- Chat rate limiting (max 1 message per 10 seconds per bot, already partially enforced)
- Player proximity detection: bots within 16 blocks of a player shift to "attentive" mode
- Easy kill switch: `/pause all` through CommanderService

### 9.6 Local Model Quality

**Risk**: Ollama/local models produce significantly worse output than cloud models, leading to cascading failures.

**Mitigation**:
- Only use local models for well-bounded tasks (yes/no decisions, simple chat, template parameter filling)
- A/B test local vs cloud on the same tasks, track success rates in TokenLedger
- Automatic fallback to cloud if local model failure rate exceeds threshold
- Fine-tune local models on successful DyoBot outputs (distillation pipeline, Phase 4+)

### 9.7 Complexity Budget

**Risk**: Implementing everything here takes the codebase from manageable to unmaintainable.

**Mitigation**:
- Strict phase ordering -- each phase delivers standalone value
- Phase 1 is entirely about wiring existing systems, not building new ones
- Every new system implements clean interfaces (LLMClient pattern is a good model)
- Integration tests for critical paths (task proposal -> code gen -> execution -> evaluation)
- Avoid premature abstraction: build the concrete system first, extract patterns second
