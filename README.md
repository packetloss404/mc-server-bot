# mc-server-bot

Build your own AI-powered Minecraft bot — and stand up an entire autonomous bot fleet, town, and AI civilization — on **play.dyoburon.com**.

## What is this?

This is an open Minecraft bot framework where you create your own bot with a unique personality, deploy it to our shared server, and watch it interact with other players and bots in real time. Bots learn, trade, fight, farm, and hold conversations — all autonomously.

Each bot uses a Voyager-style learning loop powered by LLMs: it proposes tasks for itself, **writes JavaScript to accomplish them, runs that code in a `vm` sandbox** (with timeout/interrupt/log capping), evaluates success with a critic agent, and saves working behaviors as reusable skills. Skills aren't just dumped to disk — they're retrieved by **hybrid semantic search** (per-skill TF-IDF sparse vectors + dense embeddings, cosine-scored), so a bot recalls the *relevant* past skill for a new task. Over time, your bot gets smarter.

That's the single-bot story. The repo is also the full **fleet + civilization platform** that runs on top: each bot is its own OS worker thread, a centralized control plane drives missions/squads/roles, and an autonomous **TownBrain** runs whole simulated societies with governance, diplomacy, economy, and a closed-loop generative-architecture build pipeline. A ~30k-LOC Next.js dashboard and a 200+ route HTTP API sit in front of all of it.

## Server

**play.dyoburon.com** — Java Edition 1.21+

## Features

### Per-bot intelligence
- **Voyager learning loop** — Bots propose tasks, generate code, run it in a sandboxed Node `vm`, critique the result, and persist what works
- **Hybrid skill memory** — Learned skills are retrieved by combined TF-IDF + dense-embedding similarity, not just filename lookup; a `backfill-embeddings` batch tool re-embeds the whole library
- **Personality system** — Merchant, guard, explorer, farmer, blacksmith, or elder archetypes
- **Affinity & social memory** — Bots remember players, build relationships, message each other, and share world knowledge
- **PIANO-style cognition** — Independent perception tick + cognitive controller keep chat coherent with the action a bot is actually taking
- **LLM-powered chat** — Natural, context-aware conversation

### Multi-provider LLM router
- **7 provider clients** — Anthropic, Gemini, OpenAI, MiniMax, Ollama, and VoyageAI behind a single `ModelRouter`
- **Per-task-type routing** — Different models for codegen, chat, design, embeddings, etc.
- **Production resilience** — Circuit breaker, retry/backoff, terminal-vs-retryable error classification, LRU embedding cache, and a `TokenLedger` that tracks cost per call

### Fleet control plane
- **Commands** — Immediate bot actions (pause, move, follow, guard, patrol) with dispatch and cancellation
- **Missions** — Longer-running tasks with full lifecycle (start, pause, cancel, retry), dependency checking, and per-bot priority queues
- **Squads & roles** — Group bots for coordinated ops; assign roles with autonomy levels and manual-override tracking
- **World markers** — Named positions, zones (rectangular/circular), and waypoint routes
- **Natural language commander** — Issue orders in plain English; an LLM parses them to structured plans (with regex fallback and clarification questions)

### Town & civilization layer
- **Autonomous TownBrain** — A 60s tick drives five sub-loops: demand → build → role → schedule → threat
- **Governance that bites** — Mayor decrees become standing rules that bias task selection and are injected into resident prompts; bots propose rules through an approval/vote workflow
- **Diplomacy & economy** — Inter-town diplomacy, trade routes, district planning, and expansion (seeding child towns)
- **Phoenix rebirth & chronicles** — Failed towns can be rebuilt by a `PhoenixManager`; a `ChronicleGenerator` writes the town's narrative history
- **Civilization metrics** — Infers each bot's role from its actual behavior and reports role-distribution entropy, action exclusivity, and unique-item accumulation

### Generative architecture build pipeline
- **LLM design → real schematic → multi-bot build** — An LLM designs a building, the design is validated into a `BlockPlan`, encoded into a genuine gzip **Sponge-v2 `.schem`** file, then constructed by a multi-bot build coordinator with auto-gather and site preparation

### Operations
- **Worker-thread-per-bot** — Each bot runs in its own `worker_threads` worker; shared singletons (affinity, culture, world model, comms, LLM) are reached through typed IPC proxy classes so cross-bot state stays authoritative on the main thread
- **Live 3D viewer** — Per-bot prismarine-viewer (three.js/WebGL) spins up lazily only when you open a View tab in the dashboard
- **Impersonation defense** — Detects duplicate-login kicks plus ghost-name corroboration, quarantines the impersonated bot, and fires an outbound webhook alert
- **Web dashboard** — Next.js dashboard for map, fleet, town, skill graph, and decision/LLM trace timelines
- **HTTP API** — 200+ REST routes plus socket.io events to spawn, drive, and observe everything programmatically

## Quick Start

```bash
# Clone the repo
git clone https://github.com/dyoburon/mc-server-bot.git
cd mc-server-bot

# Install dependencies
npm install

# Configure your bot
cp .env.example .env
# Add your API key(s) to .env. At minimum one LLM provider:
#   ANTHROPIC_API_KEY   (Anthropic)
#   GOOGLE_API_KEY      (Gemini — also used for skill embeddings)
#   OPENAI_API_KEY / MINIMAX_API_KEY / VOYAGE_API_KEY  (optional)
#   Ollama runs locally, no key needed

# Edit config.yml to customize your bot's personality and behavior

# Build and run
npm run build
npm start
```

