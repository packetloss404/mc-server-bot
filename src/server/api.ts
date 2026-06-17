import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import { BotManager } from '../bot/BotManager';
import { Config } from '../config';
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
import { HighlightStream } from '../town/HighlightStream';
import type { TownEvent } from '../town/Town';
import { TOWN_ROLES, type TownRole } from '../town/RoleManager';
import { loadObservedRole, inferObservedRole, type BotActionStats } from '../town/ObservedRoleModel';
import { ChronicleGenerator } from '../town/ChronicleGenerator';
import { ChronicleScheduler } from '../town/ChronicleScheduler';
import { SquadManager } from '../control/SquadManager';
import { RoleManager } from '../control/RoleManager';
import { TemplateManager } from '../control/TemplateManager';
import { RoutineManager } from '../control/RoutineManager';
import { BuildCoordinator } from '../build/BuildCoordinator';
import { CampaignManager } from '../build/BuildCampaign';
import { SchematicMatcher } from '../build/SchematicMatcher';
import { ChainCoordinator } from '../supplychain/ChainCoordinator';
import { registerAdminRoutes } from './admin';
import { sanitizeErrorMessage } from './routes/helpers';
import { registerTerrainRoutes } from './routes/terrainRoutes';
import { registerSchematicRoutes } from './routes/schematicRoutes';
import { registerChainRoutes } from './routes/chainRoutes';
import { registerControlRoutes } from './routes/controlRoutes';
import { registerCommanderRoutes } from './routes/commanderRoutes';
import { registerCampaignRoutes } from './routes/campaignRoutes';
import { registerConfigRoutes } from './routes/configRoutes';
import { registerRoutineRoutes } from './routes/routineRoutes';
import { registerMissionCommandRoutes } from './routes/missionCommandRoutes';
import { registerSkillRoutes } from './routes/skillRoutes';
import { registerMetricsRoutes } from './routes/metricsRoutes';
import { registerBuildRoutes } from './routes/buildRoutes';
import { registerEventsRoutes } from './routes/eventsRoutes';
import { registerBotRoutes } from './routes/botsRoutes';
import { registerTownRoutes } from './routes/townRoutes';
// createGrantHandler moved to ./routes/grantHandler; re-exported for back-compat
// (auth.grant.test.ts imports it from this module).
export { createGrantHandler } from './routes/grantHandler';
export type { GrantWorkerHandle, GrantHandlerDeps } from './routes/grantHandler';
import { logger } from '../util/logger';
import {
  requireDashboardAuth,
  isDashboardAuthenticated,
  isDashboardAuthEnabled,
  requirePluginAuth,
  registerAuthRoutes,
  setAuthConfig,
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
  // ── Bots: core + reads + interaction (extracted → routes/botsRoutes.ts) ──
  registerBotRoutes(app, { botManager, io, eventLog, tokenLedger });
  // ── Java-plugin event relay (extracted → routes/eventsRoutes.ts) ──
  registerEventsRoutes(app, { botManager, io, schematicMatcher, buildCoordinator, markerStore });
  // ── Skill library (extracted → routes/skillRoutes.ts) ──
  registerSkillRoutes(app);

  // ═══════════════════════════════════════
  // ═══════════════════════════════════════
  //  LLM USAGE ENDPOINT (TokenLedger)
  // ═══════════════════════════════════════

  // LLM settings and usage are managed via index.ts injection
  // Placeholder — real endpoints registered by registerLLMSettingsRoutes() below

  //  METRICS ENDPOINT
  // ═══════════════════════════════════════

  // ── Metrics + civilization metrics (extracted → routes/metricsRoutes.ts) ──
  registerMetricsRoutes(app, { botManager, commanderService });

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
  // ── Build jobs + tunnel (extracted → routes/buildRoutes.ts) ──
  registerBuildRoutes(app, { buildCoordinator });

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

  // ── Missions + commands + bot shortcuts (extracted → routes/missionCommandRoutes.ts) ──
  registerMissionCommandRoutes(app, { missionManager, commandCenter });

  // ── Routines + templates (extracted → routes/routineRoutes.ts) ──
  registerRoutineRoutes(app, { routineManager, templateManager });

  // ── Runtime config (extracted → routes/configRoutes.ts) ──
  registerConfigRoutes(app, { config, botManager });

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
  // ── Town Builder + cross-town highlights (extracted → routes/townRoutes.ts) ──
  registerTownRoutes(app, { botManager, io, chronicleGenerator, highlights, config, schematicsDir });

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
