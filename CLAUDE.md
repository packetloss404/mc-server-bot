# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DyoBot is a Voyager-style AI-powered Minecraft bot sidecar for DyoCraft. It connects mineflayer bots to a Minecraft server and uses Google Gemini LLM to autonomously plan and execute tasks through code generation, with a personality and social relationship system.

## Build & Run Commands

```bash
npm run build     # Compile TypeScript (src/ → dist/)
npm run dev       # Run with tsx in development mode
npm start         # Run compiled dist/index.js in production
```

No test or lint scripts are configured.

## Setup

1. Copy `.env.example` → `.env` and set `GOOGLE_API_KEY` (Google Gemini)
2. Configure `config.yml` with Minecraft server details
3. `npm install && npm run build && npm start`

## Architecture

The system has two bot execution modes:
- **PRIMITIVE** — Executes built-in action functions directly (walkTo, mineBlock, craft, etc.)
- **CODEGEN** — Runs a Voyager-style AI loop that generates and executes JavaScript code for complex tasks

### Core Flow

`index.ts` loads config, initializes the Gemini LLM client, creates a `BotManager`, and starts an Express API server (default port 3001).

### Key Modules

- **`src/bot/`** — `BotManager` spawns/removes multiple `BotInstance`s. Each instance manages a mineflayer connection, event handlers, and behavior loops. State persisted to `data/bots.json`.
- **`src/voyager/`** — The Voyager AI loop with three LLM agents:
  - `CurriculumAgent` — suggests tasks based on bot state and personality
  - `ActionAgent` — generates JavaScript code to accomplish tasks
  - `CriticAgent` — evaluates whether tasks succeeded
  - `CodeExecutor` — runs generated JS in a sandboxed VM with whitelisted mineflayer APIs
  - `SkillLibrary` — stores successful code as reusable skills (keyword-based retrieval), pre-loaded from `skills/`
- **`src/actions/`** — Primitive action implementations (pathfinding, mining, crafting, combat, etc.)
- **`src/ai/`** — `GeminiClient` implements the abstract `LLMClient` interface. Prompt templates in `src/ai/prompts/`.
- **`src/personality/`** — 6 preset personality types (merchant, guard, elder, explorer, blacksmith, farmer), `AffinityManager` tracks per-player relationship scores (0–100), `ConversationManager` holds chat history.
- **`src/server/api.ts`** — Express REST API for bot CRUD, mode toggling, and event relay (chat, player join/leave).

### Data & Persistence

- `data/bots.json` — persisted bot instances (created at runtime)
- `data/affinities.json` — player affinity scores (created at runtime)
- `skills/` — 24 pre-made skill JS files with `skills/index.json` metadata
- `config.yml` — all runtime configuration (server, LLM, behavior, limits)

### TypeScript

- Target: ES2022, Module: CommonJS, strict mode enabled
- Source maps and declaration maps enabled
