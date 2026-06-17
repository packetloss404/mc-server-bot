import express, { NextFunction, Request, RequestHandler, Response } from 'express';
import cors from 'cors';
import http from 'http';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Server as SocketIOServer } from 'socket.io';
import { BotManager } from '../bot/BotManager';
import { Config, getSection } from '../config';
import {
  persistConfig,
  PATCHABLE_SECTIONS,
  PatchableSection,
  RESTART_REQUIRED_FIELDS,
  findRestartRequiredFields,
  validatePatch,
} from '../util/configPersist';
import { EventLog } from './EventLog';
import { CommanderService } from '../control/CommanderService';
import { CommandCenter } from '../control/CommandCenter';
import { MissionManager } from '../control/MissionManager';
import { MarkerStore } from '../control/MarkerStore';
import { townToDTO } from '../town/TownManager';
import { HighlightStream } from '../town/HighlightStream';
import type { TownEvent } from '../town/Town';
import { ScheduleManager } from '../town/ScheduleManager';
import { TOWN_ROLES, type TownRole } from '../town/RoleManager';
import { loadObservedRole, inferObservedRole, type BotActionStats } from '../town/ObservedRoleModel';
import { computeCivilizationMetrics } from '../town/CivilizationMetrics';
import { ChronicleGenerator } from '../town/ChronicleGenerator';
import { ChronicleScheduler } from '../town/ChronicleScheduler';
import type { TownRule } from '../town/RuleStore';
import { MAX_DECREE_TEXT_LENGTH } from '../town/DecreeManager';
import { SquadManager } from '../control/SquadManager';
import { RoleManager } from '../control/RoleManager';
import { TemplateManager } from '../control/TemplateManager';
import { RoutineManager } from '../control/RoutineManager';
import { BuildCoordinator } from '../build/BuildCoordinator';
import { CampaignManager } from '../build/BuildCampaign';
import { SchematicMatcher } from '../build/SchematicMatcher';
import { ChainCoordinator } from '../supplychain/ChainCoordinator';
import { parseBuildIntent } from '../control/BuildIntentResolver';
import { registerAdminRoutes } from './admin';
import { isSafeBotName, isSafeFilename, asyncH, sanitizeErrorMessage } from './routes/helpers';
import { registerTerrainRoutes } from './routes/terrainRoutes';
import { registerSchematicRoutes } from './routes/schematicRoutes';
import { registerChainRoutes } from './routes/chainRoutes';
import { registerControlRoutes } from './routes/controlRoutes';
import { registerCommanderRoutes } from './routes/commanderRoutes';
import { registerCampaignRoutes } from './routes/campaignRoutes';
import { logger } from '../util/logger';
import {
  requireDashboardAuth,
  isDashboardAuthenticated,
  isDashboardAuthEnabled,
  requirePluginAuth,
  registerAuthRoutes,
  setAuthConfig,
  getSessionPlayerName,
  isLegacyAuthRequested,
  requireDev,
} from './auth';
import { rateLimit } from './rateLimit';
import type { TokenLedger } from '../ai/TokenLedger';
import { atomicWriteJsonSync, atomicWriteTextSync } from '../util/atomicWrite';

// Input-validation + response helpers now live in ./routes/helpers (shared with
// the extracted route modules). Re-imported below.

/**
 * Minimal worker-handle shape consumed by `createGrantHandler`. Defined
 * structurally so the test suite can stub it without instantiating a real
 * `WorkerHandle` (which would require a live worker thread). Mirrors the
 * three methods the handler actually calls.
 */
export interface GrantWorkerHandle {
  isAlive(): boolean;
  chat(message: string): void;
  sendRequest(type: string, args?: unknown[]): Promise<any>;
  getCachedDetailedStatus?(): { inventory?: Array<{ name: string; count: number }> } | null;
}

export interface GrantHandlerDeps {
  /** Resolve a bot name to a worker handle, or null/undefined when not found. */
  getWorker(name: string): GrantWorkerHandle | null | undefined;
  /** Override for the poll interval (default 200ms). Tests use a tiny value. */
  pollIntervalMs?: number;
  /** Override for the total poll budget (default 3000ms). Tests use a tiny value. */
  pollTimeoutMs?: number;
}

/**
 * Builds the express handler for `POST /api/bots/:name/grant`.
 *
 * Behavior:
 *  - Validates `items` is a non-empty array of `{ name: string, count: int }`.
 *  - Normalizes item names by stripping any `namespace:` prefix so callers
 *    can pass either `cobblestone` or `minecraft:cobblestone`.
 *  - Issues `/give <botName> minecraft:<name> <count>` per item via the
 *    worker handle's `chat()` method.
 *  - Polls the inventory (200ms x 15 = ~3s) to see which items actually
 *    landed; returns granted/missing arrays so the caller knows what worked.
 *  - 200 on full success, 207 on partial, 502 on nothing-landed, 400 on
 *    validation error, 404 when the bot isn't alive.
 *  - Adds a `hint` field to the body when items fail to appear — the most
 *    likely cause is that the bot isn't opped on the server.
 *
 * Caveat: this endpoint wraps the in-game `/give` command, so the bot must
 * be opped server-side. The endpoint deliberately does NOT op anyone.
 */
export function createGrantHandler(deps: GrantHandlerDeps) {
  const pollIntervalMs = deps.pollIntervalMs ?? 200;
  const pollTimeoutMs = deps.pollTimeoutMs ?? 3000;

  return async (req: Request, res: Response): Promise<void> => {
    const { items } = (req.body ?? {}) as {
      items?: Array<{ name?: unknown; count?: unknown }>;
    };
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({
        error: 'items must be a non-empty array of { name, count }',
      });
      return;
    }

    // Normalize + validate every item up-front so we never half-issue /give.
    const normalized: Array<{ name: string; count: number }> = [];
    for (const it of items) {
      const rawName = typeof it.name === 'string' ? it.name.trim() : '';
      const count = Number(it.count);
      if (!rawName) {
        res.status(400).json({ error: 'each item requires a string name' });
        return;
      }
      if (!Number.isFinite(count) || count <= 0 || !Number.isInteger(count)) {
        res.status(400).json({
          error: `item '${rawName}' requires a positive integer count`,
        });
        return;
      }
      // Strip an optional `minecraft:` (or any namespace:) prefix so callers
      // can pass either shape. Critical: the in-game /give command REQUIRES
      // the `minecraft:` prefix, so we always re-add it on the way out.
      const colon = rawName.indexOf(':');
      const name = colon >= 0 ? rawName.slice(colon + 1) : rawName;
      if (!name) {
        res.status(400).json({
          error: `item name '${rawName}' is empty after normalization`,
        });
        return;
      }
      normalized.push({ name, count });
    }

    const botName = req.params.name as string;
    const handle = deps.getWorker(botName);
    if (!handle || !handle.isAlive()) {
      res.status(404).json({ error: 'Bot not found or not connected' });
      return;
    }
    if (typeof handle.chat !== 'function') {
      res.status(500).json({ error: 'Bot handle does not support chat' });
      return;
    }

    // Snapshot the inventory before issuing /give so we can attribute each
    // delta to this grant call (vs items the bot already had).
    const snapshotCounts = (
      inv: Array<{ name: string; count: number }> | undefined,
    ): Record<string, number> => {
      const map: Record<string, number> = {};
      if (!Array.isArray(inv)) return map;
      for (const stack of inv) {
        if (!stack || typeof stack.name !== 'string') continue;
        map[stack.name] = (map[stack.name] ?? 0) + (Number(stack.count) || 0);
      }
      return map;
    };

    // Force a fresh detailed-status pull so the baseline isn't off-by-a-tick
    // from the periodic push. Falls back to cached status on IPC failure.
    const fetchInventory = async (): Promise<Array<{ name: string; count: number }>> => {
      try {
        const fresh = await handle.sendRequest('getDetailedStatus', []);
        if (fresh && Array.isArray(fresh.inventory)) return fresh.inventory;
      } catch {
        // fall through to cached
      }
      const cached = handle.getCachedDetailedStatus?.();
      return Array.isArray(cached?.inventory) ? cached!.inventory! : [];
    };

    const baselineCounts = snapshotCounts(await fetchInventory());

    // Issue one `/give` per item. The bot's chat channel queues these
    // server-side; mineflayer typically delivers them within ~50ms each.
    for (const { name, count } of normalized) {
      handle.chat(`/give ${botName} minecraft:${name} ${count}`);
    }

    // Poll the inventory for up to ~pollTimeoutMs (in pollIntervalMs steps)
    // to see what landed. Stop early once every expected delta is reached.
    const deadline = Date.now() + pollTimeoutMs;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    const remaining = new Map<string, number>();
    for (const { name, count } of normalized) {
      remaining.set(name, (remaining.get(name) ?? 0) + count);
    }

    let granted: Record<string, number> = {};
    do {
      await sleep(pollIntervalMs);
      const currentCounts = snapshotCounts(await fetchInventory());
      granted = {};
      let allLanded = true;
      for (const [name, target] of remaining.entries()) {
        const delta = (currentCounts[name] ?? 0) - (baselineCounts[name] ?? 0);
        granted[name] = Math.max(0, Math.min(delta, target));
        if (granted[name] < target) allLanded = false;
      }
      if (allLanded) break;
    } while (Date.now() < deadline);

    // Aggregate by item name in the response — when the caller passes
    // multiple entries for the same item, the response collapses them so
    // counts aren't double-reported.
    const grantedArr: Array<{ name: string; count: number }> = [];
    const missingArr: Array<{ name: string; count: number }> = [];
    for (const [name, target] of remaining.entries()) {
      const got = granted[name] ?? 0;
      if (got > 0) grantedArr.push({ name, count: got });
      if (got < target) missingArr.push({ name, count: target - got });
    }

    const payload: {
      success: boolean;
      granted: Array<{ name: string; count: number }>;
      missing: Array<{ name: string; count: number }>;
      hint?: string;
    } = {
      success: missingArr.length === 0,
      granted: grantedArr,
      missing: missingArr,
    };
    if (missingArr.length > 0) {
      payload.hint =
        `Some items did not appear in ${botName}'s inventory within ` +
        `${pollTimeoutMs}ms. The most likely cause is that the bot is not ` +
        `opped on the server (/give requires OP). Verify with \`/op ${botName}\` ` +
        'in the server console.';
    }

    // 200 when everything landed, 207 when partial, 502 when nothing landed
    // at all (chat went out but no items materialized).
    let status = 200;
    if (grantedArr.length === 0) status = 502;
    else if (missingArr.length > 0) status = 207;
    res.status(status).json(payload);
  };
}

export interface APIServerResult {
  app: express.Application;
  httpServer: http.Server;
  io: SocketIOServer;
  eventLog: EventLog;
  commanderService: CommanderService;
  commandCenter: CommandCenter;
  missionManager: MissionManager;
  markerStore: MarkerStore;
  squadManager: SquadManager;
  roleManager: RoleManager;
  templateManager: TemplateManager;
  routineManager: RoutineManager;
  buildCoordinator: BuildCoordinator;
  campaignManager: CampaignManager;
  schematicMatcher: SchematicMatcher;
  chainCoordinator: ChainCoordinator;
  chronicleGenerator: ChronicleGenerator;
  chronicleScheduler: ChronicleScheduler;
  highlightStream: HighlightStream;
}

