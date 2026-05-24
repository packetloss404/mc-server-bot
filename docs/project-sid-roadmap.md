# Project Sid → DyoBot: Implementation Roadmap

Design plans for porting concepts from *Project Sid: Many-agent simulations toward AI civilization* (arXiv:2411.00114) into DyoBot. **Status: design only — review before any code.**

## Thesis

Most of Sid's headline concepts map onto infrastructure DyoBot **already has but isn't using**. Verified facts that make the cheap wins cheap:

- `data/stats.json` already records **per-bot action tallies** (`mined`/`crafted`/`smelted`/`placed`/`killed`/`withdrew`/`deposited`, keyed by item) — Sid's Fig-9 role signal, already persisted.
- `BotComms.broadcast(from, content, type)` (`src/social/BotComms.ts:147`) is **implemented and never called** — a ready transmission pipe.
- `AffinityManager` (`src/personality/AffinityManager.ts`) keys by arbitrary name strings → **bot→bot affinity edges need no schema change**.
- The approval/voting system (`src/town/ApprovalManager.ts`) is fully built with durable rehydration but only `ExpansionManager` produces approvals; the `decree` kind is defined and never created.
- `VoyagerLoop.getInternalState()` is a proto **cognitive-controller bottleneck**; the brain tick already drains inter-bot messages every cycle (`VoyagerLoop.ts:~515`).

## Dependency graph & recommended order

```
P1 Civ metrics + emergent roles ──┐ (independent, read-only, do first)
                                   │
P3a bot↔bot affinity ──────────────┼──> P3b cultural memes
                                   │
P2a decrees=standing rules ────────┴──> P2b prompt injection ──> P2c bot-initiated decrees
                                   │
P4 PIANO perception tick ──────────────> P4 Cognitive Controller (enables coherent P2b/P3b talk)
```

Suggested sequence: **P1 → P2 → P3 → P4** (cheap→invasive). P1 is risk-free and independent. P4 is most invasive but its Cognitive Controller makes P2b/P3b's "talk coheres with action" cleaner, so it can also be pulled earlier if we want the architecture first.

Cross-cutting: a small **per-bot `AgentState`** holder (introduced in P4-A) is reused by P2/P3 prompt injection. Not a prerequisite — P1–P3 work without it.

All new behavior gates behind a config flag (extend the `security`-style section pattern in `src/config.ts`). Default new cognitive/social features OFF until validated; P1 (read-only metrics) can default ON.

---

## P1 — Civilization metrics + emergent role inference

**Goal:** Measure the society the way Sid does, and *infer* each bot's role from what it actually does (vs. the assigned role). Cheapest, highest-visibility, read-only.

**Why it's first:** the input data (`stats.json`) already exists; this is aggregation + a dashboard card, with zero behavior risk.

### P1-A: Observed-role inference
- New `src/town/ObservedRoleModel.ts`: read each bot's `stats.json` action vector, score into roles with a weighted heuristic (no LLM for v1):
  - mostly `mined` → miner; `killed` + combat crafts → guard; seeds/hoe/wheat → farmer; `placed`-heavy → builder; `withdrew`/`deposited` dominant → trader/hauler; logs → lumberjack.
- Expose: `GET /api/bots/:name/observed-role` and include in detailed status. Compare to assigned role (`town/RoleManager.ts`) to surface mismatches ("a 'farmer' who only mines").
- Optional feedback: replace the static `PERSONALITY_PREFERENCE` tie-breaker in `town/RoleManager.assignRoles` with observed behavior.

### P1-B: Civilization-progress metrics
- Extend `GET /api/metrics` (handler in `src/server/api.ts`, ~line 1697) or add `GET /api/metrics/civilization`:
  - **Role-distribution entropy** (Shannon bits) over observed roles — Sid's Fig-8E headline scalar (healthy 3.4–4.0 bits, collapsed ≈2.6).
  - **Action-exclusivity index** from the per-bot action matrix (how concentrated each action is in one bot — Fig 9).
  - **Cumulative unique items** mined+crafted across the fleet (tech-tree progress, Fig 5).
  - Light time series so the dashboard shows curves.
- One dashboard card in `web/` (mirror an existing metrics card component).

**Files:** new `src/town/ObservedRoleModel.ts`; `src/server/api.ts` (metrics + new route); `src/town/RoleManager.ts` (optional tie-breaker); `web/` (one card). **Effort: S–M.** **Risk: minimal (read-only).**

**Verification:** unit-test the entropy + classifier on a fixture `stats.json`; hit the endpoint live; confirm the card renders and entropy moves when a bot changes behavior.

---

