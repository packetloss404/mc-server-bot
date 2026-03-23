# AGENTS.md

Guidance for coding agents working in `D:\projects\mc-server-bot`.

## Repository Shape

- This repo has two TypeScript apps:
- Backend bot sidecar in the repository root (`src/`, compiled to `dist/`).
- Frontend dashboard in `web/` (Next.js App Router).
- Core backend domains:
- `src/bot/` bot lifecycle and Mineflayer connection handling.
- `src/voyager/` task planning, code execution, critic loop, skill storage.
- `src/actions/` primitive bot actions.
- `src/personality/` affinity and conversation systems.
- `src/social/` bot-to-bot messaging and memory.
- `src/control/` fleet control platform (commands, missions, markers, squads, roles, commander).
- `src/server/` Express + Socket.IO API.

## Source Of Truth

- Follow existing code over generic style advice.
- Respect `CLAUDE.md` in the repo root; it contains operational project notes.
- No `.cursorrules`, `.cursor/rules/`, or `.github/copilot-instructions.md` files were present when this file was written.
- There was no existing repo-root `AGENTS.md`; this file is the canonical agent guide.

## Environment And Setup

- Install backend deps from the repo root with `npm install`.
- Install frontend deps with `npm install --prefix web` if needed.
- Copy `.env.example` to `.env` and set `GOOGLE_API_KEY` for AI-enabled bot behavior.
- Main runtime config lives in `config.yml`.
- Persistent data is stored under `data/` and learned skills under `skills/`.

## Build, Lint, Test, Run

### Backend (repo root)

- Build: `npm run build`
- Dev run: `npm run dev`
- Production run: `npm start`
- Preferred production run with log capture: `node dist/index.js > /tmp/dyobot.log 2>&1 & disown`
- Before restarting a server process, kill the old listener first: `lsof -ti:3001 | xargs kill -9 2>/dev/null; sleep 2`

### Frontend (`web/`)

- Dev run: `npm run dev --prefix web`
- Build: `npm run build --prefix web`
- Start built app: `npm run start --prefix web`
- Lint entire frontend: `npm run lint --prefix web`
- Lint a single file: `npm run lint --prefix web -- src/app/page.tsx`
- Lint a folder: `npm run lint --prefix web -- src/components`

### Testing

Run all backend tests:
```bash
npm test
```

Run backend tests in watch mode:
```bash
npm run test:watch
```

Run a specific test file:
```bash
npx vitest run test/control/CommandCenter.test.ts
```

Run all control platform tests:
```bash
npx vitest run test/control/
```

Available test files:
- `test/control/CommandCenter.test.ts` - command dispatch, cancellation, timeout, fan-out
- `test/control/MissionManager.test.ts` - mission lifecycle, VoyagerLoop bridge, dependencies, queues
- `test/control/MarkerStore.test.ts` - markers, zones, routes, spatial lookup, zone containment
- `test/control/SquadManager.test.ts` - squad CRUD, membership, getSquadsForBot
- `test/control/RoleManager.test.ts` - role assignments, one-role-per-bot, overrides, expiry
- `test/control/CommanderService.test.ts` - NL parsing (with/without LLM), plan execution
- `test/control/integration.test.ts` - cross-service integration (commands, missions, markers, squads)

Run frontend tests:
```bash
cd web && npm test
```

### Useful Runtime Checks

- Bot API status: `curl -s http://127.0.0.1:3001/api/status`
- List bots: `curl -s http://127.0.0.1:3001/api/bots`
- Stream logs: `tail -f /tmp/dyobot.log`
- Filter important backend log events: `grep -E "task proposed|Execution result|task evaluated" /tmp/dyobot.log`

## Control Platform Services (`src/control/`)

The control platform provides centralized fleet management:

- **CommandCenter** (`CommandCenter.ts`) - Dispatches immediate bot commands (pause, resume, stop, move, follow, guard, patrol, unstuck). Handles fan-out for multi-bot commands, timeout detection, concurrent command protection, and cancellation with pathfinder cleanup.
- **MissionManager** (`MissionManager.ts`) - Manages longer-running missions with full lifecycle (draft, queued, running, paused, completed, failed, cancelled). Bridges to VoyagerLoop for `queue_task` missions, checks command dependencies before starting, detects stale missions, and maintains per-bot priority queues.
- **MarkerStore** (`MarkerStore.ts`) - Persists world markers (named 3D positions), zones (rectangular or circular 2D areas), and routes (ordered waypoint sequences). Provides spatial helpers: `findNearestMarker` and `isInsideZone`.
- **SquadManager** (`SquadManager.ts`) - CRUD for squads with bot membership management. Supports `getSquadsForBot` lookup.
- **RoleManager** (`RoleManager.ts`) - One-role-per-bot assignment system with autonomy levels (manual, assisted, autonomous). Tracks manual overrides with 5-minute auto-expiry.
- **CommanderService** (`CommanderService.ts`) - Natural language command parsing via LLM. Produces structured plans with confidence scores, then executes plans by dispatching commands and creating missions.