export function createAPIServer(
  botManager: BotManager,
  config?: Config,
  tokenLedger?: TokenLedger,
  highlightStream?: HighlightStream,
): APIServerResult {
  const app = express();
  const httpServer = http.createServer(app);

  // CORS — when auth is enabled, restrict to an explicit allowlist via the
  // DASHBOARD_ALLOWED_ORIGINS env var (comma-separated) to prevent CSRF
  // (credentialed requests from arbitrary origins). When auth is disabled
  // (local dev), keep the reflective behavior so any dev port works.
  const allowedOriginsEnv = process.env.DASHBOARD_ALLOWED_ORIGINS;
  const allowedOrigins = allowedOriginsEnv
    ? allowedOriginsEnv.split(',').map((s) => s.trim()).filter(Boolean)
    : null;
  const corsOrigin: cors.CorsOptions['origin'] = process.env.DASHBOARD_AUTH_SECRET
    ? (allowedOrigins
        ? (origin, cb) => {
            // Same-origin (no Origin header) and explicit allowlist are accepted.
            if (!origin) return cb(null, true);
            if (allowedOrigins.includes(origin)) return cb(null, true);
            cb(new Error(`CORS: origin '${origin}' not in DASHBOARD_ALLOWED_ORIGINS`));
          }
        : false) // auth on, no allowlist set -> same-origin only
    : true;     // auth off -> reflective (dev mode)
  app.use(cors({
    origin: corsOrigin,
    credentials: true,
  }));

  // Cap JSON bodies at 1mb (Express's default is 100kb). 1mb leaves
  // headroom for the largest legitimate payload (schematic manifests,
  // commander plans) without letting a misbehaving client buffer
  // unbounded bytes into memory.
  app.use(express.json({ limit: '1mb' }));

  // Trust the proxy (X-Forwarded-For) so req.ip reflects the real client.
  // Required for the per-IP rate limiter to be meaningful behind a proxy.
  app.set('trust proxy', true);

  // Global rate limit (30 req/sec per IP) — applies to all routes.
  // `/api/events/*` gets a looser, dedicated limit registered below.
  app.use(rateLimit({ capacity: 30, refillPerSec: 30 }));

  const dashboardDir = path.join(process.cwd(), 'dashboard');
  app.use('/dashboard', express.static(dashboardDir));
  app.get('/', (_req: Request, res: Response) => {
    res.redirect('/dashboard/');
  });

  // Auth: register public endpoints BEFORE the gating middleware so they
  // remain reachable. `requireDashboardAuth` exempts `/api/auth/*`,
  // `/api/events/*`, `/api/health`, and `/api/status` internally.
  // Followup #58 — wire the runtime config so the `pid` session can validate
  // the dev secret. setAuthConfig is a no-op when config is undefined.
  if (config) setAuthConfig(config);
  registerAuthRoutes(app);

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Plugin event endpoints get a tighter rate limit (60 req/sec) and require
  // the X-Plugin-Token header when `PLUGIN_AUTH_TOKEN` is set.
  app.use(
    '/api/events',
    rateLimit({ capacity: 60, refillPerSec: 60 }),
    requirePluginAuth,
  );

  // Gate every other `/api/*` route behind dashboard auth. When
  // `DASHBOARD_AUTH_SECRET` is unset this middleware passes through.
  app.use('/api', requireDashboardAuth);

  // Event log (in-memory circular buffer)
  const eventLog = new EventLog(500);

  // ── Schematic matcher (keyword index over /schematics/*.schem) ──
  const schematicsDir = path.join(process.cwd(), 'schematics');
  const schematicMatcher = new SchematicMatcher(schematicsDir);
  schematicMatcher.refresh();

  // ── Commander service (persisted to data/commander-history.json) ──
  const commanderService = new CommanderService({
    llmClient: null, // LLM wired later if available
    botManager,
    schematicMatcher,
  });

  // Socket.IO — also gated by DASHBOARD_AUTH_SECRET when set. Without this,
  // the REST API is locked down but websockets are wide open (bot positions,
  // chat, inventory, build progress streamed to any anonymous connection).
  const io = new SocketIOServer(httpServer, {
    cors: {
      // Reuse the same origin policy as the REST API: allowlist when
      // DASHBOARD_AUTH_SECRET is set, reflective only in unauth'd local dev.
      // Previously `origin: true` reflected any origin even with auth on,
      // which let attacker-controlled sites subscribe to bot positions,
      // chat, inventory in real time.
      origin: corsOrigin,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Socket.IO auth middleware: re-uses the same cookie/Bearer check as REST.
  // Skipped entirely when no DASHBOARD_AUTH_SECRET is configured (single-user
  // local-dev case preserved).
  io.use((socket, next) => {
    if (!isDashboardAuthEnabled()) return next();
    // The handshake carries the original HTTP request — cookies + headers.
    const req = socket.request as unknown as Request;
    if (isDashboardAuthenticated(req)) return next();
    next(new Error('unauthorized'));
  });

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'Dashboard client connected');
    socket.on('disconnect', () => {
      logger.info({ socketId: socket.id }, 'Dashboard client disconnected');
    });
  });

  // ── Build & Supply Chain coordinators ──
  const buildCoordinator = new BuildCoordinator(botManager, io, eventLog, config);
  const campaignManager = new CampaignManager(botManager, buildCoordinator, io, eventLog);
  const chainCoordinator = new ChainCoordinator(botManager, io, eventLog);

  // ── Town side-channel: forward build completion into TownManager ──
  // Phase 1 stub. No town↔build linkage exists yet, so this only records an
  // event when a future caller annotates a BuildJob with `.townId`.
  // CampaignManager already wraps io.emit; stacking another wrap is safe.
  {
    const townManager = botManager.getTownManager();
    const origEmit = io.emit.bind(io);
    (io as any).emit = function (event: string, ...args: any[]): boolean {
      if (event === 'build:completed' && args[0]) {
        try { townManager.onBuildCompleted(args[0]); } catch (err: any) {
          logger.warn({ err: err?.message }, 'TownManager build:completed hook failed');
        }
      }
      return origEmit(event as any, ...args as any[]);
    };
  }

  // ── Phase 8 — town:event broadcast hook ──
  // Wire the in-memory HighlightStream (provided by index.ts, or lazily
  // instantiated for legacy/test callers) into TownManager so every
  // recordEvent() fans out over Socket.IO (`town:event`) AND lands in the
  // streamer's ring buffer. Keeps TownManager free of socket.io / ring
  // coupling — the callback is the seam.
  const highlights = highlightStream ?? new HighlightStream();
  highlights.setTownNameResolver((townId) => {
    try {
      return botManager.getTownManager().getTown(townId)?.name ?? null;
    } catch {
      return null;
    }
  });
  highlights.setWsConnectedProvider(() => {
    try {
      // io.engine.clientsCount is the canonical "currently-connected" count.
      // Guarded because some test contexts mock io without an engine.
      return (io as any).engine?.clientsCount ?? 0;
    } catch {
      return 0;
    }
  });
  botManager.getTownManager().setEventEmitter((event: TownEvent) => {
    try {
      io.emit('town:event', {
        townId: event.townId,
        kind: event.kind,
        severity: event.severity,
        ts: event.occurredAt,
        highlightScore: event.highlightScore,
        payload: event.payload,
      });
    } catch (err: any) {
      logger.warn({ err: err?.message, kind: event.kind }, 'town:event io.emit failed');
    }
    try {
      highlights.record(event);
    } catch (err: any) {
      logger.warn({ err: err?.message, kind: event.kind }, 'highlightStream.record failed');
    }
  });

  // ── Phase 2 Town Brain wiring ──
  // Inject the deps a TownBrain needs and boot a brain per active town. The
  // brain ticks the 4 sub-loops (demand / build / role / threat) every 60s.
  // Safe to call here: createTown auto-starts a brain for any town founded
  // later, so this only catches towns persisted from a previous run.
  try {
    botManager.getTownManager().wireBrains({
      botManager,
      buildCoordinator,
      blackboard: botManager.getBlackboardManager(),
      schematicMatcher,
    });
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'TownManager.wireBrains failed');
  }

  // ── Phase 4-B Chronicle Generator + Scheduler ──
  // Daily LLM-narrated chronicle entries (~once per 20-real-minute Minecraft
  // day). The scheduler is idempotent — ticking faster than the day cadence
  // is safe because the generator short-circuits on existing daily rows.
  const chronicleGenerator = new ChronicleGenerator(
    botManager.getTownManager(),
    botManager.getLLMClient(),
  );
  const chronicleScheduler = new ChronicleScheduler(
    botManager.getTownManager(),
    chronicleGenerator,
  );
  // Followup #48 — wire the chronicle emitter so BOTH the manual
  // `/chronicle/generate` route AND the scheduler's auto-generated entries
  // (and milestone entries) broadcast over `town:chronicle`. The emitter
  // is best-effort: a thrown io.emit must never crash the scheduler tick
  // (the generator wraps the callback already, but be defensive here too).
  try {
    chronicleGenerator.setEventEmitter(({ townId, dayNumber, entry, kind }) => {
      try {
        io.emit('town:chronicle', { townId, dayNumber, entry, kind });
      } catch (err: any) {
        logger.warn(
          { err: err?.message, townId, kind },
          'town:chronicle io.emit failed',
        );
      }
    });
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'chronicleGenerator.setEventEmitter failed');
  }
  try {
    chronicleScheduler.start();
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'ChronicleScheduler.start failed');
  }

  // ── Phase 5-A Phoenix wiring (chronicle leg) ──
  // The Phoenix loop calls ChronicleGenerator.generateMilestone when a
  // disaster is recorded. Inject it now; the MarkerStore leg is wired
  // further down (once `markerStore` exists).
  try {
    botManager.getTownManager().wirePhoenixDeps({ chronicleGenerator });
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'wirePhoenixDeps(chronicle) failed');
  }

  // Wire build dependencies into CommanderService now that they exist.
  commanderService.setBuildCoordinator(buildCoordinator);
  commanderService.setCampaignManager(campaignManager);

  // ── Control platform: wire managers in dependency order ──
  const markerStore = new MarkerStore(io);
  // Phase 5-A — wire the marker store into Phoenix so Memorial Park can
  // place monuments. The chronicle leg was injected up above; this
  // completes the Phoenix dependency surface.
  try {
    botManager.getTownManager().wirePhoenixDeps({ markerStore });
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'wirePhoenixDeps(markers) failed');
  }
  // Phase 5-A — also let DisasterRecorder emit `town:disaster` socket events
  // by handing it the io ref. We poke each brain's recorder directly since
  // wirePhoenixDeps doesn't carry io (yet).
  try {
    for (const town of botManager.getTownManager().listTowns()) {
      const brain = botManager.getTownManager().getTownBrain(town.id);
      brain?.getPhoenixManager?.()?.getDisasterRecorder()?.setIo(io);
    }
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'Phoenix io wiring failed');
  }
  const squadManager = new SquadManager(io);
  const roleManager = new RoleManager(io);
  const templateManager = new TemplateManager();
  const routineManager = new RoutineManager(botManager);
  const commandCenter = new CommandCenter(botManager, io, markerStore);
  commandCenter.setRoleManager(roleManager);
  const missionManager = new MissionManager(botManager, io);
  missionManager.setCommandCenter(commandCenter);
  missionManager.setSquadManager(squadManager);
  roleManager.setMissionManager(missionManager);
  commanderService.setCommandCenter(commandCenter);
  commanderService.setMissionManager(missionManager);
  missionManager.setBuildCoordinator(buildCoordinator);
  missionManager.setSchematicMatcher(schematicMatcher);
  logger.info('Control platform wired: CommandCenter ↔ MissionManager ↔ Squad/Role/Marker/Template');

  // ── Operational admin endpoints (logs, backup, restart, heap snapshot) ──
  // The restart hook flushes the persistent stores we have in scope here.
  registerAdminRoutes(app, {
    onRestart: async () => {
      try { eventLog.shutdown(); } catch (err: any) { logger.warn({ err: err?.message }, 'eventLog.shutdown failed during admin restart'); }
      try { chainCoordinator.shutdown(); } catch (err: any) { logger.warn({ err: err?.message }, 'chainCoordinator.shutdown failed during admin restart'); }
      try { campaignManager.shutdown(); } catch (err: any) { logger.warn({ err: err?.message }, 'campaignManager.shutdown failed during admin restart'); }
      try {
        if (typeof (botManager as any).shutdownPersistence === 'function') {
          (botManager as any).shutdownPersistence();
        } else {
          const mgrs: any[] = [botManager.getAffinityManager(), botManager.getBlackboardManager()];
          for (const mgr of mgrs) {
            if (mgr && typeof mgr.shutdown === 'function') {
              try { mgr.shutdown(); } catch { /* ignore */ }
            }
          }
        }
      } catch (err: any) {
        logger.warn({ err: err?.message }, 'botManager persistence flush failed during admin restart');
      }
    },
  });

  // ═══════════════════════════════════════
  //  ENDPOINTS — all use cached worker state
  // ═══════════════════════════════════════

  // Health check
  app.get('/api/status', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      botCount: botManager.getAllWorkers().length,
    });
  });

  // List all bots (basic status)
  app.get('/api/bots', (_req: Request, res: Response) => {
    const bots = botManager.getAllBotStatuses();
    res.json({ bots });
  });

  // Get single bot (basic)
  app.get('/api/bots/:name', (req: Request, res: Response) => {
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    res.json({ bot: handle.getCachedStatus() });
  });

  // Create bot
  app.post('/api/bots', asyncH(async (req: Request, res: Response) => {
    const { name, personality, location, mode } = req.body;

    if (!name || !personality) {
      res.status(400).json({ error: 'name and personality are required' });
      return;
    }
    if (!isSafeBotName(name)) {
      res.status(400).json({
        error: 'invalid bot name',
        hint: 'must match /^[A-Za-z0-9_]{3,16}$/ (Minecraft username rules)',
      });
      return;
    }

    const handle = await botManager.spawnBot(name, personality, location, mode);
    if (!handle) {
      res.status(409).json({ error: 'Bot already exists or max limit reached' });
      return;
    }

    const event = eventLog.push({ type: 'bot:spawn', botName: name, description: `${name} spawned` });
    io.emit('bot:spawn', { bot: name });
    io.emit('activity', event);

    res.status(201).json({ success: true, bot: handle.getCachedStatus() });
  }));

  // Remove single bot
  app.delete('/api/bots/:name', asyncH(async (req: Request, res: Response) => {
    const removed = await botManager.removeBot(req.params.name as string);
    if (!removed) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }

    const deletedName = req.params.name as string;
    const event = eventLog.push({ type: 'bot:disconnect', botName: deletedName, description: `${deletedName} removed` });
    io.emit('bot:disconnect', { bot: deletedName });
    io.emit('activity', event);

    res.json({ success: true });
  }));

  // Remove all bots
  app.delete('/api/bots', asyncH(async (_req: Request, res: Response) => {
    const count = await botManager.removeAllBots();
    res.json({ success: true, count });
  }));

  // Toggle mode
  app.post('/api/bots/:name/mode', (req: Request, res: Response) => {
    const { mode } = req.body;
    if (!mode || !['primitive', 'codegen'].includes(mode)) {
      res.status(400).json({ error: 'mode must be "primitive" or "codegen"' });
      return;
    }

    const success = botManager.setMode(req.params.name as string, mode);
    if (!success) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }

    res.json({ success: true, mode });
  });

  // ── Security: impersonation detection ──

  // List recent impersonation incidents (newest first).
  app.get('/api/security/impersonation', (_req: Request, res: Response) => {
    res.json({ incidents: botManager.getImpersonationMonitor().list() });
  });

  // Release an impersonation quarantine so the bot reconnects. Operator action,
  // to be used once the impostor is gone (kicked/banned or online-mode enabled).
  app.post('/api/bots/:name/quarantine/release', (req: Request, res: Response) => {
    const name = req.params.name as string;
    const handle = botManager.getWorker(name);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    handle.releaseQuarantine();
    const event = eventLog.push({
      type: 'security:quarantine-released',
      botName: name,
      description: `${name} quarantine released — reconnecting`,
    });
    io.emit('activity', event);
    res.json({ success: true });
  });

  // Event relay endpoints (for Java plugin)
  app.post('/api/events/chat', async (req: Request, res: Response) => {
    const { playerName, message, nearestBot, playerPosition } = req.body ?? {};

    // ── Optional-field type guards ──
    // `nearestBot` must be a non-empty string of reasonable length when
    // present. The plugin always passes one, but tighten the contract so a
    // malformed JSON body can't trip botManager.getWorker() with a number.
    if (nearestBot !== undefined && nearestBot !== null) {
      if (typeof nearestBot !== 'string' || nearestBot.length === 0 || nearestBot.length > 64) {
        res.status(400).json({ error: 'nearestBot must be a non-empty string ≤64 chars' });
        return;
      }
    }
    // `playerPosition` must be `{x, y, z}` of finite numbers when present.
    // Without this guard, a malformed object would propagate to the
    // PlayerPositionCache and pollute downstream queries.
    if (playerPosition !== undefined && playerPosition !== null) {
      if (
        typeof playerPosition !== 'object' ||
        Array.isArray(playerPosition) ||
        !Number.isFinite((playerPosition as any).x) ||
        !Number.isFinite((playerPosition as any).y) ||
        !Number.isFinite((playerPosition as any).z)
      ) {
        res.status(400).json({ error: 'playerPosition must be { x, y, z } of finite numbers' });
        return;
      }
    }

    const handle = nearestBot ? botManager.getWorker(nearestBot) : null;

    // Feed chat into the player intent model regardless of nearest-bot routing —
    // intent inference is global, not per-bot.
    if (typeof playerName === 'string' && typeof message === 'string') {
      botManager.getPlayerIntentModel().recordAction(playerName, {
        type: 'chat',
        detail: message,
        timestamp: Date.now(),
      });

      // Optional position payload from the Java plugin — keeps the cache warm
      // so other code can resolve "where is player X" without a live bot LOS.
      if (playerPosition && typeof playerPosition === 'object') {
        botManager.getPlayerPositionCache().recordPosition(playerName, playerPosition);
      }

      // If the chat looks like a help-seeking ask directed at a specific bot,
      // record an affinity event so the relationship summary reflects it.
      if (handle && /\b(help|can you|please|could you|need)\b/i.test(message)) {
        botManager.getAffinityManager().onHelpRequest(handle.botName, playerName, message.slice(0, 120));
      }

      // Build-intent dispatch: if the chat parses as a build request, resolve
      // it to a real schematic + origin and start the build. Best-effort: any
      // failure here is logged but does not affect the chat response.
      const intent = parseBuildIntent(message);
      if (intent) {
        try {
          await tryStartBuildFromIntent(intent, playerName, nearestBot);
        } catch (err: any) {
          logger.warn({ err: err.message, playerName, message }, 'Build-intent dispatch failed');
        }
      }
    }

    if (!handle) {
      res.json({ handled: false });
      return;
    }

    logger.info({ player: playerName, bot: nearestBot, message }, 'Chat event received');
    res.json({ handled: true });
  });

  /**
   * Find a marker by case-insensitive name match. Used to resolve "build a
   * tower at the gate" type intents where the player names a marker.
   */
  function findMarkerByName(name: string): { x: number; y: number; z: number } | null {
    const wanted = name.toLowerCase().trim();
    if (!wanted) return null;
    const markers = markerStore.getMarkers();
    // Exact match first, then substring.
    const exact = markers.find((m) => m.name?.toLowerCase() === wanted);
    const fuzzy = exact ?? markers.find((m) => m.name?.toLowerCase().includes(wanted));
    if (!fuzzy?.position) return null;
    return { x: Math.floor(fuzzy.position.x), y: Math.floor(fuzzy.position.y), z: Math.floor(fuzzy.position.z) };
  }

  /**
   * Convert a parsed BuildIntent into a concrete buildCoordinator.startBuild
   * call. Picks a schematic via SchematicMatcher, resolves the origin from
   * the intent's anchor, and chooses the closest connected bot as the crew.
   *
   * The chosen bot announces dispatch + milestones + completion in chat so
   * the player who asked for the build gets visible feedback.
   */
  async function tryStartBuildFromIntent(
    intent: ReturnType<typeof parseBuildIntent>,
    playerName: string,
    nearestBot: string | undefined,
  ): Promise<void> {
    if (!intent) return;

    // 1. Pick a crew. Prefer nearestBot; fall back to any connected worker.
    //    Done first so we can chat back any error messages below.
    const allWorkers = botManager.getAllWorkers();
    const connected = allWorkers.filter((w) => w.isAlive());
    if (connected.length === 0) {
      logger.info('BuildIntent: no connected bots to build with');
      return;
    }
    const chosenBot = (nearestBot && connected.find((w) => w.botName === nearestBot))
      || connected[0];
    const sayBack = (msg: string) => {
      try { chosenBot.chat(`${playerName}: ${msg}`); } catch { /* best effort */ }
    };

    // 2. Schematic. If the query is too vague, tell the player rather than
    //    silently picking a random structure.
    const match = schematicMatcher.match(intent.query);
    if (!match) {
      logger.info({ query: intent.query, playerName }, 'BuildIntent: no schematic matched query');
      sayBack(`I don't have a schematic that matches "${intent.query}". Try a different name?`);
      return;
    }

    // 3. Resolve origin from anchor.
    let originMode: 'coords' | `player:${string}` = 'coords';
    let origin = { x: 0, y: 64, z: 0 };
    if (intent.anchor === 'absolute' && intent.absolute) {
      origin = intent.absolute;
    } else if (intent.anchor === 'marker' && intent.markerName) {
      const markerPos = findMarkerByName(intent.markerName);
      if (markerPos) {
        origin = {
          x: markerPos.x + intent.offset.x,
          y: markerPos.y,
          z: markerPos.z + intent.offset.z,
        };
      } else {
        logger.info({ markerName: intent.markerName }, 'BuildIntent: marker not found, falling back to player position');
        sayBack(`I don't know where "${intent.markerName}" is — building near you instead.`);
        originMode = `player:${playerName}`;
      }
    } else if (intent.anchor === 'player_position') {
      const cached = botManager.getPlayerPositionCache().getPosition(playerName);
      if (cached && !botManager.getPlayerPositionCache().isStale(playerName)) {
        origin = {
          x: Math.floor(cached.position.x + intent.offset.x),
          y: Math.floor(cached.position.y),
          z: Math.floor(cached.position.z + intent.offset.z),
        };
      } else {
        // No fresh position — let BuildCoordinator resolve via probe IPC.
        originMode = `player:${playerName}`;
      }
    }

    logger.info({
      playerName,
      query: intent.query,
      schematic: match.filename,
      origin,
      originMode,
      mode: intent.mode,
      bot: chosenBot.botName,
    }, 'BuildIntent: starting build');

    const modeLabel = intent.mode === 'underground' ? ' (underground)' : '';
    sayBack(`Building ${match.filename}${modeLabel} — give me a few minutes.`);

    await buildCoordinator.startBuild(
      match.filename,
      origin,
      [chosenBot.botName],
      {
        originMode,
        mode: intent.mode,
        onProgress: ({ pct }) => sayBack(`${pct}% done with ${match.filename}.`),
        onCompleted: (job) => {
          if (job.status === 'completed') {
            sayBack(`Done! ${match.filename} built at ${job.origin.x}, ${job.origin.y}, ${job.origin.z}.`);
          } else {
            sayBack(`${match.filename} build ${job.status}. ${job.placedBlocks}/${job.totalBlocks} blocks placed.`);
          }
        },
      },
    );
  }

  app.post('/api/events/player-join', (req: Request, res: Response) => {
    const { playerName } = req.body;
    if (typeof playerName === 'string') {
      botManager.getPlayerPresenceTracker().recordJoin(playerName);
    }
    res.json({ handled: true });
  });

  app.post('/api/events/player-leave', (req: Request, res: Response) => {
    const { playerName } = req.body;
    if (typeof playerName === 'string') {
      botManager.getPlayerPresenceTracker().recordLeave(playerName);
      botManager.getPlayerIntentModel().clearPlayer(playerName);
      botManager.getPlayerPositionCache().clear(playerName);
    }
    res.json({ handled: true });
  });

  app.post('/api/events/player-death', (req: Request, res: Response) => {
    const { playerName, position } = req.body;
    if (typeof playerName === 'string') {
      botManager.getPlayerPresenceTracker().recordDeath(playerName);
      botManager.getPlayerIntentModel().recordAction(playerName, {
        type: 'death',
        detail: '',
        position: position ?? undefined,
        timestamp: Date.now(),
      });
    }
    res.json({ handled: true });
  });

  app.post('/api/events/block-placed', (req: Request, res: Response) => {
    const { playerName, blockName, position } = req.body;
    if (typeof playerName === 'string') {
      botManager.getPlayerIntentModel().recordAction(playerName, {
        type: 'block_placed',
        detail: typeof blockName === 'string' ? blockName : '',
        position: position ?? undefined,
        timestamp: Date.now(),
      });
    }
    res.json({ handled: true });
  });

  app.post('/api/events/block-broken', (req: Request, res: Response) => {
    const { playerName, blockName, position } = req.body;
    if (typeof playerName === 'string') {
      botManager.getPlayerIntentModel().recordAction(playerName, {
        type: 'block_broken',
        detail: typeof blockName === 'string' ? blockName : '',
        position: position ?? undefined,
        timestamp: Date.now(),
      });
    }
    res.json({ handled: true });
  });

  app.post('/api/events/item-crafted', (req: Request, res: Response) => {
    const { playerName, itemName } = req.body;
    if (typeof playerName === 'string') {
      botManager.getPlayerIntentModel().recordAction(playerName, {
        type: 'item_crafted',
        detail: typeof itemName === 'string' ? itemName : '',
        timestamp: Date.now(),
      });
    }
    res.json({ handled: true });
  });

  app.post('/api/events/entity-killed', (req: Request, res: Response) => {
    const { playerName, entityName, position } = req.body;
    if (typeof playerName === 'string') {
      botManager.getPlayerIntentModel().recordAction(playerName, {
        type: 'entity_killed',
        detail: typeof entityName === 'string' ? entityName : '',
        position: position ?? undefined,
        timestamp: Date.now(),
      });
    }
    res.json({ handled: true });
  });

  app.post('/api/events/player-move', (req: Request, res: Response) => {
    const { playerName, position } = req.body;
    if (typeof playerName === 'string') {
      botManager.getPlayerIntentModel().recordAction(playerName, {
        type: 'movement',
        detail: '',
        position: position ?? undefined,
        timestamp: Date.now(),
      });
      // Keep the position cache warm whenever the plugin sends movement events.
      if (position && typeof position === 'object') {
        botManager.getPlayerPositionCache().recordPosition(playerName, position);
      }
      if (
        position &&
        typeof position === 'object' &&
        typeof position.x === 'number' &&
        typeof position.y === 'number' &&
        typeof position.z === 'number'
      ) {
        io.emit('player:position', {
          player: playerName,
          x: position.x,
          y: position.y,
          z: position.z,
        });
      }
    }
    res.json({ handled: true });
  });

  // ═══════════════════════════════════════
  //  DASHBOARD ENDPOINTS
  // ═══════════════════════════════════════

  // Detailed bot status (enriched) — uses cached state from worker
  app.get('/api/bots/:name/detailed', (req: Request, res: Response) => {
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    const detailed = handle.getCachedDetailedStatus();
    if (!detailed) {
      res.json({ bot: handle.getCachedStatus() });
      return;
    }
    res.json({ bot: detailed });
  });

  // Bot prismarine-viewer port — lazy-mounts the viewer on first call.
  // Returns { port: number | null }; null means the viewer couldn't start
  // (bot not connected yet, or prismarine-viewer threw on init).
  app.get('/api/bots/:name/viewer-port', async (req: Request, res: Response) => {
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    try {
      const port = await handle.getViewerPort();
      res.json({ port });
    } catch (err: any) {
      res.json({ port: null, error: err?.message ?? 'Failed to fetch viewer port' });
    }
  });

  // Bot inventory — from cached detailed status
  app.get('/api/bots/:name/inventory', (req: Request, res: Response) => {
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    const detailed = handle.getCachedDetailedStatus();
    res.json({ inventory: detailed?.inventory || [] });
  });

  // Bot relationships (affinities) — read directly from main thread manager
  app.get('/api/bots/:name/relationships', (req: Request, res: Response) => {
    const name = req.params.name as string;
    const handle = botManager.getWorker(name);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    const affinities = botManager.getAffinityManager().getAllForBot(name);
    res.json({ relationships: affinities });
  });

  // Bot conversations — read directly from main thread manager
  app.get('/api/bots/:name/conversations', (req: Request, res: Response) => {
    const name = req.params.name as string;
    const handle = botManager.getWorker(name);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    const conversations = botManager.getConversationManager().getAllConversations(name);
    res.json({ conversations });
  });

  // Bot tasks — from cached detailed status
  app.get('/api/bots/:name/tasks', (req: Request, res: Response) => {
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    const detailed = handle.getCachedDetailedStatus();
    if (!detailed?.voyager) {
      res.json({ currentTask: null, completedTasks: [], failedTasks: [] });
      return;
    }
    res.json({
      currentTask: detailed.voyager.currentTask,
      queuedTasks: detailed.voyager.queuedTasks,
      longTermGoal: detailed.voyager.longTermGoal,
      completedTasks: detailed.voyager.completedTasks,
      failedTasks: detailed.voyager.failedTasks,
      // Per-task retry telemetry: { [taskDescription]: [{attempt, error, timestamp}] }
      retries: detailed.voyager.retryHistory ?? {},
    });
  });

  // Observed-role inference (Project Sid P1-A) — classify what the bot
  // *actually does* from its persisted action tallies (data/stats.json) and
  // compare to the role its town assigned it. Read-only; computes on demand.
  // Returns { observedRole, scores, assignedRole } where assignedRole is the
  // town RoleManager's current_role if the bot is a resident, else null.
  app.get('/api/bots/:name/observed-role', (req: Request, res: Response) => {
    const name = req.params.name as string;
    const handle = botManager.getWorker(name);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    const { observedRole, scores } = loadObservedRole(name);
    // assignedRole: scan towns for a resident row matching this bot. Most
    // bots belong to at most one town; first alive match wins.
    let assignedRole: string | null = null;
    const tm = botManager.getTownManager();
    for (const town of tm.listTowns()) {
      const resident = tm
        .listResidents(town.id)
        .find(
          (r) =>
            r.botName.toLowerCase() === name.toLowerCase() &&
            (r.status === 'alive' || r.status == null),
        );
      if (resident) {
        assignedRole = resident.currentRole ?? null;
        break;
      }
    }
    res.json({ observedRole, scores, assignedRole });
  });

  // Bot decision traces — from worker-forwarded trace buffer
  app.get('/api/bots/:name/decisions', (req: Request, res: Response) => {
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    const limit = parseInt(String(req.query.limit ?? '50')) || 50;
    const type = req.query.type ? String(req.query.type) : undefined;
    const traces = handle.getDecisionTraces(limit, type as any);
    res.json({ decisions: traces });
  });

  // ═══════════════════════════════════════
  //  SMART AI SYSTEM ENDPOINTS
  // ═══════════════════════════════════════

  // Shared world model
  app.get('/api/world/model', (_req: Request, res: Response) => {
    res.json(botManager.getSharedWorldModel().getSnapshot());
  });

  // Bot reputation scores
  app.get('/api/reputation', (_req: Request, res: Response) => {
    res.json({ scores: botManager.getBotReputation().getAllReputations() });
  });

  app.get('/api/reputation/:name', (req: Request, res: Response) => {
    const score = botManager.getBotReputation().getReputation(req.params.name as string);
    res.json({ reputation: score });
  });

  // DungeonMaster world events
  app.get('/api/events/world', (_req: Request, res: Response) => {
    res.json({ active: botManager.getDungeonMaster().getActiveEvents(), history: botManager.getDungeonMaster().getEventHistory(20) });
  });

  // Difficulty state
  app.get('/api/difficulty', (_req: Request, res: Response) => {
    res.json(botManager.getDifficultyBalancer().calculateDifficulty());
  });

  // Swarm coordination plans
  app.get('/api/swarm/plans', (_req: Request, res: Response) => {
    res.json({ plans: botManager.getSwarmCoordinator().getActivePlans() });
  });

  // Online players with positions — queried via any connected worker bot
  app.get('/api/players', async (_req: Request, res: Response) => {
    try {
      for (const handle of botManager.getAllWorkers() as any[]) {
        if (typeof handle.isBotConnected === 'function' && (await handle.isBotConnected())) {
          const players = await handle.getPlayers();
          res.json({ players });
          return;
        }
      }
      res.json({ players: [] });
    } catch (err: any) {
      res.status(500).json({ error: err.message, players: [] });
    }
  });

  // Player intent predictions
  app.get('/api/players/:name/intent', (req: Request, res: Response) => {
    const prediction = botManager.getPlayerIntentModel().predictIntent(req.params.name as string);
    res.json({ prediction });
  });

  // Social memory for a bot
  app.get('/api/bots/:name/memories', (req: Request, res: Response) => {
    try {
      const name = req.params.name as string;
      const sm = botManager.getSocialMemory();
      const memories = sm.getRecentMemories(name, 20);
      const emotionalState = sm.getEmotionalState(name);
      res.json({ memories, emotionalState });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Bot-to-bot messages received by a bot
  app.get('/api/bots/:name/messages', (req: Request, res: Response) => {
    try {
      const name = req.params.name as string;
      // peekUnread returns pending messages without marking them consumed
      const messages = botManager.getBotComms().peekUnread(name);
      res.json({ messages });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Send a message from one bot to another
  app.post('/api/bots/:name/bot-message', (req: Request, res: Response) => {
    const { to, content } = req.body;
    if (!to || !content) {
      res.status(400).json({ error: 'to and content are required' });
      return;
    }
    try {
      botManager.getBotComms().sendMessage(
        req.params.name as string,
        to,
        content,
        'chat',
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Full social graph (all bots, all players) — direct from main thread
  app.get('/api/relationships', (_req: Request, res: Response) => {
    const allAffinities = botManager.getAffinityManager().getAll();
    res.json({ relationships: allAffinities });
  });

  // Project Sid P3-B — cultural-meme layer snapshot. Mirrors Sid's per-town
  // meme curves: the meme registry (label, strength, adoption count) plus
  // per-town keyword/adoption counts. The registry stays empty unless
  // `config.social.culture` is on and bots have started adopting memes, so this
  // safely returns `{ enabled, memes: [], towns: {}, totalAdoptions: 0 }` when
  // the flag is off.
  app.get('/api/culture', (_req: Request, res: Response) => {
    const enabled = !!botManager.getConfig().social?.culture;
    const summary = botManager.getCultureManager().getSummary();
    res.json({ enabled, ...summary });
  });

  // Global skill library — read from disk, cached and invalidated on index mtime.
  // Caches the fully-parsed payload (array of skill objects + code previews),
  // not the raw JSON text, so a cache hit can ship straight to res.json
  // without doing JSON.parse + a fan-out of per-skill code reads. Cache key
  // is the index.json mtimeMs only; per-skill code preview is captured at
  // the same moment the index is parsed, so an edit to a single skill file
  // won't invalidate the cache until the index is rewritten by the skill
  // library (which the codebase does on every learn/update).
  let skillsCache: { mtimeMs: number; payload: { skills: any[]; count: number } } | null = null;
  app.get('/api/skills', (_req: Request, res: Response) => {
    try {
      const indexPath = path.join(process.cwd(), 'skills', 'index.json');
      // statSync throws if the file is missing — guard with existsSync so we
      // can return an empty payload without going through the catch block.
      if (!fs.existsSync(indexPath)) {
        res.json({ skills: [], count: 0 });
        return;
      }
      const indexMtime = fs.statSync(indexPath).mtimeMs;
      // Cache hit: index hasn't changed since we last built the payload —
      // skip parsing + per-skill code reads entirely.
      if (skillsCache && skillsCache.mtimeMs === indexMtime) {
        res.json(skillsCache.payload);
        return;
      }

      // Cache miss: re-parse and rebuild. We do this on the same tick so the
      // cached payload's `code` previews stay consistent with the index it
      // was derived from.
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      const entries: any[] = Array.isArray(index) ? index : Object.values(index);
      const skills = entries.map((entry: any) => {
        const name: string = entry?.name ?? '';
        const fileName: string = entry?.file ?? `${name}.js`;
        const skillPath = path.join(process.cwd(), 'skills', fileName);
        const code = fs.existsSync(skillPath)
          ? fs.readFileSync(skillPath, 'utf-8').slice(0, 2000)
          : null;
        return {
          name,
          description: entry?.description ?? null,
          keywords: entry?.keywords ?? [],
          quality: entry?.quality ?? null,
          successCount: entry?.successCount ?? 0,
          failureCount: entry?.failureCount ?? 0,
          code,
        };
      });
      const payload = { skills, count: skills.length };
      // Store the parsed array, not the raw text — readers compare by mtime
      // and ship the payload as-is from here on.
      skillsCache = { mtimeMs: indexMtime, payload };
      res.json(payload);
    } catch {
      // Don't poison the cache on read/parse failure — leave the previous
      // good payload (if any) in place so a transient JSON write doesn't
      // invalidate a healthy cache.
      res.json({ skills: [], count: 0 });
    }
  });

  // Aggregate skill metrics — totals, top performers, top failures.
  // Registered before /api/skills/:name so 'stats' isn't matched as a skill name.
  app.get('/api/skills/stats', (_req: Request, res: Response) => {
    try {
      const indexPath = path.join(process.cwd(), 'skills', 'index.json');
      if (!fs.existsSync(indexPath)) {
        res.json({
          total: 0,
          totalSuccesses: 0,
          totalFailures: 0,
          averageQuality: 0,
          topPerformers: [],
          topFailures: [],
          neverUsed: 0,
        });
        return;
      }
      const raw = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      const entries: any[] = Array.isArray(raw) ? raw : Object.values(raw);

      let totalSuccesses = 0;
      let totalFailures = 0;
      let qualitySum = 0;
      let qualityCount = 0;
      let neverUsed = 0;

      const summarized = entries.map((entry: any) => {
        const successCount = Number(entry?.successCount ?? 0);
        const failureCount = Number(entry?.failureCount ?? 0);
        const quality = typeof entry?.quality === 'number' ? entry.quality : null;
        totalSuccesses += successCount;
        totalFailures += failureCount;
        if (quality !== null) {
          qualitySum += quality;
          qualityCount += 1;
        }
        if (successCount === 0 && failureCount === 0) neverUsed += 1;
        return {
          name: entry?.name ?? '',
          description: entry?.description ?? null,
          successCount,
          failureCount,
          quality,
        };
      });

      const topPerformers = [...summarized]
        .filter((s) => s.successCount > 0)
        .sort((a, b) => b.successCount - a.successCount || (b.quality ?? 0) - (a.quality ?? 0))
        .slice(0, 10);
      const topFailures = [...summarized]
        .filter((s) => s.failureCount > 0)
        .sort((a, b) => b.failureCount - a.failureCount)
        .slice(0, 10);

      res.json({
        total: summarized.length,
        totalSuccesses,
        totalFailures,
        averageQuality: qualityCount > 0 ? Number((qualitySum / qualityCount).toFixed(3)) : 0,
        neverUsed,
        topPerformers,
        topFailures,
      });
    } catch (err: any) {
      logger.warn({ err: err?.message }, 'Failed to compute /api/skills/stats');
      res.status(500).json({ error: 'Failed to compute skill stats' });
    }
  });

  // Single skill with code — read from disk
  app.get('/api/skills/:name', (req: Request, res: Response) => {
    const skillName = req.params.name as string;
    // Path-traversal guard: req.params is URL-decoded, so without this a name
    // like `..%2f..%2fdist%2fconfig` would escape the skills/ dir and read any
    // .js file on disk. Mirrors the isSafeSkillName check used by PUT/DELETE.
    if (!/^[a-zA-Z0-9_-]+$/.test(skillName)) {
      res.status(400).json({ error: 'Invalid skill name' });
      return;
    }
    const skillPath = path.join(process.cwd(), 'skills', `${skillName}.js`);
    if (!fs.existsSync(skillPath)) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }
    const code = fs.readFileSync(skillPath, 'utf-8');
    res.json({ name: skillName, code });
  });

  // Helpers for skill PUT/DELETE — load/save the canonical index.json without
  // disturbing per-skill metadata (embeddings, success counts) we don't own.
  const skillsDir = path.join(process.cwd(), 'skills');
  const skillIndexPath = path.join(skillsDir, 'index.json');
  const isSafeSkillName = (name: string) => /^[a-zA-Z0-9_-]+$/.test(name);
  const readSkillIndex = (): any[] => {
    if (!fs.existsSync(skillIndexPath)) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(skillIndexPath, 'utf-8'));
      return Array.isArray(raw) ? raw : Object.values(raw);
    } catch {
      return [];
    }
  };
  const writeSkillIndex = (entries: any[]) => {
    atomicWriteJsonSync(skillIndexPath, entries);
    // Invalidate the GET /api/skills cache so the new state is visible.
    skillsCache = null;
  };

  // Edit a skill: replace code (validated for parseability) + optional metadata.
  app.put('/api/skills/:name', (req: Request, res: Response) => {
    const skillName = req.params.name as string;
    if (!isSafeSkillName(skillName)) {
      res.status(400).json({ error: 'Invalid skill name' });
      return;
    }
    const { code, description, keywords } = req.body ?? {};
    if (typeof code !== 'string' || code.length === 0) {
      res.status(400).json({ error: 'code (non-empty string) is required' });
      return;
    }
    if (code.length > 200_000) {
      res.status(400).json({ error: 'code too large (200KB max)' });
      return;
    }
    if (description !== undefined && typeof description !== 'string') {
      res.status(400).json({ error: 'description must be a string' });
      return;
    }
    if (keywords !== undefined && (!Array.isArray(keywords) || keywords.some((k: unknown) => typeof k !== 'string'))) {
      res.status(400).json({ error: 'keywords must be string[]' });
      return;
    }
    // Sanity-check that the JS parses. new Function throws SyntaxError if not.
    try {
      // eslint-disable-next-line no-new-func
      new Function(code);
    } catch (err: any) {
      res.status(400).json({ error: `Code has a syntax error: ${err?.message || err}` });
      return;
    }
    const entries = readSkillIndex();
    const idx = entries.findIndex((e: any) => e?.name === skillName);
    if (idx < 0) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }
    const fileName: string = entries[idx]?.file || `${skillName}.js`;
    const filePath = path.join(skillsDir, fileName);
    try {
      atomicWriteTextSync(filePath, code);
    } catch (err: any) {
      res.status(500).json({ error: `Failed to write skill file: ${err?.message}` });
      return;
    }
    if (typeof description === 'string') entries[idx].description = description;
    if (Array.isArray(keywords)) entries[idx].keywords = keywords;
    writeSkillIndex(entries);
    logger.info({ name: skillName }, 'Skill updated via API');
    res.json({
      skill: {
        name: skillName,
        description: entries[idx].description ?? null,
        keywords: entries[idx].keywords ?? [],
        code,
      },
    });
  });

  // Delete a skill: remove its file and index entry.
  app.delete('/api/skills/:name', (req: Request, res: Response) => {
    const skillName = req.params.name as string;
    if (!isSafeSkillName(skillName)) {
      res.status(400).json({ error: 'Invalid skill name' });
      return;
    }
    const entries = readSkillIndex();
    const idx = entries.findIndex((e: any) => e?.name === skillName);
    if (idx < 0) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }
    const fileName: string = entries[idx]?.file || `${skillName}.js`;
    const filePath = path.join(skillsDir, fileName);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err: any) {
      logger.warn({ err: err?.message, fileName }, 'Failed to delete skill file');
    }
    entries.splice(idx, 1);
    writeSkillIndex(entries);
    logger.info({ name: skillName }, 'Skill deleted via API');
    res.json({ success: true });
  });

  // Aggregate world state — from first bot's cached detailed status
  app.get('/api/world', (_req: Request, res: Response) => {
    const workers = botManager.getAllWorkers();
    for (const w of workers) {
      const detailed = w.getCachedDetailedStatus();
      if (detailed?.world) {
        res.json({
          timeOfDay: detailed.world.timeOfDay,
          timeOfDayTicks: detailed.world.timeOfDayTicks ?? null,
          day: detailed.world.day ?? null,
          isRaining: detailed.world.isRaining,
          onlineBots: workers.filter((h) => h.isAlive()).length,
          onlinePlayers: botManager.getPlayerPresenceTracker().getPlayerCount(),
        });
        return;
      }
    }
    res.json({
      timeOfDay: null,
      timeOfDayTicks: null,
      day: null,
      isRaining: null,
      onlineBots: 0,
      onlinePlayers: botManager.getPlayerPresenceTracker().getPlayerCount(),
    });
  });

  // Shared blackboard state — direct from main thread
  app.get('/api/blackboard', (_req: Request, res: Response) => {
    res.json({ blackboard: botManager.getBlackboardManager().getState() });
  });

  // Activity log
  app.get('/api/activity', (req: Request, res: Response) => {
    const limit = parseInt(String(req.query.limit ?? '50')) || 50;
    const botName = req.query.bot ? String(req.query.bot) : undefined;
    const type = req.query.type ? String(req.query.type) : undefined;
    const events = eventLog.getRecent(limit, botName, type);
    res.json({ events });
  });

  // Send chat message to a bot (from dashboard) — forward to worker
  app.post('/api/bots/:name/chat', (req: Request, res: Response) => {
    const { playerName, message } = req.body;
    if (!playerName || !message) {
      res.status(400).json({ error: 'playerName and message are required' });
      return;
    }
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle || !handle.isAlive()) {
      res.status(404).json({ error: 'Bot not found or not connected' });
      return;
    }
    handle.sendCommand('queueChat', { playerName, message });
    res.json({ success: true });
  });

  // Make a bot say raw chat (or run a server command if prefixed with /)
  app.post('/api/bots/:name/say', (req: Request, res: Response) => {
    const { message } = req.body;
    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }
    const handle = botManager.getWorker(req.params.name as string) as any;
    if (!handle || !handle.isAlive()) {
      res.status(404).json({ error: 'Bot not found or not connected' });
      return;
    }
    if (typeof handle.chat !== 'function') {
      res.status(500).json({ error: 'Bot handle does not support chat' });
      return;
    }
    handle.chat(message);
    res.json({ success: true });
  });

  // Task #72 — Dev-only /grant endpoint for offline-mode item seeding.
  // The handler logic lives in `createGrantHandler` (exported above, near
  // the top of this file) so it can be tested in isolation without
  // spinning up a full BotManager. Gated by `requireDev`: NODE_ENV ===
  // 'development' OR config.auth.devSecret being set.
  app.post(
    '/api/bots/:name/grant',
    requireDev,
    createGrantHandler({
      getWorker: (name) => botManager.getWorker(name) as any,
    }),
  );

  // Queue a task for a bot (from dashboard) — forward to worker
  app.post('/api/bots/:name/task', (req: Request, res: Response) => {
    const { description } = req.body;
    if (!description) {
      res.status(400).json({ error: 'description is required' });
      return;
    }
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    handle.sendCommand('queueTask', { description, source: 'dashboard' });

    const event = eventLog.push({
      type: 'bot:task',
      botName: req.params.name as string,
      description: `Task queued: ${description}`,
      metadata: { source: 'dashboard' },
    });
    // `bot:task` socket event removed per the dead-event audit (no listeners).
    // Surfaced via the `activity` channel + activity log instead.
    io.emit('activity', event);

    res.json({ success: true });
  });

  // Set a swarm directive from dashboard/UI
  app.post('/api/swarm', asyncH(async (req: Request, res: Response) => {
    const { description, requestedBy } = req.body ?? {};
    // `description` is the core directive — must be a non-empty string and
    // bounded so a runaway client can't queue a megabyte directive into
    // the blackboard.
    if (typeof description !== 'string' || description.trim().length === 0) {
      res.status(400).json({ error: 'description is required (non-empty string)' });
      return;
    }
    if (description.length > 2000) {
      res.status(400).json({ error: 'description must be ≤2000 characters' });
      return;
    }
    // `requestedBy` is optional metadata — short string when present.
    if (requestedBy !== undefined && requestedBy !== null) {
      if (typeof requestedBy !== 'string' || requestedBy.length > 64) {
        res.status(400).json({ error: 'requestedBy must be a string ≤64 chars' });
        return;
      }
    }
    const source = (typeof requestedBy === 'string' && requestedBy.length > 0) ? requestedBy : 'dashboard';

    await botManager.handleSwarmDirective(description, source);

    const event = eventLog.push({
      type: 'swarm:directive',
      botName: 'swarm',
      description: `Swarm directive set: ${description}`,
      metadata: { requestedBy: source },
    });
    io.emit('activity', event);
    res.json({ success: true });
  }));

  // ═══════════════════════════════════════
  // ═══════════════════════════════════════
  //  LLM USAGE ENDPOINT (TokenLedger)
  // ═══════════════════════════════════════

  // LLM settings and usage are managed via index.ts injection
  // Placeholder — real endpoints registered by registerLLMSettingsRoutes() below

  //  METRICS ENDPOINT
  // ═══════════════════════════════════════

  let metricsCache: { at: number; payload: any } | null = null;
  const METRICS_TTL_MS = 30_000;
  app.get('/api/metrics', (_req: Request, res: Response) => {
    try {
      if (metricsCache && Date.now() - metricsCache.at < METRICS_TTL_MS) {
        res.json(metricsCache.payload);
        return;
      }
      const workers = botManager.getAllWorkers();
      const statuses = botManager.getAllBotStatuses();

      // ── Bot overview ──
      const totalBots = workers.length;
      const aliveBots = workers.filter((w) => w.isAlive()).length;
      const idleBots = statuses.filter((s: any) => s.state === 'IDLE').length;
      const workingBots = statuses.filter((s: any) => s.state === 'EXECUTING_TASK').length;

      // ── Bot states breakdown ──
      const stateBreakdown: Record<string, number> = {};
      for (const s of statuses) {
        const state = (s as any).state || 'UNKNOWN';
        stateBreakdown[state] = (stateBreakdown[state] || 0) + 1;
      }

      // ── Personality breakdown ──
      const personalityBreakdown: Record<string, number> = {};
      for (const s of statuses) {
        const p = (s as any).personality || 'unknown';
        personalityBreakdown[p] = (personalityBreakdown[p] || 0) + 1;
      }

      // ── Task metrics (from detailed statuses) ──
      let totalCompleted = 0;
      let totalFailed = 0;
      let totalQueued = 0;
      let activeTasks = 0;
      const botTaskStats: Array<{ name: string; personality: string; completed: number; failed: number; queued: number; currentTask: string | null }> = [];

      for (const w of workers) {
        const detailed = w.getCachedDetailedStatus();
        const name = w.botName;
        const personality = w.personality;
        const completed = detailed?.voyager?.completedTasks?.length || 0;
        const failed = detailed?.voyager?.failedTasks?.length || 0;
        const queued = detailed?.voyager?.queuedTaskCount || 0;
        const currentTask = detailed?.voyager?.currentTask || null;

        totalCompleted += completed;
        totalFailed += failed;
        totalQueued += queued;
        if (currentTask) activeTasks++;

        botTaskStats.push({ name, personality, completed, failed, queued, currentTask });
      }

      const totalTasks = totalCompleted + totalFailed;
      const taskSuccessRate = totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0;

      // ── Command metrics (from persisted data if available) ──
      // CommandStatus values: 'queued' | 'started' | 'succeeded' | 'failed' | 'cancelled'
      let commandMetrics = { total: 0, succeeded: 0, failed: 0, pending: 0, cancelled: 0, successRate: 0 };
      try {
        const cmdPath = path.join(process.cwd(), 'data', 'commands.json');
        if (fs.existsSync(cmdPath)) {
          const cmdData = JSON.parse(fs.readFileSync(cmdPath, 'utf-8'));
          const commands = Array.isArray(cmdData) ? cmdData : (cmdData.commands || []);
          commandMetrics.total = commands.length;
          commandMetrics.succeeded = commands.filter((c: any) => c.status === 'succeeded').length;
          commandMetrics.failed = commands.filter((c: any) => c.status === 'failed').length;
          commandMetrics.pending = commands.filter((c: any) => c.status === 'queued' || c.status === 'started').length;
          commandMetrics.cancelled = commands.filter((c: any) => c.status === 'cancelled').length;
          commandMetrics.successRate = commandMetrics.total > 0
            ? Math.round((commandMetrics.succeeded / commandMetrics.total) * 100) : 0;
        }
      } catch { /* ignore */ }

      // ── Mission metrics (from persisted data if available) ──
      let missionMetrics = { total: 0, active: 0, completed: 0, failed: 0, paused: 0, completionRate: 0, byType: {} as Record<string, number> };
      try {
        const msnPath = path.join(process.cwd(), 'data', 'missions.json');
        if (fs.existsSync(msnPath)) {
          const msnData = JSON.parse(fs.readFileSync(msnPath, 'utf-8'));
          const missions = Array.isArray(msnData) ? msnData : (msnData.missions || []);
          missionMetrics.total = missions.length;
          missionMetrics.active = missions.filter((m: any) => m.status === 'running').length;
          missionMetrics.completed = missions.filter((m: any) => m.status === 'completed').length;
          missionMetrics.failed = missions.filter((m: any) => m.status === 'failed').length;
          missionMetrics.paused = missions.filter((m: any) => m.status === 'paused').length;
          missionMetrics.completionRate = missionMetrics.total > 0
            ? Math.round((missionMetrics.completed / missionMetrics.total) * 100) : 0;
          for (const m of missions) {
            const t = m.type || 'unknown';
            missionMetrics.byType[t] = (missionMetrics.byType[t] || 0) + 1;
          }
        }
      } catch { /* ignore */ }

      // ── Commander metrics ──
      let commanderMetrics = { parseCount: 0, avgConfidence: 0, failureRate: 0 };
      try {
        const csMetrics = commanderService.getMetrics();
        commanderMetrics.parseCount = csMetrics.totalParses;
        commanderMetrics.avgConfidence = csMetrics.averageConfidence
          ? Math.round(csMetrics.averageConfidence * 100)
          : 0;
        commanderMetrics.failureRate = csMetrics.totalParses > 0
          ? Math.round((csMetrics.failedParses / csMetrics.totalParses) * 100)
          : 0;
      } catch {
        // Fallback: read from persisted data
        try {
          const cmdPath = path.join(process.cwd(), 'data', 'commands.json');
          if (fs.existsSync(cmdPath)) {
            const cmdData = JSON.parse(fs.readFileSync(cmdPath, 'utf-8'));
            const commands = Array.isArray(cmdData) ? cmdData : (cmdData.commands || []);
            const parsed = commands.filter((c: any) => c.source === 'commander' || c.parsedPlan);
            commanderMetrics.parseCount = parsed.length;
            const confidences = parsed.map((c: any) => c.confidence ?? c.parsedPlan?.confidence).filter((c: any) => typeof c === 'number');
            commanderMetrics.avgConfidence = confidences.length > 0
              ? Math.round(confidences.reduce((a: number, b: number) => a + b, 0) / confidences.length) : 0;
            const cmdFailed = parsed.filter((c: any) => c.status === 'failed').length;
            commanderMetrics.failureRate = parsed.length > 0
              ? Math.round((cmdFailed / parsed.length) * 100) : 0;
          }
        } catch { /* ignore */ }
      }

      // ── Fleet metrics ──
      // RoleAssignmentRecord fields: id, botName, role, autonomyLevel, ...
      // SquadRecord fields: id, name, botNames, ...
      // Overrides are tracked separately in RoleManager (in-memory), not on the assignment record.
      let fleetMetrics = { botsByRole: {} as Record<string, number>, overrideCount: 0, activeSquads: 0, totalSquads: 0 };
      try {
        const rolesPath = path.join(process.cwd(), 'data', 'roles.json');
        if (fs.existsSync(rolesPath)) {
          const rolesData = JSON.parse(fs.readFileSync(rolesPath, 'utf-8'));
          const assignments = Array.isArray(rolesData) ? rolesData : (rolesData.assignments || []);
          for (const a of assignments) {
            const role = a.role || 'unassigned';
            fleetMetrics.botsByRole[role] = (fleetMetrics.botsByRole[role] || 0) + 1;
            // Note: manualOverride is not a field on RoleAssignmentRecord;
            // overrides are tracked in-memory by RoleManager.
          }
        }
      } catch { /* ignore */ }
      try {
        const squadsPath = path.join(process.cwd(), 'data', 'squads.json');
        if (fs.existsSync(squadsPath)) {
          const squadsData = JSON.parse(fs.readFileSync(squadsPath, 'utf-8'));
          // File may be a raw array or { squads: [...] }
          const squads = Array.isArray(squadsData) ? squadsData : (squadsData.squads || []);
          fleetMetrics.totalSquads = squads.length;
          // SquadRecord uses botNames, not members
          fleetMetrics.activeSquads = squads.filter((s: any) => (s.botNames || s.members || []).length > 0).length;
        }
      } catch { /* ignore */ }

      // ── Skill metrics ──
      let skillCount = 0;
      try {
        const indexPath = path.join(process.cwd(), 'skills', 'index.json');
        if (fs.existsSync(indexPath)) {
          const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
          skillCount = Object.keys(index).length;
        }
      } catch { /* ignore */ }

      // ── Health summary ──
      const healthStats: Array<{ name: string; health: number; food: number }> = [];
      for (const w of workers) {
        const detailed = w.getCachedDetailedStatus();
        if (detailed) {
          healthStats.push({
            name: w.botName,
            health: detailed.health ?? 20,
            food: detailed.food ?? 20,
          });
        }
      }

      const payload = {
        timestamp: Date.now(),
        bots: {
          total: totalBots,
          alive: aliveBots,
          idle: idleBots,
          working: workingBots,
          stateBreakdown,
          personalityBreakdown,
          healthStats,
        },
        tasks: {
          totalCompleted,
          totalFailed,
          totalQueued,
          activeTasks,
          successRate: taskSuccessRate,
          botTaskStats,
        },
        commands: commandMetrics,
        missions: missionMetrics,
        commander: commanderMetrics,
        fleet: fleetMetrics,
        skills: { count: skillCount },
      };
      metricsCache = { at: Date.now(), payload };
      res.json(payload);
    } catch (err) {
      logger.error({ err }, 'Failed to gather metrics');
      res.status(500).json({ error: 'Failed to gather metrics' });
    }
  });

  // Civilization-progress metrics (Project Sid P1-B). Read-only; defaults ON.
  // Measures the emergent society over the CURRENT fleet:
  //   - roleEntropy:        Shannon entropy (bits) over observed roles (Fig-8E).
  //   - actionExclusivity:  how concentrated each action type is in one bot (Fig-9).
  //   - uniqueItems:        distinct + cumulative items mined+crafted (Fig-5).
  //   - roleDistribution:   observed-role histogram.
  // Inputs are the per-bot action tallies on disk (data/stats.json) and each
  // current bot's observed role (reusing ObservedRoleModel from P1-A); the math
  // lives in the pure town/CivilizationMetrics module.
  let civMetricsCache: { at: number; payload: any } | null = null;
  app.get('/api/metrics/civilization', (_req: Request, res: Response) => {
    try {
      if (civMetricsCache && Date.now() - civMetricsCache.at < METRICS_TTL_MS) {
        res.json(civMetricsCache.payload);
        return;
      }

      // Current fleet = the live worker handles (same source as /api/metrics).
      const fleetNames = botManager.getAllWorkers().map((w) => w.botName);

      // Load the on-disk action tallies once; the API process only has the file
      // (StatsTracker lives inside per-bot worker threads).
      let allStats: Record<string, BotActionStats> = {};
      try {
        const statsPath = path.join(process.cwd(), 'data', 'stats.json');
        if (fs.existsSync(statsPath)) {
          allStats = JSON.parse(fs.readFileSync(statsPath, 'utf-8')) as Record<string, BotActionStats>;
        }
      } catch {
        allStats = {};
      }

      // Restrict stats + observed roles to the current fleet so the metrics
      // describe the live society, not every bot that ever ran.
      const statsByBot: Record<string, BotActionStats> = {};
      const observedRoles: string[] = [];
      for (const name of fleetNames) {
        const row = allStats[name] ?? {};
        statsByBot[name] = row;
        // Reuse the already-parsed allStats instead of loadObservedRole(name),
        // which would re-read+parse stats.json once per bot (N+1 disk reads on
        // this cached-but-hot endpoint).
        observedRoles.push(inferObservedRole(row).observedRole);
      }

      const metrics = computeCivilizationMetrics(observedRoles, statsByBot);
      const payload = {
        timestamp: Date.now(),
        fleetSize: fleetNames.length,
        ...metrics,
      };
      civMetricsCache = { at: Date.now(), payload };
      res.json(payload);
    } catch (err) {
      logger.error({ err }, 'Failed to gather civilization metrics');
      res.status(500).json({ error: 'Failed to gather civilization metrics' });
    }
  });

  // ═══════════════════════════════════════
  //  COMMANDER ENDPOINTS
  // ═══════════════════════════════════════

  // ── Commander (extracted → routes/commanderRoutes.ts) ──
  registerCommanderRoutes(app, { commanderService, eventLog, io });

  // ═══════════════════════════════════════
  //  BUILD ENDPOINTS
  // ═══════════════════════════════════════

  // ── Schematics (extracted → routes/schematicRoutes.ts) ──
  registerSchematicRoutes(app, { buildCoordinator, schematicMatcher, schematicsDir });

  // List all build jobs
  app.get('/api/builds', (_req: Request, res: Response) => {
    res.json({ builds: buildCoordinator.getAllBuildJobs() });
  });

  // Create a new build job
  app.post('/api/builds', asyncH(async (req: Request, res: Response) => {
    const { schematicFile, origin, botNames, options } = req.body ?? {};
    const originMode = options?.originMode ?? 'coords';
    const originRequired = originMode === 'coords';
    if (!schematicFile || !botNames || !Array.isArray(botNames) || botNames.length === 0) {
      res.status(400).json({ error: 'schematicFile and botNames[] are required' });
      return;
    }
    if (!isSafeFilename(schematicFile)) {
      res.status(400).json({ error: 'invalid schematicFile' });
      return;
    }
    if (originRequired && !origin) {
      res.status(400).json({ error: 'origin {x,y,z} is required when originMode is "coords" (default)' });
      return;
    }
    // Validate `mode` if present so a typo doesn't silently fall back to surface.
    const requestedMode = options?.mode;
    if (requestedMode !== undefined && requestedMode !== 'surface' && requestedMode !== 'underground') {
      res.status(400).json({ error: `options.mode must be "surface" or "underground" (got: ${requestedMode})` });
      return;
    }
    // Validate autoGather flags so a string in the body doesn't silently
    // skip the pre-stage. autoGather must be a boolean and the timeout, if
    // present, must be a positive number.
    if (options?.autoGather !== undefined && typeof options.autoGather !== 'boolean') {
      res.status(400).json({ error: 'options.autoGather must be a boolean' });
      return;
    }
    if (options?.autoGatherTimeoutMs !== undefined &&
      (typeof options.autoGatherTimeoutMs !== 'number' || options.autoGatherTimeoutMs <= 0)) {
      res.status(400).json({ error: 'options.autoGatherTimeoutMs must be a positive number (ms)' });
      return;
    }
    try {
      // Placeholder origin for non-coords modes so resolveOrigin has a safe fallback.
      const resolvedOrigin = origin ?? { x: 0, y: 64, z: 0 };
      const startOptions = options
        ? { ...options, mode: requestedMode as 'surface' | 'underground' | undefined }
        : undefined;
      const job = await buildCoordinator.startBuild(schematicFile, resolvedOrigin, botNames, startOptions);
      res.status(201).json({ build: job });
    } catch (err: any) {
      logger.error({ err }, 'Failed to start build');
      // Sanitize so an error originating in BuildCoordinator (which often
      // includes absolute schematic paths in its messages) doesn't leak the
      // server's filesystem layout to API callers.
      res.status(400).json({ error: sanitizeErrorMessage(err, 'Failed to start build') });
    }
  }));

  // Get a specific build job
  app.get('/api/builds/:id', (req: Request, res: Response) => {
    const job = buildCoordinator.getBuildJob(req.params.id as string);
    if (!job) {
      res.status(404).json({ error: 'Build not found' });
      return;
    }
    res.json({ build: job });
  });

  // Cancel a build
  app.post('/api/builds/:id/cancel', (req: Request, res: Response) => {
    const success = buildCoordinator.cancelBuild(req.params.id as string);
    if (!success) {
      res.status(404).json({ error: 'Build not found or already finished' });
      return;
    }
    res.json({ success: true });
  });

  // Pause a build
  app.post('/api/builds/:id/pause', (req: Request, res: Response) => {
    const success = buildCoordinator.pauseBuild(req.params.id as string);
    if (!success) {
      res.status(404).json({ error: 'Build not found or not running' });
      return;
    }
    res.json({ success: true });
  });

  // Resume a build
  app.post('/api/builds/:id/resume', (req: Request, res: Response) => {
    const success = buildCoordinator.resumeBuild(req.params.id as string);
    if (!success) {
      res.status(404).json({ error: 'Build not found or not paused' });
      return;
    }
    res.json({ success: true });
  });

  // Retry a failed (or completed_with_errors) build — re-runs incomplete
  // assignments, resuming each bot from its already-placed blocks.
  app.post('/api/builds/:id/retry', asyncH(async (req: Request, res: Response) => {
    try {
      const job = await buildCoordinator.retryBuild(req.params.id as string);
      if (!job) {
        res.status(404).json({ error: 'Build not found' });
        return;
      }
      res.json({ success: true, build: job });
    } catch (err: any) {
      res.status(409).json({ error: err.message });
    }
  }));

  // Demolish a build's footprint (chunked /fill air via an op bot). Use
  // ?dryRun=true to preview the bounding box without clearing anything.
  app.post('/api/builds/:id/demolish', asyncH(async (req: Request, res: Response) => {
    try {
      const dryRun = req.query.dryRun === 'true' || (req.body && req.body.dryRun === true);
      const result = await buildCoordinator.demolishBuild(req.params.id as string, { dryRun });
      if (!result) {
        res.status(404).json({ error: 'Build not found' });
        return;
      }
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(409).json({ error: err.message });
    }
  }));

  // Build the rail+walkway tunnel between the two town halls. Use ?dryRun=true
  // to preview the planned route/boxes. The tunnel coordinates are hard-coded
  // for the current town, so carving requires an explicit confirm:true (body or
  // ?confirm=true) — without it the endpoint returns the plan with refused:true.
  app.post('/api/tunnel', asyncH(async (req: Request, res: Response) => {
    try {
      const dryRun = req.query.dryRun === 'true' || (req.body && req.body.dryRun === true);
      const confirm = req.query.confirm === 'true' || (req.body && req.body.confirm === true);
      const result = await buildCoordinator.buildTunnel({ dryRun, confirm });
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(409).json({ error: err.message });
    }
  }));

  // ═══════════════════════════════════════
  //  CAMPAIGN ENDPOINTS
  // ═══════════════════════════════════════

  // ── Campaigns (extracted → routes/campaignRoutes.ts) ──
  registerCampaignRoutes(app, { campaignManager });

  // ═══════════════════════════════════════
  //  SUPPLY CHAIN ENDPOINTS
  // ═══════════════════════════════════════

  // ── Supply chains (extracted → routes/chainRoutes.ts) ──
  registerChainRoutes(app, { chainCoordinator });

  // ═══════════════════════════════════════
  //  TERRAIN ENDPOINTS (extracted → routes/terrainRoutes.ts)
  // ═══════════════════════════════════════
  registerTerrainRoutes(app, { botManager });

  // ═══════════════════════════════════════
  //  CONTROL PLATFORM ENDPOINTS
  //  (MarkerStore, SquadManager, RoleManager,
  //   MissionManager, CommandCenter, TemplateManager)
  // ═══════════════════════════════════════

  // ── Control platform: markers/zones/routes/squads/roles
  //    (extracted → routes/controlRoutes.ts) ──
  registerControlRoutes(app, { markerStore, squadManager, roleManager });

  // ── Missions ──
  app.get('/api/missions', (req, res) => {
    const filters = req.query.status ? { status: String(req.query.status) as any } : undefined;
    res.json({ missions: missionManager.getMissions(filters) });
  });
  app.post('/api/missions', asyncH(async (req, res) => {
    // Validate the body up-front rather than passing whatever the client sent
    // straight into MissionManager.createMission(). The MissionManager doesn't
    // re-validate field shapes, so a malformed body could otherwise produce a
    // half-constructed mission record that survives a process restart.
    const body = (req.body ?? {}) as Record<string, unknown>;

    // ── Required: title (string, non-empty, ≤200 chars) ──
    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      res.status(400).json({ error: 'title is required (non-empty string)' });
      return;
    }
    if (body.title.length > 200) {
      res.status(400).json({ error: 'title must be ≤200 characters' });
      return;
    }

    // ── Required: type (MissionType enum) ──
    const allowedTypes = new Set([
      'queue_task', 'gather_items', 'craft_items', 'smelt_batch',
      'build_schematic', 'supply_chain', 'patrol_zone', 'escort_player',
      'resupply_builder',
    ]);
    if (typeof body.type !== 'string' || !allowedTypes.has(body.type)) {
      res.status(400).json({ error: `type must be one of: ${[...allowedTypes].join(', ')}` });
      return;
    }

    // ── Required: assigneeType + assigneeIds[] ──
    // Accepts either the canonical { assigneeType, assigneeIds } shape OR
    // the convenience aliases `assigneeBotNames` (→ bot) and `squadId` (→
    // squad). The latter mirror what callers naturally type at the curl
    // prompt without forcing a refactor in the dashboard.
    let assigneeType: 'bot' | 'squad' | undefined;
    let assigneeIds: string[] | undefined;
    if (Array.isArray(body.assigneeBotNames) && body.assigneeBotNames.length > 0) {
      if (!body.assigneeBotNames.every((n) => typeof n === 'string' && n.length > 0)) {
        res.status(400).json({ error: 'assigneeBotNames must be an array of non-empty strings' });
        return;
      }
      assigneeType = 'bot';
      assigneeIds = body.assigneeBotNames as string[];
    } else if (typeof body.squadId === 'string' && body.squadId.length > 0) {
      assigneeType = 'squad';
      assigneeIds = [body.squadId];
    } else if (body.assigneeType === 'bot' || body.assigneeType === 'squad') {
      if (!Array.isArray(body.assigneeIds) || body.assigneeIds.length === 0 ||
          !body.assigneeIds.every((n) => typeof n === 'string' && n.length > 0)) {
        res.status(400).json({ error: 'assigneeIds must be a non-empty array of strings' });
        return;
      }
      assigneeType = body.assigneeType;
      assigneeIds = body.assigneeIds as string[];
    } else {
      res.status(400).json({
        error: 'either assigneeBotNames: string[] OR squadId: string OR (assigneeType + assigneeIds) is required',
      });
      return;
    }

    // ── Optional fields with shape checks ──
    if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 2000)) {
      res.status(400).json({ error: 'description must be a string ≤2000 chars' });
      return;
    }
    const allowedPriorities = new Set(['low', 'normal', 'high', 'urgent']);
    if (body.priority !== undefined && (typeof body.priority !== 'string' || !allowedPriorities.has(body.priority))) {
      res.status(400).json({ error: 'priority must be one of: low, normal, high, urgent' });
      return;
    }
    const allowedSources = new Set(['dashboard', 'map', 'role', 'routine', 'commander']);
    if (body.source !== undefined && (typeof body.source !== 'string' || !allowedSources.has(body.source))) {
      res.status(400).json({ error: 'source must be one of: dashboard, map, role, routine, commander' });
      return;
    }
    if (body.steps !== undefined && !Array.isArray(body.steps)) {
      res.status(400).json({ error: 'steps must be an array' });
      return;
    }
    if (body.linkedCommandIds !== undefined && (!Array.isArray(body.linkedCommandIds) ||
        !body.linkedCommandIds.every((s) => typeof s === 'string'))) {
      res.status(400).json({ error: 'linkedCommandIds must be an array of strings' });
      return;
    }

    const params: any = {
      type: body.type,
      title: body.title,
      assigneeType,
      assigneeIds,
      description: body.description,
      priority: body.priority,
      source: body.source,
      steps: body.steps,
      linkedCommandIds: body.linkedCommandIds,
    };

    try {
      res.status(201).json({ mission: missionManager.createMission(params) });
    } catch (e: any) {
      res.status(400).json({ error: sanitizeErrorMessage(e, 'Failed to create mission') });
    }
  }));
  app.get('/api/missions/:id', (req, res) => {
    const m = missionManager.getMission(req.params.id as string);
    if (!m) return res.status(404).json({ error: 'Mission not found' });
    res.json({ mission: m });
  });
  app.post('/api/missions/:id/:action', async (req, res) => {
    const id = req.params.id as string;
    const action = req.params.action as string;
    try {
      let result: any;
      switch (action) {
        case 'start': result = await missionManager.startMission(id); break;
        case 'pause': result = missionManager.pauseMission(id); break;
        case 'resume': result = missionManager.resumeMission(id); break;
        case 'cancel': result = missionManager.cancelMission(id); break;
        case 'retry': result = missionManager.retryMission(id); break;
        default: return res.status(400).json({ error: `Unknown action: ${action}` });
      }
      if (!result) return res.status(404).json({ error: 'Mission not found' });
      res.json({ mission: result });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.patch('/api/bots/:name/mission-queue', (req, res) => {
    const { action, missionId, position } = req.body;
    const r = missionManager.updateBotMissionQueue(req.params.name as string, action, missionId, position);
    res.json({ queue: r });
  });
  app.delete('/api/bots/:name/mission-queue', (req, res) => {
    const r = missionManager.updateBotMissionQueue(req.params.name as string, 'clear');
    res.json({ queue: r });
  });

  // ── Commands ──
  // Flatten the structured command.error into a string for client safety —
  // the dashboard renders cmd.error directly as a React child.
  const flattenCmd = (c: any) => c && ({
    ...c,
    error: c.error
      ? `${c.error.code ?? 'error'}: ${c.error.message ?? ''}`
      : undefined,
  });
  app.get('/api/commands', (req, res) => {
    const filters = req.query.status ? { status: String(req.query.status) as any } : undefined;
    res.json({ commands: commandCenter.getCommands(filters).map(flattenCmd) });
  });
  app.post('/api/commands', async (req, res) => {
    try {
      const cmd = commandCenter.createCommand(req.body);
      await commandCenter.dispatchCommand(cmd, req.body.force === true);
      res.status(201).json({ command: flattenCmd(cmd) });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.get('/api/commands/:id', (req, res) => {
    const c = commandCenter.getCommand(req.params.id as string);
    if (!c) return res.status(404).json({ error: 'Command not found' });
    res.json({ command: flattenCmd(c) });
  });
  app.post('/api/commands/:id/cancel', (req, res) => {
    const { reason } = req.body ?? {};
    const c = commandCenter.cancelCommand(req.params.id as string, reason);
    if (!c) return res.status(404).json({ error: 'Command not found' });
    res.json({ command: flattenCmd(c) });
  });

  // ── Bot control shortcuts (dispatched through CommandCenter) ──
  const botControlAction = async (botName: string, type: string, params: any = {}) => {
    const cmd = commandCenter.createCommand({
      type: type as any,
      scope: 'single',
      priority: 'normal',
      source: 'api',
      targets: [botName],
      params,
    } as any);
    await commandCenter.dispatchCommand(cmd);
    return cmd;
  };
  const makeBotActionRoute = (routePath: string, type: string) => {
    app.post(routePath, async (req, res) => {
      try {
        const cmd = await botControlAction(req.params.name as string, type, req.body ?? {});
        res.json({ success: true, command: flattenCmd(cmd) });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });
  };
  makeBotActionRoute('/api/bots/:name/pause', 'pause_voyager');
  makeBotActionRoute('/api/bots/:name/resume', 'resume_voyager');
  makeBotActionRoute('/api/bots/:name/stop', 'stop_movement');
  makeBotActionRoute('/api/bots/:name/follow', 'follow_player');
  makeBotActionRoute('/api/bots/:name/walkto', 'walk_to_coords');
  makeBotActionRoute('/api/bots/:name/return-to-base', 'return_to_base');
  makeBotActionRoute('/api/bots/:name/unstuck', 'unstuck');
  makeBotActionRoute('/api/bots/:name/equip-best', 'equip_best');

  // ── Routines ──
  app.get('/api/routines', (_req, res) => res.json({ routines: routineManager.list() }));
  app.post('/api/routines', (req, res) => {
    try { res.status(201).json({ routine: routineManager.create(req.body) }); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch('/api/routines/:id', (req, res) => {
    const r = routineManager.update(req.params.id as string, req.body);
    if (!r) return res.status(404).json({ error: 'Routine not found' });
    res.json({ routine: r });
  });
  app.delete('/api/routines/:id', (req, res) => {
    const ok = routineManager.delete(req.params.id as string);
    res.status(ok ? 200 : 404).json({ success: ok });
  });
  app.post('/api/routines/:id/execute', async (req, res) => {
    try {
      const { botNames } = req.body ?? {};
      const execution = await routineManager.execute(req.params.id as string, botNames ?? []);
      res.json({ execution });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/routines/recording', (_req, res) => {
    res.json({
      isRecording: routineManager.isRecording(),
      draft: routineManager.getRecordingDraft(),
    });
  });
  app.post('/api/routines/recording/start', (req, res) => {
    try {
      const { name, startedBy } = req.body ?? {};
      if (!name) return res.status(400).json({ error: 'name required' });
      res.status(201).json({ draft: routineManager.startRecording(name, startedBy) });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/routines/recording/stop', (req, res) => {
    const { save } = req.body ?? {};
    const saved = routineManager.stopRecording(save === true);
    res.json({ routine: saved });
  });

  // ── Templates ──
  app.get('/api/templates', (_req, res) => res.json({ templates: templateManager.getAll() }));
  app.get('/api/templates/:id', (req, res) => {
    const t = templateManager.getById(req.params.id as string);
    if (!t) return res.status(404).json({ error: 'Template not found' });
    res.json({ template: t });
  });

  // ── Swarm directive ──
  app.post('/api/blackboard/swarm-directive', async (req, res) => {
    const { description, requestedBy } = req.body ?? {};
    if (!description) return res.status(400).json({ error: 'description required' });
    try {
      await botManager.handleSwarmDirective(description, requestedBy || 'dashboard');
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Diagnostics ──
  app.get('/api/bots/:name/diagnostics', (req, res) => {
    const handle = botManager.getWorker(req.params.name as string) as any;
    if (!handle) return res.status(404).json({ error: 'Bot not found' });
    res.json({ diagnostics: handle.getCachedDiagnostics?.() ?? null });
  });

  // ═══════════════════════════════════════════════════════════════
  //  Runtime config — read + edit hot-reloadable values
  //  Whitelist: behavior | affinity | instincts | voyager.
  //
  //  Hot-reload semantics:
  //    1. PATCH validates + shallow-merges values into the main-thread
  //       Config object in place. Subsystems holding that reference
  //       (AffinityManager, the API server's view, etc.) see the change
  //       on their next read.
  //    2. PATCH atomically persists the merged Config to config.yml.
  //    3. PATCH broadcasts the patch to every live worker via
  //       WorkerHandle.postConfigPatch. Each worker merges into its OWN
  //       captured Config so cross-thread subsystems (BotInstance,
  //       VoyagerLoop, InstinctsManager, CodeExecutor) read the new
  //       values on their next tick — no restart needed.
  //    4. Fields enumerated in RESTART_REQUIRED_FIELDS (currently
  //       voyager.codeExecutionTimeoutMs and the ambient-chat timers)
  //       are still persisted but reported back as `restartRequiredFields`
  //       because they're captured at construction / setInterval time.
  // ═══════════════════════════════════════════════════════════════
  const isPatchableSection = (name: string): name is PatchableSection =>
    (PATCHABLE_SECTIONS as readonly string[]).includes(name);

  app.get('/api/config', (_req: Request, res: Response) => {
    if (!config) return res.status(503).json({ error: 'Config not wired into API server' });
    const sections: Record<string, unknown> = {};
    for (const name of PATCHABLE_SECTIONS) {
      sections[name] = getSection(config, name);
    }
    res.json({ sections });
  });

  app.get('/api/config/:section', (req: Request, res: Response) => {
    if (!config) return res.status(503).json({ error: 'Config not wired into API server' });
    const section = req.params.section as string;
    if (!isPatchableSection(section)) {
      return res.status(400).json({
        error: `Unknown or non-patchable section '${section}'. Allowed: ${PATCHABLE_SECTIONS.join(', ')}`,
      });
    }
    res.json({
      section,
      values: getSection(config, section),
      restartRequired: Array.from(RESTART_REQUIRED_FIELDS[section]),
    });
  });

  app.patch('/api/config/:section', (req: Request, res: Response) => {
    if (!config) return res.status(503).json({ error: 'Config not wired into API server' });
    const section = req.params.section as string;
    if (!isPatchableSection(section)) {
      return res.status(400).json({
        error: `Unknown or non-patchable section '${section}'. Allowed: ${PATCHABLE_SECTIONS.join(', ')}`,
      });
    }
    const body = req.body ?? {};
    const incoming = body.values;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return res.status(400).json({ error: 'body must be { values: { ... } }' });
    }

    const validated = validatePatch(section, incoming as Record<string, unknown>);
    if (!validated.ok) {
      return res.status(400).json({
        error: 'Invalid patch values',
        details: validated.errors,
      });
    }

    const current = getSection(config, section) as Record<string, unknown>;
    // Shallow merge in place so any MAIN-THREAD subsystem holding a reference
    // (AffinityManager) sees new values on the next read.
    for (const [key, value] of Object.entries(validated.values)) {
      current[key] = value;
    }

    try {
      persistConfig(config);
    } catch (err: any) {
      logger.error({ err: err.message, section }, 'Failed to persist config.yml');
      return res.status(500).json({ error: `Failed to persist config.yml: ${err.message}` });
    }

    // Broadcast the patch to every live worker so cross-thread subsystems
    // (BotInstance / VoyagerLoop / InstinctsManager) hot-reload without a
    // restart. postConfigPatch is fire-and-forget and silently no-ops on
    // dead/disconnected workers.
    let workersNotified = 0;
    try {
      for (const handle of botManager.getAllWorkers()) {
        handle.postConfigPatch(section, validated.values);
        workersNotified++;
      }
    } catch (err: any) {
      // Defensive: don't fail the PATCH response just because broadcast hiccuped.
      logger.warn(
        { err: err?.message, section },
        'Config patch broadcast partially failed; some workers may be stale until restart',
      );
    }

    const restartRequiredFields = findRestartRequiredFields(section, validated.values);
    logger.info(
      { section, fields: Object.keys(validated.values), restartRequiredFields, workersNotified, droppedFields: validated.errors },
      'Runtime config patched',
    );
    res.json({
      section,
      values: current,
      restartRequiredFields,
      // Fields that the validator dropped or coerced — surface them to the UI.
      warnings: validated.errors,
    });
  });

  // ═══════════════════════════════════════════════════════════════
  //  LLM trace timeline — AgentOps-style waterfall for one bot
  // ═══════════════════════════════════════════════════════════════
  //
  // Returns the last N LLM calls for a single bot from the shared TokenLedger,
  // ordered by startMs ascending so the dashboard renders the waterfall
  // left-to-right. Each record's startMs is the timestamp the ledger recorded
  // (call completion time) minus its measured latencyMs.
  app.get('/api/bots/:name/llm-trace', (req: Request, res: Response) => {
    const name = String(req.params.name);
    if (!tokenLedger) {
      res.json({ trace: [] });
      return;
    }
    const limitRaw = Number.parseInt(String(req.query.limit ?? '50'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 50;
    const records = tokenLedger.getRecords({ botName: name, limit });
    const trace = records.map((r, idx) => {
      const endMs = r.timestamp;
      const startMs = endMs - (r.latencyMs ?? 0);
      return {
        id: `${name}-${endMs}-${idx}`,
        taskType: r.taskType,
        provider: r.provider,
        model: r.model,
        startMs,
        endMs,
        durationMs: r.latencyMs ?? 0,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        success: r.success,
      };
    });
    // getRecords returns oldest-first via slice(-limit); sort defensively in
    // case future changes reorder. Ascending startMs = left-to-right waterfall.
    trace.sort((a, b) => a.startMs - b.startMs);
    res.json({ trace });
  });

  // ═══════════════════════════════════════════════════════════════
  //  Town Builder (Phase 1) — founding flow, CRUD, residents, events
  // ═══════════════════════════════════════════════════════════════

  /**
   * Phase 6-A mayor-only auth helper.
   *
   * Followup #58 — the caller's identity is now sourced from the signed
   * `pid` session cookie (POST /api/auth/login) instead of the
   * honor-system body field `mayorPlayerName`. The legacy body-based
   * path is still accepted when the request includes `?legacyAuth=true`,
   * which exists purely to ease migration of any external scripts that
   * haven't been updated to call /api/auth/login first.
   *
   * Returns true when the caller is the mayor; otherwise sends a 403 with
   * a descriptive error and returns false. Routes should bail immediately
   * on a false return — the response has already been written.
   */
  function requireMayor(req: Request, res: Response, townId: string): boolean {
    const tm = botManager.getTownManager();
    const mayor = tm.getMayorService().getMayor(townId);
    if (!mayor) {
      res.status(403).json({ error: 'No mayor set for this town' });
      return false;
    }

    // Prefer the session cookie. When absent, optionally fall back to the
    // legacy body field (gated on the explicit migration flag).
    const sessionName = getSessionPlayerName(req);
    let claimed: string | null = sessionName;
    if (!claimed && isLegacyAuthRequested(req)) {
      const legacy = ((req.body ?? {}) as { mayorPlayerName?: unknown }).mayorPlayerName;
      if (typeof legacy === 'string' && legacy.length > 0) {
        claimed = legacy;
      }
    }

    if (!claimed) {
      res.status(401).json({ error: 'Not signed in — POST /api/auth/login first' });
      return false;
    }
    if (claimed.toLowerCase() !== mayor.playerName.toLowerCase()) {
      res.status(403).json({ error: 'Only the mayor can perform this action' });
      return false;
    }
    return true;
  }

  app.get('/api/towns', (_req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const towns = tm
      .listTowns()
      .map((t) => townToDTO(t, tm.listResidents(t.id), tm.isTownPaused(t.id)));
    res.json({ towns });
  });

  app.get('/api/towns/:id', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const town = tm.getTown(String(req.params.id));
    if (!town) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    res.json({
      town: townToDTO(town, tm.listResidents(town.id), tm.isTownPaused(town.id)),
    });
  });

  app.post('/api/towns', (req: Request, res: Response) => {
    const { name, capital, stylePreset, mayorTitle, mayorPlayerName } = req.body ?? {};
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (
      !capital ||
      typeof capital.x !== 'number' ||
      typeof capital.y !== 'number' ||
      typeof capital.z !== 'number'
    ) {
      res.status(400).json({ error: 'capital must be { x, y, z } (numbers)' });
      return;
    }
    if (stylePreset !== 'medieval-communal' && stylePreset !== 'mid-century-civic') {
      res.status(400).json({ error: 'stylePreset must be medieval-communal or mid-century-civic' });
      return;
    }
    try {
      const tm = botManager.getTownManager();
      const { town } = tm.createTown({
        name,
        capital,
        stylePreset,
        mayorTitle,
        mayorPlayerName,
      });
      // town_founded event is recorded inside createTown and fans out via
      // the unified TownManager.setEventEmitter hook — no manual io.emit.
      res.status(201).json({
        town: townToDTO(town, tm.listResidents(town.id), tm.isTownPaused(town.id)),
      });
    } catch (err: any) {
      logger.error({ err: err?.message }, 'createTown failed');
      res.status(500).json({ error: 'Failed to create town' });
    }
  });

  app.patch('/api/towns/:id', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const updated = tm.updateTown(String(req.params.id), req.body ?? {});
    if (!updated) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    // Surface the brain's paused state so the dashboard can render the
    // pause/resume toggle without an extra round-trip.
    res.json({
      town: townToDTO(updated, tm.listResidents(updated.id), tm.isTownPaused(updated.id)),
    });
  });

  // Phase 2: pause / resume the Town Brain. Existing builds + tasks continue;
  // these only freeze the brain's decision-making (demand/build/role/threat
  // loops no-op while paused).
  app.post('/api/towns/:id/pause', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const id = String(req.params.id);
    if (!tm.getTown(id)) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    tm.pauseTown(id);
    res.json({ paused: true });
  });

  app.post('/api/towns/:id/resume', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const id = String(req.params.id);
    if (!tm.getTown(id)) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    tm.resumeTown(id);
    res.json({ paused: false });
  });

  // Followup #38 — surface the brain's lifecycle status so the dashboard
  // can render a "last tick Xs ago / N ticks / paused" widget without
  // having to wire a Socket.IO event for it.
  app.get('/api/towns/:id/brain', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const id = String(req.params.id);
    if (!tm.getTown(id)) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    const status = tm.getBrainStatus(id);
    if (!status) {
      // Town exists but no brain wired (rare: dormant town or boot race).
      res.json({
        brain: {
          townId: id,
          running: false,
          paused: false,
          lastTickAt: null,
          ticks: 0,
        },
      });
      return;
    }
    res.json({ brain: status });
  });

  app.delete('/api/towns/:id', (req: Request, res: Response) => {
    const ok = botManager.getTownManager().abandonTown(String(req.params.id));
    if (!ok) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    res.json({ ok: true });
  });

  app.get('/api/towns/:id/buildings', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    if (!tm.getTown(String(req.params.id))) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    res.json({ buildings: tm.listBuildings(String(req.params.id)) });
  });

  // Phase 4 — list cached LLM-designed plans for a town.
  app.get('/api/towns/:id/designs', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const townId = String(req.params.id);
    if (!tm.getTown(townId)) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    try {
      // Lazy-require to keep dashboard endpoints lean for non-town routes.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { DesignCache } = require('../town/DesignCache');
      const cache = new DesignCache(schematicsDir);
      res.json({ designs: cache.list(townId) });
    } catch (err: any) {
      logger.warn({ err: err?.message, townId }, 'GET /api/towns/:id/designs failed');
      res.status(500).json({ error: 'Failed to list designs' });
    }
  });

  // Phase 4 — return the evolving style.json for a town.
  app.get('/api/towns/:id/style', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const townId = String(req.params.id);
    if (!tm.getTown(townId)) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    const style = tm.getStyleDoc(townId);
    if (!style) {
      res.status(404).json({ error: 'No style doc on disk for this town' });
      return;
    }
    res.json({ style });
  });

  app.get('/api/towns/:id/residents', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    if (!tm.getTown(String(req.params.id))) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    res.json({ residents: tm.listResidents(String(req.params.id)) });
  });

  app.get('/api/towns/:id/districts', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    if (!tm.getTown(String(req.params.id))) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    res.json({ districts: tm.listDistricts(String(req.params.id)) });
  });

  app.get('/api/towns/:id/events', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    if (!tm.getTown(String(req.params.id))) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    const limitRaw = Number.parseInt(String(req.query.limit ?? '100'), 10);
    const sinceRaw = req.query.since != null ? Number.parseInt(String(req.query.since), 10) : NaN;
    const events = tm.listEvents(String(req.params.id), {
      limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
      since: Number.isFinite(sinceRaw) ? sinceRaw : undefined,
    });
    res.json({ events });
  });

  // ─── Phase 8 — streaming feeds ────────────────────────────────────────
  //
  // The streamer pipeline consumes these endpoints to build the YouTube
  // highlights feed:
  //
  //  - /api/towns/:id/highlights  per-town, SQLite-backed (full history),
  //                               ordered by highlight_score DESC, occurredAt
  //                               DESC via the idx_events_town_highlight
  //                               index from Phase 1. Default limit 25.
  //  - /api/highlights            cross-town "best of all towns" feed,
  //                               in-memory ring (HighlightStream). Default
  //                               limit 50. Includes town name for the chip.
  //  - /api/streaming/health      rolling counters (events/min,
  //                               last-event-at, avg highlight score) and
  //                               the current Socket.IO connection count.

  app.get('/api/towns/:id/highlights', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    if (!tm.getTown(String(req.params.id))) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    const limitRaw = Number.parseInt(String(req.query.limit ?? '25'), 10);
    const sinceRaw = req.query.since != null ? Number.parseInt(String(req.query.since), 10) : NaN;
    const events = tm.listTownHighlights(String(req.params.id), {
      limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
      since: Number.isFinite(sinceRaw) ? sinceRaw : undefined,
    });
    res.json({ events });
  });

  app.get('/api/highlights', (req: Request, res: Response) => {
    const limitRaw = Number.parseInt(String(req.query.limit ?? '50'), 10);
    const sinceRaw = req.query.since != null ? Number.parseInt(String(req.query.since), 10) : NaN;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 50;
    const since = Number.isFinite(sinceRaw) ? sinceRaw : 0;
    const items = highlights.topAcrossTowns(limit, since);
    res.json({ highlights: items });
  });

  app.get('/api/streaming/health', (_req: Request, res: Response) => {
    const stats = highlights.getStats();
    const towns = botManager.getTownManager().listTowns().length;
    res.json({
      wsConnected: stats.wsConnected,
      towns,
      eventsPerMin: stats.eventsPerMin,
      lastEventAt: stats.lastEventAt,
      avgHighlightScore: stats.avgHighlightScore,
    });
  });

  // ─── Phase 4-B Chronicle ──────────────────────────────────────────────
  // Last N chronicle entries (newest-first). Defaults to 7 — the spec's
  // "last week of dailies" feed for the dashboard.
  app.get('/api/towns/:id/chronicle', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    if (!tm.getTown(String(req.params.id))) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    const limitRaw = Number.parseInt(String(req.query.limit ?? '7'), 10);
    const kindRaw = typeof req.query.kind === 'string' ? req.query.kind : undefined;
    const entries = tm.listChronicleEntries(String(req.params.id), {
      limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
      kind: kindRaw,
    });
    res.json({ entries });
  });

  // Manual trigger — generate (or force-regenerate) the chronicle entry for
  // a given day. Body: { dayNumber?: number; force?: boolean }. Used by the
  // dashboard's "Generate now" button.
  app.post('/api/towns/:id/chronicle/generate', async (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const townId = String(req.params.id);
    if (!tm.getTown(townId)) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    const body = (req.body ?? {}) as { dayNumber?: number; force?: boolean };
    const dayNumber =
      typeof body.dayNumber === 'number' && Number.isFinite(body.dayNumber)
        ? Math.max(1, Math.floor(body.dayNumber))
        : (tm.getChronicleDayNumber(townId) ?? 1);
    try {
      const entry = await chronicleGenerator.generateDaily(townId, dayNumber, {
        force: body.force === true,
      });
      if (!entry) {
        // generateDaily returns null only on budget-capped / missing-town; the
        // missing-town case is already 404'd above.
        res.status(202).json({ ok: false, reason: 'budget_capped', dayNumber });
        return;
      }
      io.emit('town:chronicle', { townId, dayNumber, entry, kind: entry.kind });
      res.json({ entry });
    } catch (err: any) {
      logger.warn({ err: err?.message, townId, dayNumber }, 'chronicle/generate failed');
      res.status(500).json({ error: err?.message ?? 'chronicle generation failed' });
    }
  });

  // Followup #59 — persisted mayor decree feed. MayorPanelCard's history
  // used to live in component-state only (refresh wiped it); this endpoint
  // surfaces decrees from the events table where kind='mayor:decree' so
  // the panel can survive reloads. Newest-first, capped at 50 by default
  // so a chatty mayor doesn't dump thousands of rows into one response.
  app.get('/api/towns/:id/decrees', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const townId = String(req.params.id);
    if (!tm.getTown(townId)) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    const limitRaw = Number.parseInt(String(req.query.limit ?? '50'), 10);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.floor(limitRaw), 500)
        : 50;
    // TownManager.listEvents doesn't support a kind filter, so pull a wider
    // window and filter in-process. Most towns won't accumulate enough
    // events to make this expensive; if it ever does, the right fix is a
    // dedicated index on (town_id, kind, occurred_at) on the events table.
    const SCAN_WINDOW = Math.max(500, limit * 20);
    const events = tm.listEvents(townId, { limit: SCAN_WINDOW });
    const decrees = events
      .filter((e) => e.kind === 'mayor:decree')
      .slice(0, limit)
      .map((e) => {
        // The mayor/decree route writes payload as { taskId, text, source }.
        // Be defensive — older rows may have a different shape.
        const p =
          e.payload && typeof e.payload === 'object'
            ? (e.payload as Record<string, unknown>)
            : {};
        return {
          id: e.id,
          townId: e.townId,
          occurredAt: e.occurredAt,
          taskId: typeof p.taskId === 'string' ? p.taskId : null,
          text: typeof p.text === 'string' ? p.text : null,
          source: typeof p.source === 'string' ? p.source : null,
        };
      });
    res.json({ decrees });
  });

  // ─── Project Sid P2-A — standing town rules ───────────────────────────
  //
  // GET /api/towns/:id/rules — active standing rules persisted by the
  // mayor/decree handler when `governance.enabled`. Returns [] when the flag
  // is off (no rules are ever written in that case) or the town has none.
  // Newest-first. The rule store is JSON-backed (data/town_rules.json), keyed
  // by townId — independent of the town SQLite schema.
  app.get('/api/towns/:id/rules', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const townId = String(req.params.id);
    if (!tm.getTown(townId)) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    const rules = botManager.getRuleStore().getActiveRules(townId);
    res.json({ rules });
  });

  // ─── Phase 5-A Disasters + Memorial Park ──────────────────────────────
  // GET /api/towns/:id/disasters?limit=N — list disaster rows newest-first.
  // Defaults to limit=50 so a long-running town doesn't dump the whole
  // history into one response.
  app.get('/api/towns/:id/disasters', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const townId = String(req.params.id);
    if (!tm.getTown(townId)) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    const limitRaw = Number.parseInt(String(req.query.limit ?? '50'), 10);
    const disasters = tm.listDisasters(townId, {
      limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
    });
    res.json({ disasters });
  });

  // GET /api/towns/:id/memorial — the markers within the Memorial Park
  // bounds for a town. The Memorial Park lives at capital + (+12/0/+12)
  // with an 8x8 monument grid (see MemorialPark.ts).
  app.get('/api/towns/:id/memorial', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const townId = String(req.params.id);
    if (!tm.getTown(townId)) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    const brain = tm.getTownBrain(townId);
    const phoenix = brain?.getPhoenixManager?.();
    if (!phoenix) {
      // Brain isn't wired yet — return an empty payload rather than 500 so
      // the dashboard renders a "no monuments yet" empty state.
      res.json({ bounds: null, markers: [] });
      return;
    }
    const park = phoenix.getMemorialPark();
    const bounds = park.getBounds(townId);
    const markers = park.getMonumentsForTown(townId);
    res.json({ bounds, markers });
  });

  // Per-bot journals (Phase 4-B scaffolding only — per-resident LLM call is
  // a follow-up). Query: ?botName=... &limit=N. Returns rows newest-first.
  app.get('/api/towns/:id/journals', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const townId = String(req.params.id);
    if (!tm.getTown(townId)) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    const botName = typeof req.query.botName === 'string' ? req.query.botName : undefined;
    const limitRaw = Number.parseInt(String(req.query.limit ?? '20'), 10);
    const journals = tm.listBotJournals(townId, {
      botName,
      limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
    });
    res.json({ journals });
  });

  app.post('/api/towns/:id/residents', (req: Request, res: Response) => {
    const { botName, role } = req.body ?? {};
    if (!botName || typeof botName !== 'string') {
      res.status(400).json({ error: 'botName is required' });
      return;
    }
    try {
      const resident = botManager.getTownManager().addResident(String(req.params.id), { botName, role });
      if (!resident) {
        res.status(404).json({ error: 'Town not found' });
        return;
      }
      res.status(201).json({ resident });
    } catch (err: any) {
      // Most likely a UNIQUE (town_id, bot_name) collision.
      logger.warn({ err: err?.message }, 'addResident failed');
      res.status(409).json({ error: err?.message ?? 'Failed to add resident' });
    }
  });

  // ─── Phase 3 roles + schedules ───────────────────────────────────────
  // GET /api/towns/:id/roles — role breakdown + per-resident role.
  app.get('/api/towns/:id/roles', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const townId = String(req.params.id);
    if (!tm.getTown(townId)) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    const brain = tm.getTownBrain(townId);
    const residents = tm
      .listResidents(townId)
      .filter((r) => r.status === 'alive' || r.status == null)
      .map((r) => ({ botName: r.botName, role: r.currentRole ?? 'idle' }));
    // Compute the breakdown either from the brain (preferred — includes
    // unknown-role residents mapped to 'idle') or by tallying here when
    // the brain isn't wired (tests, abandoned towns).
    let breakdown: Record<string, number>;
    if (brain) {
      breakdown = brain.getRoleManager().getRoleBreakdown(townId);
    } else {
      breakdown = {};
      for (const r of residents) breakdown[r.role] = (breakdown[r.role] ?? 0) + 1;
    }
    res.json({ breakdown, residents });
  });

  // POST /api/towns/:id/roles/:botName — manual role override.
  app.post('/api/towns/:id/roles/:botName', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const townId = String(req.params.id);
    const botName = String(req.params.botName);
    if (!tm.getTown(townId)) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    const { role } = req.body ?? {};
    if (typeof role !== 'string' || role.length === 0) {
      res.status(400).json({ error: 'role is required' });
      return;
    }
    // Validate role at the API edge so the no-brain fallback path cannot
    // persist an unknown role string.
    if (!(TOWN_ROLES as readonly string[]).includes(role)) {
      res.status(400).json({
        error: `role must be one of: ${TOWN_ROLES.join(', ')}`,
      });
      return;
    }
    const brain = tm.getTownBrain(townId);
    const ok = brain
      ? brain.getRoleManager().setResidentRole(townId, botName, role as TownRole)
      : tm.setResidentRole(townId, botName, role);
    if (!ok) {
      res.status(400).json({ error: 'Unknown bot or invalid role' });
      return;
    }
    // Manual overrides get a `role:assigned` event so the events feed shows
    // the change next to its reason.
    tm.recordEvent({
      townId,
      kind: 'role:assigned',
      severity: 'info',
      payload: { botName, toRole: role, reason: 'manual' },
      highlightScore: 20,
    });
    res.json({ ok: true, botName, role });
  });

  // GET /api/towns/:id/schedules — day/night task table + current phase.
  app.get('/api/towns/:id/schedules', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const townId = String(req.params.id);
    if (!tm.getTown(townId)) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    const brain = tm.getTownBrain(townId);
    // Schedule table is static — the brain isn't strictly required. Use the
    // brain's manager when wired so future per-town overrides are honored,
    // otherwise stand up a transient one with the same data.
    const scheduleManager = brain
      ? brain.getScheduleManager()
      : new ScheduleManager(tm, botManager.getBlackboardManager());
    // Best-effort: read time-of-day off any worker's cached detailed status.
    let phase: 'day' | 'night' = 'day';
    let ticks: number | null = null;
    for (const worker of botManager.getAllWorkers()) {
      const detailed = worker.getCachedDetailedStatus?.();
      if (typeof detailed?.world?.timeOfDayTicks === 'number') {
        ticks = detailed.world.timeOfDayTicks;
        break;
      }
    }
    phase = scheduleManager.phaseFor(ticks);
    res.json({
      phase,
      worldTimeTicks: ticks,
      roleSchedules: scheduleManager.getScheduleTable(),
    });
  });

  // ─── Phase 5-B districts + child towns (self-expansion) ───────────────
  //
  // GET /districts already exists above (returns the raw rows). The POST
  // here is the admin-override seam — drops a new district immediately
  // without waiting for a tier-up. Used by the dashboard to test the
  // medieval→mid-century arc on demand and to stamp custom districts.
  app.post('/api/towns/:id/districts', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const townId = String(req.params.id);
    if (!tm.getTown(townId)) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    const { name, stylePreset, center } = (req.body ?? {}) as {
      name?: string;
      stylePreset?: 'medieval-communal' | 'mid-century-civic';
      center?: { x: number; y: number; z: number };
    };
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (stylePreset !== 'medieval-communal' && stylePreset !== 'mid-century-civic') {
      res.status(400).json({ error: 'stylePreset must be medieval-communal or mid-century-civic' });
      return;
    }
    const brain = tm.getTownBrain(townId);
    if (!brain) {
      res.status(409).json({ error: 'Town brain not wired — try again once the town is active' });
      return;
    }
    const result = brain.getDistrictManager().addDistrict(townId, {
      name,
      stylePreset,
      center,
    });
    if (!result) {
      res.status(500).json({ error: 'Failed to add district' });
      return;
    }
    res.status(result.created ? 201 : 200).json({
      district: result.district,
      created: result.created,
    });
  });

  // GET children — every town whose `parentTownId` is `:id`. Used by the
  // dashboard's ChildTownsCard. We hand back the bare `Town` rows plus the
  // distance from the parent capital so the UI doesn't have to recompute.
  app.get('/api/towns/:id/children', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const parent = tm.getTown(String(req.params.id));
    if (!parent) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    const children = tm.getChildTowns(parent.id).map((child) => {
      const residents = tm.listResidents(child.id);
      const dto = townToDTO(child, residents, tm.isTownPaused(child.id));
      let distance: number | null = null;
      if (parent.capital && child.capital) {
        const dx = child.capital.x - parent.capital.x;
        const dz = child.capital.z - parent.capital.z;
        distance = Math.round(Math.sqrt(dx * dx + dz * dz));
      }
      return { ...dto, distanceFromParent: distance };
    });
    res.json({ children });
  });

  // POST /expand — manual expansion trigger. Builds a proposal off the
  // current parent town and (when auto-approved) immediately founds the
  // child town. Returns the proposal + execution result so the dashboard
  // can surface "Founded <name> 256 blocks <direction>."
  //
  // Phase 6-A — gated behind requireMayor: body must include
  // `mayorPlayerName` matching the town's config.mayor.playerName.
  app.post('/api/towns/:id/expand', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const parent = tm.getTown(String(req.params.id));
    if (!parent) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    if (!requireMayor(req, res, parent.id)) return;
    const brain = tm.getTownBrain(parent.id);
    if (!brain) {
      res.status(409).json({ error: 'Town brain not wired — try again once the town is active' });
      return;
    }
    const expansionManager = brain.getExpansionManager();
    const proposal = expansionManager.proposeExpansion(parent);
    if (!proposal) {
      res.status(409).json({
        error:
          'Expansion not eligible (tier < town, population under target, daily cap reached, or pending approval)',
        status: expansionManager.getStatus(),
      });
      return;
    }
    if (!proposal.autoApprove) {
      // Pending approval — Phase 6. Surface the proposal so the UI can
      // render an "awaiting approval" banner.
      res.status(202).json({ proposal, executed: false, reason: 'pending_approval' });
      return;
    }
    const result = expansionManager.executeProposal(proposal);
    if (!result.ok || !result.childTown) {
      res.status(500).json({ error: result.reason ?? 'Failed to execute expansion' });
      return;
    }
    // expansion:founded is recorded inside ExpansionManager.executeProposal
    // and fans out via the unified TownManager.setEventEmitter hook.
    res.status(201).json({
      proposal,
      executed: true,
      childTown: townToDTO(
        result.childTown,
        tm.listResidents(result.childTown.id),
        tm.isTownPaused(result.childTown.id),
      ),
    });
  });

  // ───────────────────────────────────────────────────────────────────
  //  Phase 7-B — allied-town trade routes
  //
  //  GET /api/towns/:id/trade-routes — list the in-flight allied-town
  //  trade routes originating from this town. Backed by the brain's
  //  TradeRouteManager (in-memory; restart resets). Returns an empty
  //  list when the brain isn't wired or no routes are open.
  // ───────────────────────────────────────────────────────────────────

  app.get('/api/towns/:id/trade-routes', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const id = String(req.params.id);
    const town = tm.getTown(id);
    if (!town) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    const brain = tm.getTownBrain(id);
    if (!brain) {
      res.json({ routes: [] });
      return;
    }
    try {
      const trader = brain.getTradeRouteManager();
      res.json({ routes: trader.getOpenRoutes(id) });
    } catch (err: any) {
      logger.warn(
        { err: err?.message, townId: id },
        'GET /api/towns/:id/trade-routes failed',
      );
      res.json({ routes: [] });
    }
  });

  // ───────────────────────────────────────────────────────────────────
  //  Phase 7-A — inter-town relationships (directed graph)
  //
  //  GET  /api/towns/:id/relationships
  //       — outgoing edges from this town with state + trust + recent
  //         events. Used by the dashboard's diplomacy view.
  //  POST /api/towns/:id/relationships/:peerTownId
  //       body: { state: 'allied'|'rival'|'neutral', mayorPlayerName, reason? }
  //       — admin override. Mayor-gated via requireMayor. Bypasses the
  //         sustain window and commits immediately.
  //  GET  /api/town-relationships
  //       — full directed graph for the network view (P7-B consumer).
  //       NOTE: renamed from /api/relationships to avoid clashing with
  //       the existing bot-affinity route at line ~886.
  // ───────────────────────────────────────────────────────────────────

  app.get('/api/towns/:id/relationships', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const id = String(req.params.id);
    const town = tm.getTown(id);
    if (!town) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    try {
      const diplomacy = tm.getDiplomacyManager();
      // Project (townIdA, townIdB) edges into the dashboard DTO so the UI
      // doesn't have to know which side is the source. peerTownName is
      // resolved at projection time so a renamed town shows up correctly.
      const projected = diplomacy.listOutgoing(id).map((edge) => {
        const peerTownId = edge.townIdA === id ? edge.townIdB : edge.townIdA;
        const peer = tm.getTown(peerTownId);
        return {
          peerTownId,
          peerTownName: peer?.name ?? null,
          state: edge.state,
          trust: edge.trust,
          lastInteractionAt: edge.lastInteractionAt,
          events: edge.events ?? [],
        };
      });
      res.json({ relationships: projected });
    } catch (err: any) {
      logger.warn(
        { err: err?.message, townId: id },
        'GET /api/towns/:id/relationships failed',
      );
      res.json({ relationships: [] });
    }
  });

  app.post('/api/towns/:id/relationships/:peerTownId', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const id = String(req.params.id);
    const peerId = String(req.params.peerTownId);
    const town = tm.getTown(id);
    if (!town) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    if (id === peerId) {
      res.status(400).json({ error: 'A town cannot have a relationship with itself' });
      return;
    }
    const peer = tm.getTown(peerId);
    if (!peer) {
      res.status(404).json({ error: 'Peer town not found' });
      return;
    }
    if (!requireMayor(req, res, id)) return;
    const body = (req.body ?? {}) as {
      state?: unknown;
      reason?: unknown;
      oneWay?: unknown;
    };
    const state = body.state;
    if (state !== 'allied' && state !== 'rival' && state !== 'neutral') {
      res
        .status(400)
        .json({ error: 'state must be "allied", "rival", or "neutral"' });
      return;
    }
    const reason = typeof body.reason === 'string' ? body.reason : undefined;
    // Followup #62 — admin overrides via the mayor-gated route mirror to
    // the peer side by default so an explicit mayor move (`A → B = allied`)
    // is symmetric across the directed graph. Auto-transitions in the
    // diplomacy loop remain directional. Advanced callers can opt out by
    // setting `oneWay: true` in the request body.
    const oneWay = body.oneWay === true;
    try {
      const diplomacy = tm.getDiplomacyManager();
      const updated = diplomacy.setRelationship(id, peerId, state, { reason });
      if (!updated) {
        res.status(500).json({ error: 'Failed to update relationship' });
        return;
      }
      // diplomacy:state_changed is recorded inside DiplomacyManager.setRelationship
      // and fans out via the unified TownManager.setEventEmitter hook.

      // Followup #62 — try the peer-side mirror write. Wrapped in try/catch
      // so a failure on the mirror doesn't roll back the primary A→B edge:
      // the admin still gets the original change recorded and a warning in
      // the response payload (HTTP 207) so the dashboard can surface the
      // resulting asymmetry.
      let mirror: ReturnType<typeof diplomacy.setRelationship> | null = null;
      let mirrorWarning: string | null = null;
      if (!oneWay) {
        try {
          mirror = diplomacy.setRelationship(peerId, id, state, {
            reason: reason ? `mirror: ${reason}` : 'admin mirror',
          });
          if (!mirror) {
            mirrorWarning = 'peer-side mirror write returned null (edge not updated)';
            logger.warn(
              { townId: id, peerId, state },
              'Followup #62: peer-side mirror returned null; primary edge committed',
            );
          }
        } catch (mirrorErr: any) {
          mirrorWarning = `peer-side mirror failed: ${mirrorErr?.message ?? mirrorErr}`;
          logger.warn(
            { err: mirrorErr?.message, townId: id, peerId, state },
            'Followup #62: peer-side mirror threw; primary edge committed',
          );
        }
      }

      // 207 Multi-Status when the mirror failed but the primary succeeded;
      // plain 200 with mirror=null when the caller opted out, or with the
      // mirror edge when the mirror succeeded.
      if (mirrorWarning) {
        res.status(207).json({
          relationship: updated,
          mirror: null,
          warning: mirrorWarning,
        });
        return;
      }
      res.json({
        relationship: updated,
        mirror: oneWay ? null : mirror,
        oneWay,
      });
    } catch (err: any) {
      logger.warn(
        { err: err?.message, townId: id, peerId },
        'POST /api/towns/:id/relationships/:peerTownId failed',
      );
      res.status(500).json({ error: 'Failed to set relationship' });
    }
  });

  app.get('/api/town-relationships', (_req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    try {
      const diplomacy = tm.getDiplomacyManager();
      res.json({ relationships: diplomacy.listAll() });
    } catch (err: any) {
      logger.warn({ err: err?.message }, 'GET /api/town-relationships failed');
      res.json({ relationships: [] });
    }
  });

  // ───────────────────────────────────────────────────────────────────
  //  Phase 6-B — approvals queue (mayor-direct + resident vote)
  //
  //  - GET    /api/towns/:id/approvals?status=open|all  — list rows.
  //  - POST   /api/towns/:id/approvals/:approvalId/vote — cast a single
  //           bot's vote (body: { voterBotName, choice: 'yes'|'no' }).
  //  - POST   /api/towns/:id/approvals/:approvalId/decide — mayor-direct
  //           decide (body: { mayorPlayerName, choice: 'approved'|'denied' }).
  //
  //  All three reach the brain's ApprovalManager via TownBrain.getApprovalManager().
  // ───────────────────────────────────────────────────────────────────

  app.get('/api/towns/:id/approvals', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const id = String(req.params.id);
    const town = tm.getTown(id);
    if (!town) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    const statusFilter = String(req.query.status ?? 'open');
    const status =
      statusFilter === 'all' || statusFilter === 'open' || statusFilter === 'approved' ||
      statusFilter === 'denied' || statusFilter === 'expired'
        ? statusFilter
        : 'open';
    const approvals = tm.listApprovals(id, { status: status as 'all' | 'open' | 'approved' | 'denied' | 'expired' });
    const cfg = (town.config ?? {}) as { approvalMode?: 'mayor' | 'vote' };
    res.json({
      approvals,
      mode: cfg.approvalMode === 'vote' ? 'vote' : 'mayor',
    });
  });

  app.post('/api/towns/:id/approvals/:approvalId/vote', async (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const id = String(req.params.id);
    const approvalId = String(req.params.approvalId);
    const town = tm.getTown(id);
    if (!town) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    const brain = tm.getTownBrain(id);
    if (!brain) {
      res.status(409).json({ error: 'Town brain not wired yet' });
      return;
    }
    const { voterBotName, choice } = (req.body ?? {}) as {
      voterBotName?: string;
      choice?: string;
    };
    if (!voterBotName || typeof voterBotName !== 'string') {
      res.status(400).json({ error: 'voterBotName is required' });
      return;
    }
    if (choice !== 'yes' && choice !== 'no') {
      res.status(400).json({ error: 'choice must be "yes" or "no"' });
      return;
    }
    const approvalManager = brain.getApprovalManager();
    const approval = approvalManager.getApproval(approvalId);
    if (!approval || approval.townId !== id) {
      res.status(404).json({ error: 'Approval not found for this town' });
      return;
    }
    const ok = approvalManager.castVote(approvalId, voterBotName, choice);
    if (!ok) {
      res.status(409).json({ error: 'Approval is not open or vote could not be recorded' });
      return;
    }
    res.json({ approval: approvalManager.getApproval(approvalId) });
  });

  // Phase 8-followup #55 — mayor-gated by default. Body must include
  // `mayorPlayerName` matching the town's mayor. Admin override: pass
  // `?admin=true` on the query string to bypass the mayor check (intended
  // for break-glass / ops scripts). Without admin=true and without a valid
  // mayor signature, the request 403s through requireMayor.
  app.post('/api/towns/:id/approvals/:approvalId/decide', async (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const id = String(req.params.id);
    const approvalId = String(req.params.approvalId);
    const town = tm.getTown(id);
    if (!town) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    const brain = tm.getTownBrain(id);
    if (!brain) {
      res.status(409).json({ error: 'Town brain not wired yet' });
      return;
    }
    const adminOverride = String(req.query.admin ?? '').toLowerCase() === 'true';
    if (!adminOverride && !requireMayor(req, res, id)) return;
    const { choice } = (req.body ?? {}) as { choice?: string };
    if (choice !== 'approved' && choice !== 'denied') {
      res.status(400).json({ error: 'choice must be "approved" or "denied"' });
      return;
    }
    const approvalManager = brain.getApprovalManager();
    const approval = approvalManager.getApproval(approvalId);
    if (!approval || approval.townId !== id) {
      res.status(404).json({ error: 'Approval not found for this town' });
      return;
    }
    try {
      const updated = await approvalManager.mayorDecide(approvalId, choice);
      // approval:approved/denied is recorded inside ApprovalManager.mayorDecide
      // and fans out via the unified TownManager.setEventEmitter hook.
      res.json({ approval: updated });
    } catch (err: any) {
      logger.warn(
        { err: err?.message, approvalId, townId: id, adminOverride },
        'POST /approvals/:id/decide failed',
      );
      res.status(500).json({ error: err?.message ?? 'mayorDecide failed' });
    }
  });

  // Phase 8-followup #56 — flip a town's `approvalMode` between 'mayor' and
  // 'vote'. Mayor-gated via requireMayor. Body: { mode, mayorPlayerName }.
  // Returns the updated town DTO so the dashboard can refresh without an
  // extra GET. Records `approval:mode_changed` when the mode actually flips.
  app.post('/api/towns/:id/approval-mode', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const id = String(req.params.id);
    const town = tm.getTown(id);
    if (!town) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    if (!requireMayor(req, res, id)) return;
    const { mode } = (req.body ?? {}) as { mode?: string };
    if (mode !== 'mayor' && mode !== 'vote') {
      res.status(400).json({ error: 'mode must be "mayor" or "vote"' });
      return;
    }
    try {
      const currentConfig = (town.config ?? {}) as Record<string, unknown>;
      const previousMode =
        (currentConfig as { approvalMode?: string }).approvalMode === 'vote' ? 'vote' : 'mayor';
      const nextConfig = { ...currentConfig, approvalMode: mode };
      const updated = tm.updateTown(id, { config: nextConfig });
      if (!updated) {
        res.status(500).json({ error: 'Failed to update town config' });
        return;
      }
      if (previousMode !== mode) {
        tm.recordEvent({
          townId: id,
          kind: 'approval:mode_changed',
          severity: 'minor',
          payload: { mode, previousMode },
          highlightScore: 30,
        });
      }
      res.json({
        town: townToDTO(updated, tm.listResidents(updated.id), tm.isTownPaused(updated.id)),
      });
    } catch (err: any) {
      logger.warn(
        { err: err?.message, townId: id, mode },
        'POST /approval-mode failed',
      );
      res.status(500).json({ error: err?.message ?? 'approval-mode failed' });
    }
  });

  // ─── Phase 6-A Mayor decree ───────────────────────────────────────────
  //
  // POST /api/towns/:id/mayor/decree — the mayor types a free-form directive
  // and it gets dropped on the blackboard as a high-priority swarm task with
  // source 'mayor_directive'. Body: { mayorPlayerName: string, text: string }.
  // Returns the queued BlackboardTask so the dashboard can surface it.
  app.post('/api/towns/:id/mayor/decree', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const townId = String(req.params.id);
    const town = tm.getTown(townId);
    if (!town) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    if (!requireMayor(req, res, town.id)) return;
    const body = (req.body ?? {}) as { text?: unknown };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    // Hard cap so the blackboard description field stays readable; reject
    // pathologically large free-form input rather than silently truncating.
    if (text.length > 1000) {
      res.status(400).json({ error: 'text must be 1000 characters or fewer' });
      return;
    }
    try {
      const blackboard = botManager.getBlackboardManager();
      const description = `Mayor decree (town:${town.id}): ${text}`;
      const task = blackboard.addTask(
        { description, keywords: ['mayor', 'decree', 'town'] },
        'swarm',
        undefined,
        'high',
      );
      // Project Sid P2-A — when governance is enabled, ALSO persist a standing
      // rule so the decree keeps biasing resident task selection (not just the
      // one-shot task above). Flag-gated: when disabled, behavior is exactly
      // the legacy one-shot decree and no rule is written.
      let rule: TownRule | undefined;
      const governanceEnabled = config?.governance?.enabled === true;
      if (governanceEnabled) {
        rule = botManager.getRuleStore().addRule(town.id, text);
      }
      tm.recordEvent({
        townId: town.id,
        kind: 'mayor:decree',
        severity: 'major',
        payload: {
          taskId: task.id,
          text,
          source: 'mayor_directive',
          ...(rule ? { ruleId: rule.id } : {}),
        },
        highlightScore: 60,
      });
      // The recordEvent above fans out via the unified emitter; no manual emit.
      res.status(201).json({ task, ...(rule ? { rule } : {}) });
    } catch (err: any) {
      logger.warn({ err: err?.message, townId: town.id }, 'mayor/decree failed');
      res.status(500).json({ error: err?.message ?? 'Failed to queue decree' });
    }
  });

  // ─── Project Sid P2-C — Bot-initiated decrees ─────────────────────────
  //
  // POST /api/towns/:id/propose-rule — a bot (or a town-level trigger) PROPOSES
  // a standing rule through the existing approval/vote workflow rather than the
  // mayor minting it directly. Body: { text: string, proposedBy?: string }.
  // Unlike mayor/decree this is NOT mayor-gated: any bot may propose; the
  // residents vote (or the mayor decides) and ApprovalManager resolves the row.
  // On 'approved', DecreeManager writes the rule via the RuleStore.
  //
  // Flag-gated: when `governance.enabled` is off the brain never constructs a
  // DecreeManager (getDecreeManager() returns null) and this route 409s, so
  // the path is a complete no-op by default.
  app.post('/api/towns/:id/propose-rule', async (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const townId = String(req.params.id);
    const town = tm.getTown(townId);
    if (!town) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    if (config?.governance?.enabled !== true) {
      res.status(409).json({ error: 'governance is disabled' });
      return;
    }
    const brain = tm.getTownBrain(townId);
    if (!brain) {
      res.status(409).json({ error: 'Town brain not wired yet' });
      return;
    }
    const decreeManager = brain.getDecreeManager();
    if (!decreeManager) {
      res.status(409).json({ error: 'governance is disabled' });
      return;
    }
    const body = (req.body ?? {}) as { text?: unknown; proposedBy?: unknown };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    if (text.length > MAX_DECREE_TEXT_LENGTH) {
      res.status(400).json({ error: `text must be ${MAX_DECREE_TEXT_LENGTH} characters or fewer` });
      return;
    }
    const proposedBy = typeof body.proposedBy === 'string' ? body.proposedBy : undefined;
    try {
      const approvalId = await decreeManager.proposeDecree({ townId: town.id, text, proposedBy });
      if (!approvalId) {
        res.status(500).json({ error: 'Failed to open decree approval' });
        return;
      }
      res.status(201).json({ approvalId, townId: town.id, text, proposedBy });
    } catch (err: any) {
      logger.warn({ err: err?.message, townId: town.id }, 'propose-rule failed');
      res.status(500).json({ error: err?.message ?? 'Failed to propose rule' });
    }
  });

  // ── Tail error-handling middleware ──
  // Catches anything `asyncH` (and any other handler that calls `next(err)`)
  // forwards. Logs the full error server-side, returns a sanitized message
  // to the client. Without this, an un-caught rejection from an async route
  // would crash the worker / leak a stack trace through Express's default
  // handler. Express identifies error-handling middleware by its 4-arg
  // signature, so the unused `_next` is required.
  // Special case: a body that exceeds `express.json({ limit: '1mb' })`
  // throws a PayloadTooLargeError with `err.type === 'entity.too.large'` —
  // return 413 in that case so the client gets the right hint.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) {
      // Express will close the connection; just bail out of the handler.
      return;
    }
    const status = typeof err?.statusCode === 'number' ? err.statusCode
      : (typeof err?.status === 'number' ? err.status : 500);
    logger.error({ err: err?.message, stack: err?.stack }, 'API request failed');
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: 'Request body too large (limit 1mb)' });
      return;
    }
    res.status(status).json({ error: sanitizeErrorMessage(err, 'Internal server error') });
  });

  return {
    app, httpServer, io, eventLog,
    commanderService, commandCenter, missionManager, markerStore, squadManager, roleManager, templateManager, routineManager,
    buildCoordinator, campaignManager, schematicMatcher, chainCoordinator,
    chronicleGenerator, chronicleScheduler,
    highlightStream: highlights,
  };
}