## P2 — Governance that bites

**Goal:** Turn cosmetic mayor "decrees" into **standing rules that actually shape behavior**, then let **bots propose rule changes** through the existing vote system. This is Sid's follow→amend→re-follow loop.

**Current reality:** `POST /api/towns/:id/mayor/decree` (`api.ts:4104`) drops a *one-shot* blackboard task and logs an event; nothing stores a standing rule or injects it into any prompt; bots can't propose laws; `VoteHeuristic.voteFor` rubber-stamps.

### P2-A: Decrees as standing rules biasing task selection (effort S–M)
- New `src/town/RuleStore.ts` (or a `town_rules` table in `src/town/schema.ts`): persist `TownRule { id, townId, text, keywords[], priority, active, createdAt }`.
- Change the `mayor/decree` handler to **write a rule** (not a one-shot task).
- Teach `BlackboardManager.scoreTaskEnhanced` (`BlackboardManager.ts:~361`, where the `town:`+30 and role boosts live) to read active rules for the bot's town and boost matching tasks.
- Optional: a periodic "rule reminder" task emitter via `ScheduleManager` (Sid's "tax season" trigger).

### P2-B: Inject rule text into the resident decision prompt (effort M)
- Sid's *entire* enforcement model is one interpolated line: *"Here's the constitution, consider the boundaries and consequences of your actions: {rules}."*
- Interpolate active town rules into `CurriculumAgent.proposeTask` / `GoalGenerator` prompt assembly (`src/voyager/`). Plumb rules across the worker boundary the same way `botRole` is fetched (`VoyagerLoop.ts:~701` via BlackboardProxy).
- Gate to residents, cap rule count, config flag — it adds tokens per resident tick.

### P2-C: Bot-initiated decrees via the existing approval workflow (effort M)
- Add a `decree` approval producer: a TownBrain trigger or "propose rule" bot action calls `ApprovalManager.createApproval({ kind:'decree', payload:{text} })`.
- Register a `decree` resolve handler (mirror `ExpansionManager.ts:275` rehydration) that, on approval, writes the rule via P2-A's RuleStore. The `decree` vote-heuristic entries already exist.

**Files:** new `src/town/RuleStore.ts`; `src/server/api.ts` (decree handler); `src/voyager/BlackboardManager.ts`, `CurriculumAgent.ts`/`GoalGenerator.ts`; `src/town/ApprovalManager.ts` + `TownBrain.ts`; worker proxy for rule fetch. **Effort: M overall.** **Risk: token cost (P2-B); a bad rule could skew all residents — keep rules few and config-gated.**

**Verification:** issue a decree → confirm it persists as a rule, biases task scores (log the boost), and appears in resident prompts; file a bot proposal → vote → confirm it becomes a rule.

---

## P3 — Culture & social spread

**Goal:** Give bots a **directed social graph** and a propagating **culture layer** (memes/beliefs) that *changes behavior*, not just chat flavor. Sid's most visually compelling result (meme/religion diffusion).

### P3-A: bot↔bot affinity + conversational sentiment (effort S–M; foundation)
- `AffinityManager` already supports arbitrary name keys → start writing **bot→bot** edges. When a bot processes an inter-bot message (the brain-tick drain at `VoyagerLoop.ts:~515` and `BotInstance.handleChat`), run the existing `analyzeSentiment()` and nudge the bot→peer edge.
- Surface top bot-relationships in the system prompt (`buildSystemPrompt` already takes `socialContext`). Make affinity **gate something real** (help priority / trade priority) — reuse the existing `isHostile` gating pattern.

### P3-B: Cultural memes that bias behavior (effort M; flagship)
- New `social/CultureManager.ts` (singleton like `BotComms`). `Meme { id, label, keywords[], originBot, strength }`.
- **Extraction (emergent, not hand-coded):** periodically summarize recent `SocialMemory` + blackboard chat into candidate memes via one LLM call — reuse the `ChronicleGenerator` LLM/budget plumbing.
- **Adoption:** when a bot hears a meme keyword from a peer it has high affinity to (P3-A), adopt it into `SocialMemory`, bias its **ambient chat** and — critically — its **task/goal selection** (tie meme strength into `BlackboardManager` scoring, e.g. an "eco" meme boosts planting/cleanup). *This behavior-bias is what keeps it from being a gimmick.*
- **Propagation:** finally use the dormant `BotComms.broadcast()` for proximity-scoped spread.
- **Measurement:** `GET /api/culture` + per-town keyword counts → mirrors Sid's per-town meme curves.
- Optional **carrier archetype** (Sid's "priest"/influencer = just a trait string): a spawn-config flag making a bot seed + push a fixed belief; combined with adoption tracking gives the Pastafarianism-style diffusion demo.

**Files:** `src/personality/AffinityManager.ts`, `src/bot/BotInstance.ts`, `src/voyager/VoyagerLoop.ts` (~515), `src/social/SocialMemory.ts` (P3-A); new `src/social/CultureManager.ts`, `src/social/BotComms.ts` (use broadcast), `src/voyager/BlackboardManager.ts` (meme bias), `src/town/ChronicleGenerator.ts` (reuse LLM pattern), `src/server/api.ts` (+`/api/culture`) (P3-B). **Effort: S–M then M.** **Risk: gimmick if memes don't change behavior (mitigated by task-bias); cap LLM spend — keyword matching for adoption is free, reserve LLM for periodic extraction only.**

**Verification:** P3-A — confirm bot→bot edges form and gate help/trade. P3-B — spawn a carrier, watch a meme's keyword counts rise across towns and an associated task type get boosted.

---

## P4 — PIANO cognition refactor

**Goal:** Stop slow planning from blocking fast reaction, and make **talk cohere with action** via a Cognitive Controller + decision broadcast. Most invasive; deepest payoff for agent quality.

**Current reality:** inside a worker the loop is sequential; `ThreatAssessor.assess`/`OpportunityDetector.scan`/`GoalGenerator.generateGoals` are synchronous but trapped inside `runOneCycle` (blocked during task execution); chat can promise one thing while the bot keeps doing another (chat-extracted tasks only *queue*).

### P4-A: Always-on perception tick + shared AgentState (effort S–M)
- Move `ThreatAssessor`/`OpportunityDetector`/survival-`GoalGenerator` out of `runOneCycle` onto their own short-interval timer (500ms–1s), like the existing `instinctInterval`/`survivalInterval` in `BotInstance`.
- Write results into a small per-bot `AgentState` holder (lives in `VoyagerLoop`); `runOneCycle` *reads* the cached assessment.
- Payoff: react to a spawning creeper *before* damage (today instinct only fires on actual `entityHurt`). Creates the shared-state substrate P4-B and P2b/P3b reuse.

### P4-B: Cognitive Controller + decision broadcast (effort M)
- Replace the imperative priority ladder in `runOneCycle` (`VoyagerLoop.ts:~604–738`) with `voyager/CognitiveController.ts`: reads the **bottlenecked AgentState** (current task, top threat/opportunity/goal, pending chat intents) and emits one `Decision { action, reason, conditioningForTalk }`.
- **Broadcast** the decision: feed `conditioningForTalk` into both `handleChat` and `ProactiveCommunicator` so all speech is conditioned on the same current decision — fixes "say one thing, do another" and stops chat + proactive announcements contradicting each other.

### P4-C: Continuous Action Awareness (effort M; optional)
- Record expected vs. observed effect (inventory/position delta) per primitive step; write a "drift" signal into AgentState; feed the Critic + early-abort. Catches the hallucinated-progress / stuck-loop failure mode (Sid Fig-5A ablation showed this matters).

**Files:** `src/bot/BotInstance.ts` (new `perceptionInterval`); `src/voyager/VoyagerLoop.ts` (read cached state, delegate selection); new `voyager/CognitiveController.ts`; `voyager/ProactiveCommunicator.ts` + `BotInstance.handleChat` (consume broadcast); new `voyager/ActionAwareness.ts` + `CodeExecutor.ts` hooks (P4-C). **Effort: M.** **Risk: most invasive — touches the core loop; do behind a flag with the old path as fallback.**

**Verification:** confirm threat reaction during a long task (no longer blind mid-task); confirm chat statements match the current decision; A/B the CC against the old ladder via `DecisionTrace`/dashboard.

### NOT worth porting (consensus)
- Scaling to 100s of bots (paper's ceiling was the Minecraft server; `maxBots:10`).
- Real currency/market economy (Sid couldn't get fiat to emerge; no liquidity at 10 bots — stop at resource-flow accounting).
- Intra-bot multi-limb parallelism (one action channel; only action+chat are concurrent streams).
- Gossip/second-order reputation (annoying + hallucination-cascade risk; defer).

---

## Config & safety

- Add a `civilization`/`sid` config section (mirror the `security` section pattern in `src/config.ts` + `config.yml` + SECTION_SPECS). Per-feature flags; new behavior-changing features default OFF, P1 metrics default ON.
- Each pillar lands on its own branch with tests; build + restart `dyobot`/`dyobot-web` per CLAUDE.md; verify on the live fleet before merge.
