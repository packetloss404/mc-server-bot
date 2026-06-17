# DyoBot — Repository Engineering Review

_Senior staff engineering review. Date: 2026-06-17. Scope: full repository (backend `src/`, frontend `web/`, tests, config, docs). Read-only — no application code changed._

---

## A. Executive Summary

DyoBot is a Voyager-style, LLM-driven Mineflayer bot sidecar for the public Minecraft server `play.dyoburon.com`. It is a large, ambitious, and surprisingly mature codebase: ~55k LOC of TypeScript across a clean domain decomposition (bot lifecycle, a worker-thread-per-bot runtime, a Voyager curriculum/skill loop, a fleet-control platform, a town/civilization layer with SQLite, a schematic build engine, and a supply-chain system), plus a polished Next.js 16 / React 19 dashboard. There is real engineering discipline here — `tsconfig` strict mode, atomic file writes, a circuit breaker + retry/backoff on LLM calls, an LLM kill switch, constant-time secret comparison, a login rate limiter, a dig-choke-point mining geofence, prompt-injection hardening, and ~54 backend + ~13 frontend + 6 e2e test files. It is clearly a working, actively-operated system.

The problems are concentrated in three places. First, **security defaults are fail-open on a publicly-reachable, multi-tenant server**: the API binds `0.0.0.0`, dashboard/plugin auth are both opt-in (off = wide open), and CORS reflects any origin when auth is off. (Correction after verification: `config.yml` is git-tracked but its `auth.devSecret` is `null` — there is **no** leaked secret value; real API keys live in `.env`, which is correctly gitignored. The tracking of `config.yml` is a latent hygiene risk, not an active leak.) Second, **a handful of god-objects carry correctness risk** — `api.ts` (4429 lines), `BuildCoordinator` (2530), `TownManager` (2320), `VoyagerLoop` (2078) — and the build/town engines have confirmed destructive re-run and double-execution bugs. Third, **operational maturity is thin**: no CI, no Dockerfile, no migration framework, secrets persisted in plaintext, and a known native-memory leak mitigated only by a weekly systemd restart. The codegen path (Node `vm`, not a real sandbox, able to issue raw `/setblock`/`/fill` server commands) is an acceptable-but-watch risk given LLM/prompt-injection exposure.

**Rating: Needs work — bordering Risky for its current public-server deployment.** The code quality is good enough that this is fixable without a rewrite; the urgent gap is hardening the public attack surface and fixing the destructive build/town re-run bugs.

---

## B. Top 10 Highest-Priority Issues

### 1. Config/secret hygiene — `config.yml` tracked; backups can hold real keys ⚠️ CORRECTED
- **Severity:** Medium (downgraded after verification — originally reported Critical) · **Area:** security
- **Files:** `config.yml` (`auth.devSecret: null`), `.gitignore`, `data.backup-*/llm-settings.json`
- **Correction:** My initial pass redacted `auth.devSecret` and assumed a real value was committed. On verification the tracked value is `null` (confirmed in `HEAD:config.yml`). **No secret is leaked**, and real API keys live in `.env`, which is correctly gitignored and untracked. The Critical "rotate immediately" finding was wrong — there is nothing to rotate.
- **What's actually wrong (residual):** (a) `config.yml` is tracked, so a future operator who sets a real `devSecret` would commit it. (b) `data.backup-*/llm-settings.json` contains plaintext provider API keys and was **not** covered by `.gitignore` (only `data/` was), so `git add -A` could have staged it. (Backups were not actually tracked — verified.)
- **Fix (done in Batch 1):** Added `data.backup-*/`, `*.bak-*` to `.gitignore`. **Still recommended:** either move `devSecret` to env-only (it's already overridable via `DASHBOARD_AUTH_DEV_SECRET`) and keep `config.yml` as a tracked template, or stop tracking it; and `chmod 600` the live `data/llm-settings.json` (the code now writes it 0o600 going forward, but the existing file should be re-chmod'd once).

