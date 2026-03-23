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

### Tests

- There is currently no committed backend or frontend test runner configuration.
- No `test`, `test:unit`, `vitest`, `jest`, or Playwright script is defined in either `package.json`.
- There are also no committed `*.test.*` or `*.spec.*` files in the repo.
- Because of that, there is no supported single-test command today.
- If you add tests, also add a package script and document a single-test invocation pattern in this file.

### Useful Runtime Checks

- Bot API status: `curl -s http://127.0.0.1:3001/api/status`
- List bots: `curl -s http://127.0.0.1:3001/api/bots`
- Stream logs: `tail -f /tmp/dyobot.log`
- Filter important backend log events: `grep -E "task proposed|Execution result|task evaluated" /tmp/dyobot.log`

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
