# DyoBot

## Project Overview

DyoBot is a Voyager-style AI-powered Minecraft bot sidecar for DyoCraft. It connects mineflayer bots to a Minecraft server and uses an LLM to autonomously plan and execute tasks through code generation, with personality and social relationship systems.

## Build & Run

```bash
npm run build
npm run dev
npm start
```

Always start production runs with log capture so logs can be inspected:

```bash
node dist/index.js > /tmp/dyobot.log 2>&1 & disown
```

Before restarting, kill existing instances first:

```bash
lsof -ti:3001 | xargs kill -9 2>/dev/null; sleep 2
```

Useful log commands:

```bash
tail -f /tmp/dyobot.log
grep -E "task proposed|Execution result|task evaluated" /tmp/dyobot.log
```

## Testing

```bash
npm test
```

Tests use Vitest. Configuration is in `vitest.config.ts`.

## Setup

1. Copy `.env.example` to `.env` and set the API key for the configured provider (`GOOGLE_API_KEY` for Gemini, `ANTHROPIC_API_KEY` for Anthropic)
2. Configure `config.yml`
3. Run `npm install && npm run build && npm start`

## Spawning Bots

```bash
curl -s -X POST http://127.0.0.1:3001/api/bots \
  -H 'Content-Type: application/json' \
  -d '{"name":"BotName","personality":"farmer","mode":"codegen"}'
```

Available personalities: merchant, guard, explorer, farmer, blacksmith, elder

## Checking Status

```bash
curl -s http://127.0.0.1:3001/api/bots
```

## Architecture

- `src/bot/` - bot lifecycle and Mineflayer connection management
- `src/voyager/` - curriculum, action, critic, skill library, execution loop
- `src/actions/` - primitive movement, mining, crafting, combat, container, patrol actions
- `src/ai/` - LLM client abstraction with Gemini and Anthropic implementations
- `src/personality/` - affinity, conversation, personality behavior
- `src/server/api.ts` - Express API for bot CRUD, dashboard, and control
- `src/server/socketEvents.ts` - Socket.IO real-time event broadcasting
- `src/server/EventLog.ts` - in-memory circular event buffer
- `src/worker/` - worker thread handles, IPC channel, and proxies for cross-thread access
- `src/util/` - logger, sleep, and shared utilities
- `src/config.ts` - YAML config loader and `Config` interface

## API Endpoints

### Core Bot Management

- `GET /api/status` - health check (returns bot count)
- `GET /api/bots` - list all bots (basic status)
- `GET /api/bots/:name` - get single bot (basic status)
- `POST /api/bots` - create a bot (body: `{name, personality, location?, mode?}`)
- `DELETE /api/bots/:name` - remove a single bot
- `DELETE /api/bots` - remove all bots
- `POST /api/bots/:name/mode` - set bot mode (body: `{mode: "primitive"|"codegen"}`)

### Event Relay (Java plugin integration)

- `POST /api/events/chat` - relay chat event (body: `{playerName, message, nearestBot}`)
- `POST /api/events/player-join` - relay player join (body: `{playerName}`)
- `POST /api/events/player-leave` - relay player leave (body: `{playerName}`)

### Dashboard Endpoints

- `GET /api/bots/:name/detailed` - enriched bot status (cached from worker)
- `GET /api/bots/:name/inventory` - bot inventory items
- `GET /api/bots/:name/relationships` - bot affinity scores
- `GET /api/bots/:name/conversations` - bot conversation history
- `GET /api/bots/:name/tasks` - bot task state (current, queued, completed, failed)
- `GET /api/relationships` - full social graph (all bots and players)
- `GET /api/skills` - list all learned skills with code preview
- `GET /api/skills/:name` - get single skill with full code
- `GET /api/world` - aggregate world state (time, weather, online count)
- `GET /api/blackboard` - shared blackboard state
- `GET /api/activity` - activity event log (query: `limit`, `bot`, `type`)

### Bot Interaction

- `POST /api/bots/:name/chat` - send chat message to bot (body: `{playerName, message}`)
- `POST /api/bots/:name/task` - queue a task for bot (body: `{description}`)
- `POST /api/swarm` - set a swarm directive (body: `{description, requestedBy?}`)

### Socket.IO Events (real-time)

- `bot:spawn` - bot created
- `bot:disconnect` - bot removed
- `bot:position` - bot position changed
- `bot:health` - bot health/food changed
- `bot:state` - bot state changed
- `bot:inventory` - bot inventory changed
- `bot:task` - task queued
- `world:time` - world time update (every 30s)
- `activity` - general activity event

### Static Assets

- `GET /` - redirects to `/dashboard/`
- `GET /dashboard/*` - static dashboard files

## Data

- `data/bots.json` - bot spawn configurations
- `data/affinities.json` - player-bot relationship affinities
- `data/social_memory.json` - bot-to-bot social memory
- `data/world_memory.json` - shared world knowledge
- `data/blackboard.json` - shared blackboard state
- `data/completed_tasks.json` - completed voyager tasks
- `data/failed_tasks.json` - failed voyager tasks
- `data/stats.json` - bot statistics
- `data/qa_cache.json` - Q&A cache for AI responses
- `data/qa_embeddings.json` - Q&A embeddings
- `data/blockers.json` - blocker tracking
- `skills/` - learned skill code files
- `config.yml` - main runtime configuration