### 2. Fail-open auth + open CORS on a public, `0.0.0.0`-bound API
- **Severity:** Critical · **Area:** security
- **Files:** `config.yml` (`api.host: 0.0.0.0`), `src/server/auth.ts:136-138,182-185,205-214`, `src/server/api.ts:344-357` (CORS)
- **What's wrong:** `DASHBOARD_AUTH_SECRET` and `PLUGIN_AUTH_TOKEN` are both optional; when unset (the documented default), every mutating endpoint is unauthenticated. With auth off, CORS resolves to reflect-any-origin **with `credentials: true`** — an invalid combination that defeats CSRF protection. The API binds all interfaces.
- **Why it matters:** Unauthenticated callers can spawn/delete bots, set swarm directives, trigger builds, push tasks, and (via `/say`) run server commands. `POST /api/events/chat` (unauth-exempt) reaches `buildCoordinator.startBuild`.
- **Fix:** Fail closed in production: if `NODE_ENV==='production'` and no secret is set, refuse to start (or bind loopback only). Never pair `credentials:true` with a reflective origin — require an explicit allowlist in all modes. Make `PLUGIN_AUTH_TOKEN` mandatory in production.

### 3. Path traversal / arbitrary `.js` read in `GET /api/skills/:name`
- **Severity:** High · **Area:** security / bug
- **Files:** `src/server/api.ts:1464-1473` (handler), guard `isSafeSkillName` defined later at `:1479` and used only by PUT/DELETE (`:1498`, `:1558`)
- **What's wrong:** The GET handler does `path.join(cwd, 'skills', \`${skillName}.js\`)` with no validation. `req.params.name` is URL-decoded by Express, so `..%2f..%2f…` escapes the `skills/` directory; any `.js` file on disk (e.g. compiled `dist/config.js`) is readable.
- **Why it matters:** Confirmed file-disclosure primitive; combined with #2 it is unauthenticated.
- **Fix:** Call `isSafeSkillName(skillName)` (move its definition above the GET route) before building the path, exactly as PUT/DELETE already do.

### 4. Duplicate / double execution: child-town founding and supply-chain stages ⚠️ CORRECTED — FIXED
- **Severity:** originally reported Critical; **both sub-claims were overstated** after verification (see below) · **Area:** bug / data integrity
- **Files:** `src/town/ApprovalManager.ts`, `src/town/ExpansionManager.ts`, `src/supplychain/ChainCoordinator.ts`
- **Town founding (corrected):** the "duplicate town on restart" race is **not reachable** — `rehydrate()` filters `status='open'`, and `fireResolveHandler` deletes-before-fire with status written to `'approved'` first. The genuine residual gaps (no idempotency guard in `executeProposal`; descriptor never cleared on settle) were **fixed** in `36114f1` (idempotency guard + `clearDescriptor`).
- **Chain double-execution (corrected — was mischaracterized):** the chain→bot integration was **broken**, not double-executing — `ChainCoordinator` called `WorkerHandle.getVoyagerLoop()`, which doesn't exist (the loop runs in the worker thread), so a chain threw on stage 1 and the unguarded poll would crash the process. #20 was therefore unreachable. **Fixed** in `9e8d589`: rewired to the worker IPC (`queueTask` command + `voyagerTaskState` request), guarded the poll, and added the real double-exec guard — only re-queue a stage when it's neither the bot's current task nor in its queue (`!stillPending`).
- **Status:** ✅ both addressed (`36114f1`, `9e8d589`), each with tests. Note: `ApprovalManager.ensureRehydrated` still sets `rehydrated=true` before the un-awaited `rehydrate()` (a narrow first-post-boot-tick lost-handler window) — left as a smaller follow-up.

### 5. Destructive build re-runs (timeout doesn't cancel digging; default `air destroy` clear; hard-coded tunnel; verify-repair reverts player edits)
- **Severity:** High · **Area:** bug / data integrity
- **Files:** `src/util/withTimeout.ts:14-31` (used `BuildCoordinator.ts:837,859,881,925,951`), `BuildCoordinator.ts:2176-2215` (`/fill … air destroy`, enabled by default `:763`, forced by `BuildCampaign.ts:595`), `BuildCoordinator.ts:409-417` (hard-coded `railX=1225`, fixed hall coords), `BuildCoordinator.ts:1536-1560,1708+,1828` (`/setblock … replace` repair), resume `:281-303`
- **What's wrong:** `withTimeout` rejects but never cancels the underlying excavation — a "timed-out" site prep keeps digging in the background. `clearSite` issues `/fill … air destroy` over the whole footprint every run, bypassing the dig-choke geofence (it's an op command). The tunnel build uses absolute world coordinates that only fit one town. Verify-and-repair re-issues `/setblock replace`, silently reverting player edits. `resumeJob` unconditionally sets `status='running'`, losing persisted `paused` state on restart.
- **Why it matters:** Re-running or resuming a build can destroy terrain and player builds, and the geofence (a key safety control per project memory) is circumvented.
- **Fix:** Thread an `AbortSignal` into prep ops and check it between fill slabs/dig steps. Geofence-check before clearing; only clear non-build blocks. Derive tunnel endpoints from the halls, refuse otherwise. Gate repair behind an explicit flag and skip player-modified blocks. Persist paused/cancelled state and honor it in `resumeJob`.

