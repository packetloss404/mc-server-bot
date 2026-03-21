# DyoBot

## Project Overview

DyoBot is a Voyager-style AI-powered Minecraft bot sidecar for DyoCraft. It connects mineflayer bots to a Minecraft server and uses Google Gemini to autonomously plan and execute tasks through code generation, with personality and social relationship systems.

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

## Setup

1. Copy `.env.example` to `.env` and set `GOOGLE_API_KEY`
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
- `src/actions/` - primitive movement, mining, crafting, combat, container actions
- `src/ai/` - Gemini client and prompt logic
- `src/personality/` - affinity, conversation, personality behavior
- `src/server/api.ts` - Express API for bot CRUD and control

## Data

- `data/bots.json`
- `data/affinities.json`
- `skills/`
- `config.yml`