## Spawning a Bot

Send a POST request to the API:

```bash
curl -X POST http://localhost:3001/api/bots \
  -H "Content-Type: application/json" \
  -d '{"name": "MyBot", "personality": "farmer", "mode": "codegen"}'
```

Check status:

```bash
curl -s http://localhost:3001/api/bots
```

### Available Personalities

| Personality | Description |
|---|---|
| `merchant` | Trades items and announces wares |
| `guard` | Patrols and protects areas |
| `explorer` | Roams and discovers the world |
| `farmer` | Farms crops and tends animals |
| `blacksmith` | Mines, smelts, and crafts |
| `elder` | Wise advisor, shares knowledge |

## Project Structure

```
src/
├── bot/          # Bot lifecycle and Mineflayer connection management
├── ai/           # ModelRouter + 7 provider clients, token ledger, embedding cache
├── voyager/      # Learning loop, curriculum/action/critic agents, code executor, skill library
├── actions/      # Bot actions (mine, craft, follow, attack, etc.)
├── personality/  # Personality types, affinity, and conversation
├── social/       # Bot-to-bot messaging, memory, and culture
├── control/      # Fleet control plane (commands, missions, squads, roles, markers, commander)
├── town/         # TownBrain: governance, diplomacy, trade, districts, expansion, chronicles
├── build/        # LLM design → BlockPlan → Sponge .schem → multi-bot build coordinator
├── supplychain/  # Supply chain templates and coordination
├── security/     # Impersonation detection
├── worker/       # Per-bot worker threads and IPC proxies
├── server/       # Express HTTP API (200+ routes) and socket events
└── util/         # Logger and helpers
web/              # Next.js dashboard
skills/           # Learned skills saved as JS modules (the library grows as bots run)
data/             # Persistent bot state and memory (gitignored)
```

Persistence is **Drizzle ORM over better-sqlite3**, with a schema kept deliberately Postgres-portable (text PKs, epoch-ms ints, JSON-as-text).

## Control Platform

The control platform provides centralized fleet management:

- **Commands** — Immediate bot actions (pause, move, follow, guard, patrol) with dispatch and cancellation
- **Missions** — Longer-running tasks with lifecycle management (start, pause, cancel, retry), dependency checking, and per-bot priority queues
- **Squads** — Group bots into squads for coordinated operations
- **Roles** — Assign roles with autonomy levels and manual override tracking
- **World markers** — Named positions, zones (rectangular/circular areas), and routes (waypoint sequences)
- **Natural language commander** — Parse plain English orders into structured plans and execute them

## Project Sid concepts

Inspired by [*Project Sid: Many-agent simulations toward AI civilization*](https://arxiv.org/abs/2411.00114). The civilization-metrics layer is read-only and always on; the rest are **flag-gated** via the `security`/`governance`/`social`/`cognition` sections in `config.yml`. See [`docs/project-sid-roadmap.md`](docs/project-sid-roadmap.md).

- **Civilization metrics + emergent roles** (read-only, always on) — infers each bot's role from what it actually does and reports role-distribution entropy, action exclusivity, and cumulative unique items (`GET /api/metrics/civilization`, `GET /api/bots/:name/observed-role`).
- **Governance that bites** (`governance.enabled`) — mayor decrees become standing town rules that bias task selection and are injected into resident prompts; bots can propose rules through the approval/vote workflow.
- **Culture & social spread** (`social.botAffinity`, `social.culture`) — bot↔bot affinity gates cooperation; emergent keyword "memes" adopted from trusted peers bias behavior (`GET /api/culture`).
- **PIANO cognition** (`cognition.perceptionTick`, `cognition.cognitiveController`) — an independent perception tick lets a bot react to threats mid-task; a cognitive controller broadcasts its current decision so chat stays coherent with action.

## API

The bot server runs on port **3001** and exposes 200+ REST endpoints (plus socket.io event streams) covering:

- Bot CRUD and status
- Command dispatch and cancellation
- Mission lifecycle management and per-bot mission queues
- World markers, zones, and routes
- Squad and role management
- Natural language command parsing and execution
- Town, governance, culture, and civilization-metrics reads
- Skill library and decision/LLM trace inspection

## Configuration

Edit `config.yml` to customize:

- **Bot limits** — Max concurrent bots
- **Voyager settings** — Learning loop behavior
- **LLM providers** — Per-task model selection across Anthropic, Gemini, OpenAI, MiniMax, Ollama, and VoyageAI, routed through `ModelRouter`
- **Behaviors** — Toggle ambient chat, wandering, head tracking, combat instincts
- **Security** — `security.impersonationDetection` (impersonation defense, on by default) and `IMPERSONATION_ALERT_WEBHOOK` env var for outbound alerts
- **Project Sid flags** — `governance`, `social`, and `cognition` sections gate the features above (all default off)

## Tech

TypeScript on Node 22 (tsx/tsc) · Mineflayer + pathfinder + collectblock + prismarine-schematic/viewer · Express 4 + socket.io · Drizzle ORM + better-sqlite3 · pino · Next.js 15 + React. LLMs: Anthropic, Gemini, OpenAI, MiniMax, Ollama, VoyageAI.

## Contributing

Create a bot, give it a personality, and join the server. The more bots, the more interesting the world becomes.