### 6. `vm` is not a sandbox — LLM codegen can run raw server commands
- **Severity:** High · **Area:** security (defense-in-depth)
- **Files:** `src/voyager/CodeExecutor.ts:160-466` (sandbox), `:258-269` (`setBlock`/`fillBlocks` call `bot.chat('/setblock …')`, `bot.chat('/fill …')`)
- **What's wrong:** Generated skill code runs in Node's `vm`, which is explicitly **not** a security boundary, and the sandbox exposes primitives that issue arbitrary server commands. Task descriptions originate from the API and in-game chat, so prompt injection can steer the LLM into generating escape/command code.
- **Why it matters:** Indirect but real RCE/server-command path on a public server; compounded by #2 (unauthenticated task submission).
- **Fix:** Treat codegen as untrusted: run it in a worker/`isolated-vm` with frozen intrinsics, allowlist the command surface (drop raw `/fill`/`/setblock` or route through a validated builder that respects the geofence), and require auth on all task-submission endpoints.

### 7. Synchronous SQLite on the main event loop
- **Severity:** High · **Area:** performance / architecture
- **Files:** `src/town/db.ts:234` (opened on main thread), reads/writes throughout `TownBrain.ts:411,473,500,555,715,1090,1123,1238,1387`; O(towns²) diplomacy scan at `:1387`
- **What's wrong:** `better-sqlite3` is fully synchronous and shares the event loop with Express + Socket.IO + every brain tick. Per-minute town ticks stack many synchronous reads/writes (and an unbounded `listTowns()` distance scan per town), blocking request handling.
- **Why it matters:** API latency spikes and stalls scale with town/fleet count; this is a startup- and steady-state-throughput problem.
- **Fix:** Batch reads per tick, wrap multi-write loops in `db.transaction()`, cache the town list per global tick (or filter peers in SQL), and ideally move the DB to a worker thread.

### 8. Plaintext API keys persisted to disk (and into backups)
- **Severity:** High · **Area:** security
- **Files:** `src/ai/LLMSettings.ts:303` (`save()` writes full `settings`), `:222-296` (`seedFromEnv`), file `data/llm-settings.json` (mode 0644); `POST /api/llm/providers` (`src/server/llmRoutes.ts:24-41`) accepts keys over the API
- **What's wrong:** Provider API keys are written to `data/llm-settings.json` in plaintext (and copied into the `data.backup-*` directories visible in the working tree). `getSettings()` masks keys in responses, but the on-disk file does not.
- **Why it matters:** Disk/backup compromise leaks paid LLM credentials.
- **Fix:** Keep keys in env only (store a reference/flag, not the value). At minimum `chmod 600` and exclude from backups. Operator-gate `POST /api/llm/providers`.

### 9. `bot.entity` null-deref crashes during respawn windows
- **Severity:** High · **Area:** bug (crash → restart loop)
- **Files:** `src/voyager/VoyagerLoop.ts:369` (`computeSurvivalGoal`), `:1208,1311` (build goal/origin), `src/bot/BotInstance.ts:412` (`entityHurt` derefs `this.bot.entity.id` after only checking `this.bot`)
- **What's wrong:** Several hot paths read `bot.entity.position` / `bot.inventory` / `bot.health` without guarding `bot.entity`, which is null in the post-death / pre-respawn window where the loop can resume.
- **Why it matters:** An unhandled deref crashes the worker; `maybeRestart` can loop it.
- **Fix:** Single `if (!this.bot?.entity) return;` guard at the top of `runOneCycle`; guard `entityHurt`.

### 10. No CI / no containerization / fragile onboarding
- **Severity:** High · **Area:** DX / operations
- **Files:** absent `.github/`, `Dockerfile`, `docker-compose.yml`, `Makefile`; root has no lint/format config; `next.config.ts:6` `ignoreBuildErrors: true`
- **What's wrong:** Nothing enforces type-checks, lint, or tests before deploy. The frontend ships with TypeScript build errors suppressed (~58 `any`/type issues hidden). README's quick start omits the web dashboard build, auth setup, and the two systemd units.
- **Why it matters:** Regressions reach the live public server unguarded; new contributors can't reliably reproduce the stack.
- **Fix:** Add a CI workflow (`tsc --noEmit`, `eslint`, `vitest run` for both root and `web/`). Remove `ignoreBuildErrors`. Add a Dockerfile/compose for backend + web. Expand README setup (web build, systemd, auth env vars).