## API Endpoint Summary

### Bot Management
- `GET /api/status` - server status
- `GET/POST/DELETE /api/bots` - list, create, delete all bots
- `GET/DELETE /api/bots/:name` - get or delete a specific bot
- `POST /api/bots/:name/mode` - change bot mode
- `GET /api/bots/:name/detailed` - detailed bot info
- `GET /api/bots/:name/inventory` - bot inventory
- `GET /api/bots/:name/relationships` - bot relationships
- `GET /api/bots/:name/conversations` - bot conversation history
- `GET /api/bots/:name/tasks` - bot task history
- `POST /api/bots/:name/chat` - send chat as bot
- `POST /api/bots/:name/task` - queue a task

### Bot Actions (convenience shortcuts)
- `POST /api/bots/:name/pause` - pause voyager
- `POST /api/bots/:name/resume` - resume voyager
- `POST /api/bots/:name/stop` - stop movement
- `POST /api/bots/:name/follow` - follow a player
- `POST /api/bots/:name/walkto` - walk to coordinates

### Commands
- `POST/GET /api/commands` - create and list commands
- `GET /api/commands/:id` - get a command
- `POST /api/commands/:id/cancel` - cancel a command

### Missions
- `POST/GET /api/missions` - create and list missions
- `GET /api/missions/:id` - get a mission
- `POST /api/missions/:id/start|pause|resume|cancel|retry` - lifecycle actions
- `GET/PATCH /api/bots/:name/mission-queue` - per-bot mission queue

### World (Markers, Zones, Routes)
- `GET/POST /api/markers` - list and create markers
- `PATCH/DELETE /api/markers/:id` - update and delete
- `GET/POST /api/zones` - list and create zones
- `PATCH/DELETE /api/zones/:id` - update and delete
- `GET/POST /api/routes` - list and create routes
- `PATCH/DELETE /api/routes/:id` - update and delete

### Squads
- `GET/POST /api/squads` - list and create squads
- `GET/PATCH/DELETE /api/squads/:id` - CRUD
- `POST /api/squads/:id/members` - add bot
- `DELETE /api/squads/:id/members/:botName` - remove bot

### Roles
- `GET /api/roles` - list all role assignments
- `POST /api/roles/assignments` - create assignment
- `GET/PATCH/DELETE /api/roles/assignments/:id` - CRUD
- `GET/DELETE /api/bots/:name/override` - get/clear override

### Commander (NL parsing)
- `POST /api/commander/parse` - parse natural language into a plan
- `POST /api/commander/execute` - execute a parsed plan

### Other
- `GET /api/relationships` - all bot relationships
- `GET /api/skills` - list skills
- `GET /api/skills/:name` - get a skill
- `GET /api/world` - world state
- `GET /api/blackboard` - shared blackboard
- `GET /api/activity` - activity log
- `POST /api/swarm` - spawn multiple bots
- `POST /api/events/chat|player-join|player-leave` - event hooks

## Running the Dashboard

Backend (port 3001):
```bash
npm run build && npm start
```

Frontend (port 3000, in a separate terminal):
```bash
npm run dev --prefix web
```

The frontend connects to the backend API at `http://localhost:3001` and uses Socket.IO for real-time updates.

## Verified Commands

- `npm run build` in the repo root succeeds.
- `npm run lint --prefix web` currently reports existing frontend warnings and errors.
- Do not assume the frontend is lint-clean before making changes; check whether failures are pre-existing.

## TypeScript And Build Expectations

- Backend TypeScript is strict (`strict: true`) and compiles with `tsc` to `dist/`.
- Backend module target is CommonJS.
- Frontend TypeScript is also strict and uses Next.js bundler resolution.
- Frontend path alias `@/*` maps to `web/src/*`.
- Avoid introducing new tsconfig relaxations unless absolutely necessary.

## Import Conventions

- Keep imports at the top of the file.
- Backend usually groups imports as: external packages, then local relative imports.
- Frontend usually prefers project alias imports like `@/components/...` and `@/lib/...` over deep relative paths.
- Use `import type` for type-only imports when practical; the repo already does this in multiple places.
- Prefer named exports for utilities, functions, classes, and interfaces.
- Re-export small action surfaces through barrel files only where the repo already does so, such as `src/actions/index.ts`.

