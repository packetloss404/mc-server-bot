/**
 * Town Builder endpoints (founding/CRUD/residents/buildings/designs/chronicle/
 * roles/schedules/expansion/trade-routes/diplomacy/approvals/decrees/rules) +
 * cross-town highlights/streaming, extracted from createAPIServer (review:
 * api.ts decomposition — the largest group). Includes the shared mayor-auth
 * helper requireMayor. Registered via registerTownRoutes(app, deps).
 */
import type { Express, Request, Response } from 'express';
import type { Server as SocketIOServer } from 'socket.io';
import type { BotManager } from '../../bot/BotManager';
import type { ChronicleGenerator } from '../../town/ChronicleGenerator';
import type { HighlightStream } from '../../town/HighlightStream';
import type { Config } from '../../config';
import type { TownRule } from '../../town/RuleStore';
import { townToDTO } from '../../town/TownManager';
import { ScheduleManager } from '../../town/ScheduleManager';
import { TOWN_ROLES, type TownRole } from '../../town/RoleManager';
import { MAX_DECREE_TEXT_LENGTH } from '../../town/DecreeManager';
import { getSessionPlayerName, isLegacyAuthRequested } from '../auth';
import { asyncH, sanitizeErrorMessage } from './helpers';
import { logger } from '../../util/logger';

export function registerTownRoutes(
  app: Express,
  deps: {
    botManager: BotManager;
    io: SocketIOServer;
    chronicleGenerator: ChronicleGenerator;
    highlights: HighlightStream;
    config?: Config;
    schematicsDir: string;
  },
): void {
  const { botManager, io, chronicleGenerator, highlights, config, schematicsDir } = deps;

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

  // Per-resource demand snapshot (on-hand vs tier threshold) — read-only view
  // of the demand loop's shortage math so the dashboard can show what the town
  // is short on without inferring it from the supply-task queue.
  app.get('/api/towns/:id/demand', (req: Request, res: Response) => {
    const tm = botManager.getTownManager();
    const id = String(req.params.id);
    if (!tm.getTown(id)) {
      res.status(404).json({ error: 'Town not found' });
      return;
    }
    const brain = tm.getTownBrain(id);
    res.json({ demand: brain ? brain.computeDemand() : [] });
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
      const { DesignCache } = require('../../town/DesignCache');
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
}
