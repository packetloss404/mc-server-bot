# mc-server-bot

Build your own AI-powered Minecraft bot and have it interact with everyone else on **play.dyoburon.com**.

## What is this?

This is an open Minecraft bot framework where you create your own bot with a unique personality, deploy it to our shared server, and watch it interact with other players and bots in real time. Bots learn, trade, fight, farm, and hold conversations — all autonomously.

Each bot uses a Voyager-style learning loop powered by LLMs. It proposes tasks for itself, writes code to accomplish them, evaluates success, and saves learned skills for reuse. Over time, your bot gets smarter.

## Server

**play.dyoburon.com**

Java Edition 1.21+

## Features

- **Personality system** — Choose from merchant, guard, explorer, farmer, blacksmith, or elder archetypes
- **Autonomous learning** — Bots propose, execute, and evaluate their own tasks
- **Skill library** — Learned skills are saved and reused across sessions
- **Affinity tracking** — Bots remember players and build relationships
- **Social memory** — Bot-to-bot messaging and shared world knowledge
- **LLM-powered chat** — Natural conversations with context awareness
- **Fleet control platform** — Centralized commands, missions, squads, roles, and world markers
- **Town & civilization layer** — Towns with residents, roles, schedules, decrees, trade routes, diplomacy, and a schematic-based build coordinator
- **Impersonation defense** — Detects when someone logs in under a bot's username (a duplicate-login kick), quarantines the impersonated bot, and alerts you
- **Natural language commander** — Issue orders in plain English, parsed into structured plans
- **Web dashboard** — Next.js dashboard for monitoring and controlling your fleet
- **HTTP API** — Spawn and manage bots programmatically

## Quick Start

```bash
# Clone the repo
git clone https://github.com/dyoburon/mc-server-bot.git
cd mc-server-bot

# Install dependencies
npm install

# Configure your bot
cp .env.example .env
# Add your API key to .env (ANTHROPIC_API_KEY for Anthropic, GOOGLE_API_KEY for Gemini)

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
├── ai/           # LLM client and prompt logic (Anthropic, Gemini)
├── voyager/      # Learning loop, task planning, skill library
├── actions/      # Bot actions (mine, craft, follow, attack, etc.)
├── personality/  # Personality types, affinity, and conversation
├── social/       # Bot-to-bot messaging, memory, and culture
├── control/      # Fleet control platform (commands, missions, squads, roles, markers)
├── town/         # Towns, residents, roles, decrees/governance, trade, diplomacy
├── build/        # Schematic-based multi-bot build coordination
├── supplychain/  # Supply chain templates and coordination
├── security/     # Impersonation detection
├── worker/       # Per-bot worker threads and IPC proxies
├── server/       # Express HTTP API and socket events
└── util/         # Logger and helpers
web/              # Next.js dashboard
skills/           # Learned skills saved as JS modules
data/             # Persistent bot state and memory (gitignored)
```

## Control Platform

The control platform provides centralized fleet management:

- **Commands** — Immediate bot actions (pause, move, follow, guard, patrol) with dispatch and cancellation
- **Missions** — Longer-running tasks with lifecycle management (start, pause, cancel, retry), dependency checking, and per-bot priority queues
- **Squads** — Group bots into squads for coordinated operations
- **Roles** — Assign roles with autonomy levels and manual override tracking
- **World markers** — Named positions, zones (rectangular/circular areas), and routes (waypoint sequences)
- **Natural language commander** — Parse plain English orders into structured plans and execute them

## Experimental: Project Sid concepts

Inspired by [*Project Sid: Many-agent simulations toward AI civilization*](https://arxiv.org/abs/2411.00114), these capabilities are **flag-gated and OFF by default** — enable them per the `security`/`governance`/`social`/`cognition` sections in `config.yml`. See [`docs/project-sid-roadmap.md`](docs/project-sid-roadmap.md).

- **Civilization metrics + emergent roles** (read-only, always on) — infers each bot's role from what it actually does and reports role-distribution entropy, action exclusivity, and cumulative unique items (`GET /api/metrics/civilization`, `GET /api/bots/:name/observed-role`).
- **Governance that bites** (`governance.enabled`) — mayor decrees become standing town rules that bias task selection and are injected into resident prompts; bots can propose rules through the approval/vote workflow.
- **Culture & social spread** (`social.botAffinity`, `social.culture`) — bot↔bot affinity gates cooperation; emergent keyword "memes" adopted from trusted peers bias behavior (`GET /api/culture`).
- **PIANO cognition** (`cognition.perceptionTick`, `cognition.cognitiveController`) — an independent perception tick lets a bot react to threats mid-task; a cognitive controller broadcasts its current decision so chat stays coherent with action.

## API

The bot server runs on port **3001** and exposes REST endpoints for:

- Bot CRUD and status
- Command dispatch and cancellation
- Mission lifecycle management
- Per-bot mission queues
- World markers, zones, and routes
- Squad and role management
- Natural language command parsing and execution

## Configuration

Edit `config.yml` to customize:

- **Bot limits** — Max concurrent bots
- **Voyager settings** — Learning loop behavior
- **LLM provider** — Model selection for code generation and chat (Anthropic or Gemini)
- **Behaviors** — Toggle ambient chat, wandering, head tracking, combat instincts
- **Security** — `security.impersonationDetection` (impersonation defense, on by default) and `IMPERSONATION_ALERT_WEBHOOK` env var for outbound alerts
- **Experimental flags** — `governance`, `social`, and `cognition` sections gate the Project Sid features above (all default off)

## Contributing

Create a bot, give it a personality, and join the server. The more bots, the more interesting the world becomes.