## Formatting Conventions

- Backend files predominantly use single quotes and semicolons.
- Frontend files are mixed, but many current files also use single quotes; preserve the style of the file you touch.
- Use 2-space indentation.
- Keep object literals and JSX props multiline when they become dense.
- Prefer trailing commas in multiline objects, arrays, params, and JSX where existing formatting already uses them.
- Do not reformat unrelated files just to normalize quote style.

## Naming Conventions

- Classes, interfaces, type aliases, enums: `PascalCase`.
- Functions, methods, variables, object keys: `camelCase`.
- Constants that are true constants or config arrays: `UPPER_SNAKE_CASE`.
- Filenames for backend classes and domain modules often use `PascalCase.ts` (`BotManager.ts`, `VoyagerLoop.ts`).
- Filenames for simple action helpers often use `camelCase.ts` (`mineBlock.ts`, `walkTo.ts`).
- Route/page files in Next.js must follow framework naming (`page.tsx`, `layout.tsx`).

## Types And Data Modeling

- Prefer explicit interfaces and type aliases for API shapes and domain records.
- Reuse existing exported types instead of recreating parallel shapes.
- Keep backend request and response payloads structurally simple and JSON-friendly.
- Prefer `Record<string, T>` for map-like JSON data already persisted or returned by APIs.
- Minimize `any`; existing backend code uses `any` at third-party or parsing boundaries, but new code should prefer narrowing.
- In the frontend, ESLint currently enforces `@typescript-eslint/no-explicit-any`; avoid introducing new `any` there.
- Use union string literals for finite states, modes, and statuses when practical.

## Error Handling

- Fail early on invalid input and return structured errors.
- In Express handlers, validate request data first and respond with `400`, `404`, `409`, or `500` as appropriate.
- After sending an Express response in a guard branch, `return` immediately.
- Log operational failures with the shared `logger` from `src/util/logger.ts`.
- Include contextual fields in logs (`bot`, `player`, `filename`, etc.) when they aid diagnosis.
- Throw `Error` objects for fatal backend failures; return `{ success: false, message }` for action-style helper results.
- Preserve existing user-facing phrasing unless there is a reason to improve clarity.

## Backend Coding Patterns

- Keep bot action helpers small and outcome-oriented; they usually return `{ success, message, data? }`.
- Normalize bot lookup keys with `name.toLowerCase()` when interacting with `BotManager` maps.
- Prefer synchronous filesystem access only in startup/load/save paths where the repo already does that.
- Keep API route logic thin; push behavior into coordinators, managers, or domain classes when it grows.
- Use the shared singleton logger instead of ad hoc `console.log`.
- Preserve Mineflayer and Socket.IO integration patterns already established in the repo.

## Frontend Coding Patterns

- Add `'use client';` only when a component actually needs client-side hooks or browser APIs.
- Prefer Zustand store access through selectors (`useBotStore((s) => s.botList)`).
- Keep API access centralized in `web/src/lib/api.ts`.
- Prefer typed props and typed API responses.
- Use existing visual language and Tailwind utility patterns rather than inventing a separate design system.
- Keep pages focused on orchestration and rendering; move reusable UI into `web/src/components/`.

## State, Side Effects, And React

- Keep effects for I/O, subscriptions, and synchronization work.
- Avoid introducing new lint violations around `setState` inside effects, ref mutation during render, or missing dependencies.
- Derive UI state from props/store when possible instead of duplicating it locally.
- Memoize callbacks only when it meaningfully helps dependency stability or expensive rendering.

## Working In A Dirty Repo

- The working tree may contain user changes.
- Never revert or overwrite unrelated edits you did not make.
- If a file already has unrelated modifications, make the smallest safe change that solves the task.
- When reporting results, distinguish your changes from pre-existing lint or code issues.

## Files And Generated Artifacts

- Do not hand-edit `dist/` unless the user explicitly asks.
- Make source changes in `src/` and `web/src/`.
- Treat `data/` and `skills/` as runtime artifacts unless the task is specifically about their contents.
- Avoid committing secrets from `.env` or other local-only files.

## Suggested Agent Workflow

- Read the relevant source files first and infer local conventions before editing.
- For backend changes, run `npm run build` from the repo root.
- For frontend changes, run `npm run lint --prefix web` on touched files or the full app when practical.
- If you add a new command, script, or workflow, update this file.
- If you add tests, include both full-suite and single-test commands here.
