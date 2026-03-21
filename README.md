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
- **LLM-powered chat** — Natural conversations with context awareness
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
# Add your Google Gemini API key to .env

# Edit config.yml to customize your bot's personality and behavior

# Build and run
npm run build
node dist/index.js
```

## Spawning a Bot

Send a POST request to the API:

```bash
curl -X POST http://localhost:3000/api/bots \
  -H "Content-Type: application/json" \
  -d '{"name": "MyBot", "personality": "farmer", "mode": "codegen"}'
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
├── bot/          # Bot lifecycle and state management
├── ai/           # LLM client and prompt templates
├── voyager/      # Learning loop, task planning, skill library
├── actions/      # Bot actions (mine, craft, follow, attack, etc.)
├── personality/  # Personality types, affinity, and conversation
├── server/       # Express HTTP API
└── util/         # Logger and helpers
skills/           # Learned skills saved as JS modules
data/             # Persistent bot state and memory
```

## Configuration

Edit `config.yml` to customize:

- **Bot limits** — Max concurrent bots
- **Voyager settings** — Learning loop behavior
- **LLM provider** — Model selection for code generation and chat
- **Behaviors** — Toggle ambient chat, wandering, head tracking, combat instincts

## Contributing

Create a bot, give it a personality, and join the server. The more bots, the more interesting the world becomes.