---

## C. Quick Wins (< 1 hour each)

1. **(Done in Batch 1)** Ignore `data.backup-*/` and `*.bak-*` so backups holding plaintext API keys can't be staged. Follow-up: one-time `chmod 600 data/llm-settings.json`; decide whether `config.yml` stays tracked-as-template (with `devSecret` env-only) or untracked. (Issue #1 — corrected)
2. **Add the `isSafeSkillName` guard to `GET /api/skills/:name`** (`api.ts:1464`) — one-line fix, closes a confirmed traversal. (Issue #3)
3. **Wrap the 1s Socket.IO polling `setInterval` body in try/catch** (`socketEvents.ts:22-74`) — an uncaught throw here crashes the process.
4. **Wrap the un-`asyncH` async route handlers** `DELETE /api/bots/:name` (`api.ts:703`) and `DELETE /api/bots` (`:719`) in `asyncH`/try-catch to stop unhandled rejections.
5. **Loud startup warning when `DASHBOARD_AUTH_SECRET` is unset** (or bind loopback) — cheap mitigation for fail-open auth.
6. **`chmod 600 data/llm-settings.json`** and add `data.backup-*/`, `config.yml.bak-*` to `.gitignore` (working tree currently has both). (Issue #8)
7. **Add the router-level `Promise.race` timeout** in `ModelRouter.dispatch` and raise the `llm.*` IPC timeout above the 120s thinking-client timeout (`IPCChannel.ts:69`, `GeminiClient.ts:94`).
8. **Remove `typescript.ignoreBuildErrors`** from `web/next.config.ts:6` and fix or `@ts-expect-error` the offenders; add `lint` + `tsc --noEmit` to the build.
9. **Add a `shutdown()` flush to `BuildCoordinator`** (`builds.json` 2s-debounced writes are not flushed on SIGTERM; only CampaignManager flushes). (`BuildCoordinator.ts:246-253`)
10. **Delete dead/stray repo clutter** after confirming with owner: `config.yml.bak-20260526`, `data.backup-20260526-024801/`, orphaned comment block at `api.ts:1733-1742`, and collapse the duplicate swarm route (`POST /api/blackboard/swarm-directive` at `:3005` onto the validated `POST /api/swarm` at `:1699`).

---

## D. Larger Refactors (grouped by priority)

**P0 — correctness & safety**
- **Make build/town actions idempotent and cancellable.** AbortSignal-aware site prep (`withTimeout`), persisted paused/cancelled build state, idempotent `executeProposal`/chain stages, geofence-aware clearing. (Issues #4, #5)
- **Harden the codegen sandbox.** Move to `isolated-vm`/worker with frozen intrinsics; allowlist the command surface and route block placement through the geofence. (Issue #6)

**P1 — decompose god-objects (enables everything else)**
- **`src/server/api.ts` (4429 lines, one `createAPIServer` closure, ~140 inline routes).** Split into per-domain route modules (bots, builds, towns, control, llm) mounted with shared middleware; apply `asyncH` uniformly (the doc comment admits it's applied selectively — that's the root cause of the unwrapped-handler and missing-guard bugs).
- **`BuildCoordinator` (2530) → `SchematicStore` / `SitePrep` / `BuildExecutor` / `BuildVerifier` / `BuildStore`.** Replace the `io.emit` monkey-patch in `BuildCampaign.ts:183-194` with a real event emitter/callback registry.
- **`TownManager` (2320) → per-domain repositories behind a facade; `TownBrain` (1616) → array of registered `TownLoop`s.** Replace the bidirectional TownManager↔TownBrain god-handle with narrow interfaces.
- **`VoyagerLoop` (2078):** extract the task-selection ladder and the execute/retry loop into separate, testable units.

**P2 — data layer**
- **Move SQLite off the event loop** (worker thread) and **introduce a real migration framework** (`user_version` pragma or drizzle-kit) — currently schema is ad-hoc `CREATE TABLE IF NOT EXISTS` + an append-only array of idempotent `ALTER`s with no version tracking (`db.ts:182-217,243-251`). Consolidate the second `town.db` connection in `ApprovalManager.ts:681-700` into TownManager's transactions. Add periodic `sqlite.backup()`.
- **Bound the blackboard.** Cap `tasks` on insert (not only via the 10-min GC), and stop full-state re-serialization on every mutation (`BlackboardManager.ts:187-188,537`) — this is the documented RSS-growth source mitigated today only by the weekly restart.

**P3 — frontend**
- Centralize data fetching: route the raw `fetch()` calls (`settings/page.tsx`, `DiagnosticPanel`, `SkillGraph`, `BotTabOverview`, `SettingsSection`) through `lib/api.ts` so they get the 10s timeout + 401→login handling. Resolve the API base at runtime (relative `/api` + Next rewrite) instead of build-time `NEXT_PUBLIC_API_URL` pinned to a LAN IP. Split the 1579/1396/879-line page components. Add logout/current-user UI and icon-button `aria-label`s.

---

## E. Suggested Roadmap

**Phase 1 — Stabilize (days, safety-critical)**
- Rotate & un-track the committed secret (#1); add `isSafeSkillName` guard (#3); fail-closed auth + fix CORS + make plugin auth mandatory in prod (#2); `chmod`/exclude plaintext-key file (#8).
- Fix destructive re-run bugs: AbortSignal cancellation, geofence-aware clearing, persisted paused state, idempotent approvals/chains (#4, #5).
- Add `bot.entity` null guards (#9); wrap the socket polling loop and unhandled async routes (Quick Wins 3-4).
- Stand up CI running `tsc --noEmit` + `eslint` + `vitest` for root and web (#10).

**Phase 2 — Clean up (1-2 weeks)**
- Remove `ignoreBuildErrors` and fix the hidden frontend type errors; delete dead/stray files & duplicate routes; centralize frontend fetching; consolidate the duplicated `/api/metrics` JSON-read logic.
- Bound the blackboard and stop per-mutation full-state writes; verify LLM model ids / pricing in `TokenLedger` (currently "placeholder") and unify the two divergent Anthropic-client build paths.
- Add Dockerfile/compose; expand README (web build, systemd, auth).

**Phase 3 — Improve architecture (1-2 months)**
- Decompose `api.ts`, `BuildCoordinator`, `TownManager`/`TownBrain`, `VoyagerLoop` (P1 above). Replace the `io.emit` monkey-patch and the string-dispatch IPC ladder (`WorkerHandle.ts:200-275`) with typed handler maps.
- Migration framework + move SQLite to a worker; consolidate the dual DB connection.

**Phase 4 — Harden for production (ongoing)**
- Sandbox the codegen path properly (`isolated-vm`); role separation (read-only viewer vs operator/admin) for destructive/config/LLM-key endpoints; gate the `?admin=true` approval bypass (`api.ts:4183-4198`) behind a real credential.
- Observability: structured request logging with auth subject, metrics/health that don't re-read JSON from disk per request, native-memory leak hunt to retire the weekly-restart crutch, validate uploaded schematics' NBT magic bytes (parser-DoS).

---

## F. Questions for the Repo Owner

1. **Threat model:** Is the API meant to be internet-reachable, or only behind a trusted LAN/VPN? The README markets a public, multi-tenant "bring your own bot" service, but auth is opt-in — which is the intended deployment? This determines how urgent #2/#6 are.
2. **Secret rotation:** Has `auth.devSecret` (committed in `config.yml`) ever been exposed publicly / is the GitHub repo public? Do we need git-history scrubbing?
3. **Is `config.yml` intended to be tracked?** If yes (for shareable defaults), can we split runtime secrets out into env so the template can stay in git?
4. **Build engine ownership:** The destructive re-run paths (#5) and the hard-coded tunnel coordinates suggest the build system is still partly bespoke to one town. Is a general multi-town build engine a goal, or is the tunnel a one-off?
5. **Native-memory leak:** The weekly systemd restart is a known crutch — is hunting the underlying leak in scope, or is restart-as-mitigation acceptable indefinitely?
6. **LLM cost accounting:** `TokenLedger` pricing is marked "placeholder" and Anthropic model ids are hardcoded/inconsistent. Do you rely on these numbers for real budgeting? (If so, they're currently wrong.)
7. **Legacy auth sunset (2026-08-15):** Are external scripts still using `?legacyAuth=true` + `mayorPlayerName`? The code already logs each use — what does production show, and is the sunset date firm?
8. **Stray artifacts:** Are `backfill-embeddings.ts`, `barley-audit.md`, `BUYWITHMONEY.md`, `dev/packetloss404/`, and the `scripts/demo-*` files still needed, or can they be archived/removed?

---

_Working notes captured in `REPO_REVIEW_NOTES.md`. No application code was modified during this review._
