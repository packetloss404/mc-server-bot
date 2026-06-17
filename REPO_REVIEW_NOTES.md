# REPO_REVIEW_NOTES (working notes — not application code)

## Overview
- DyoBot: Voyager-style mineflayer AI bot sidecar for DyoCraft MC server.
- Backend: TS, Node, Express API on :3001 (`dist/index.js`). ~55k LOC in src.
- Frontend: Next.js 16 / React 19 dashboard in `web/` on :3000 (separate package + lockfile).
- Two systemd units; weekly restart timer (native-mem leak mitigation per memory).
- DB: better-sqlite3 + drizzle-orm, used ONLY in `src/town/` (db.ts, schema.ts, TownManager, ApprovalManager). Rest is JSON files in data/.

## Structure facts
- Biggest files: api.ts 4429, BuildCoordinator 2530, TownManager 2320, BotInstance 2118, VoyagerLoop 2078, TownBrain 1616, CommanderService 1394.
- No CI (.github absent), no Dockerfile, no Makefile, no docker-compose.
- No lint config in root backend (web has eslint). No prettier.
- tsconfig: strict true (good). web tsconfig strict, noEmit.
- Tests: vitest, 54 backend test files in test/ + src; e2e playwright (6 specs) in e2e/. web has __tests__.
- Stray root files: backfill-embeddings.ts, barley-audit.md, BUYWITHMONEY.md, demo scripts in scripts/, tools/consolidate-explore-skills.js, dev/packetloss404/ (?).
- Uncommitted in working tree: config.yml.bak-20260526, data.backup-20260526-024801/ (backup dir tracked? no, data/ gitignored).

## Security findings (CONFIRMED)
- config.yml is GIT-TRACKED and contains `auth.devSecret: <value>` — committed secret. .env correctly gitignored & untracked. (S-CRIT)
- api.host "0.0.0.0" — API binds all interfaces. Dashboard auth OPTIONAL (DASHBOARD_AUTH_SECRET unset = wide open). Plugin token optional too.
- CodeExecutor uses Node `vm` (NOT a security sandbox). LLM-generated code runs with access to mineflayer bot. setBlock/fillBlocks call bot.chat('/setblock'),('/fill') => arbitrary server commands. Task descriptions come from API/chat => prompt-injection -> command exec path. (S-HIGH, indirect)
- minecraft auth "offline" mode (expected for cracked server but note impersonation risk — there IS an ImpersonationMonitor).

## Batch 2 verification (#5 destructive build re-runs — all 5 sub-claims read against source)
- (a) withTimeout no-cancel: CONFIRMED (withTimeout.ts:14-31 races a timer only; site-prep digs/fills at BuildCoordinator 837/859/881/925/951 keep running after timeout). NOT fixed — needs AbortSignal threading (larger refactor). Partially mitigated by (b).
- (b) clearSite /fill air destroy bypasses geofence, default-on: CONFIRMED (default :763, runClearSite :2203, op /fill bypasses bot.dig geofence per :338). FIXED in 7dbcf33 (intersectsProtectedZone guard skips protected slabs).
- (c) tunnel hard-coded coords railX=1225 etc: CONFIRMED (:409-417); reachable via POST api.ts:2387. NOT fixed — deliberate single call, lower frequency. Recommend a "derive from halls / refuse if absent" guard.
- (d) verify-repair /setblock replace reverts player edits: CONFIRMED (:1828, runs on completion :1547 + tunnel :505). NOT fixed — isProtected doesn't cover within-footprint player edits; needs a repair-policy flag (design decision).
- (e) resumeJob resumes paused jobs: CONFIRMED reachable (resumePendingJobs includes 'paused' :262 → resumeJob sets 'running' :295). NOT fixed — function comment documents "resume running/paused" as INTENDED, so flipping is a product decision, not a clear bug.

## Batch 2 fixes shipped (all on branch phase1-stabilize-security)
- 36114f1 #4  — idempotent child-town founding + clear approval descriptor on settle
- 7dbcf33 #5b — clearSite respects mining geofence (skip protected slabs)
- e4a9b4c #5e — paused builds stay paused across restart (re-park, not auto-resume)
- c25d2f7 #5d — holes-only verify-repair (preserve player edits; only re-place air)
- a9e1c2e #5c — buildTunnel requires explicit confirm (hard-coded coords)
- 169f4cc #5a — cancel timed-out site-prep via AbortSignal (stop digging on timeout)
- Tests: 433 passing (54 files). Each fix has a dedicated test.

## Deploy status
- 50add34 (Batch1) + 36114f1 (#4): DEPLOYED (restart 18:59, healthy, 4 bots).
- Full Batch 2 (7dbcf33/e4a9b4c/c25d2f7/a9e1c2e/169f4cc): restart 19:40 — verifying boot.

## Design decisions made (flag if you disagree)
- #5d holes-only: a genuinely WRONG-type placement is now preserved, not auto-corrected
  (player-edit revert judged the worse failure). Could add a per-build override.
- #5c: buildTunnel now refuses without confirm:true (API contract change — safe default).
- #5e: paused = stays paused across restart (matches operator intent; was: auto-resumed).

## To verify / deeper dive (delegated)
- api.ts: CORS, input validation, auth middleware coverage, legacyAuth path
- auth.ts: session/cookie handling, devSecret usage, sunset date logic
- town/build coupling & known fragility (resume, verification)
- web frontend UX/state
- voyager loop bugs/races
