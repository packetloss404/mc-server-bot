/**
 * Aggregate + civilization metrics endpoints, extracted from createAPIServer
 * (review: api.ts decomposition). Read-only; aggregates live worker status and
 * persisted data/*.json. Registered via registerMetricsRoutes(app,
 * { botManager, commanderService }). Each route keeps its own 30s TTL cache.
 */
import fs from 'fs';
import path from 'path';
import type { Express, Request, Response } from 'express';
import type { BotManager } from '../../bot/BotManager';
import type { CommanderService } from '../../control/CommanderService';
import { inferObservedRole, type BotActionStats } from '../../town/ObservedRoleModel';
import { computeCivilizationMetrics } from '../../town/CivilizationMetrics';
import { logger } from '../../util/logger';

const METRICS_TTL_MS = 30_000;

export function registerMetricsRoutes(
  app: Express,
  deps: { botManager: BotManager; commanderService: CommanderService },
): void {
  const { botManager, commanderService } = deps;

  let metricsCache: { at: number; payload: any } | null = null;
  app.get('/api/metrics', (_req: Request, res: Response) => {
    try {
      if (metricsCache && Date.now() - metricsCache.at < METRICS_TTL_MS) {
        res.json(metricsCache.payload);
        return;
      }
      const workers = botManager.getAllWorkers();
      const statuses = botManager.getAllBotStatuses();

      const totalBots = workers.length;
      const aliveBots = workers.filter((w) => w.isAlive()).length;
      const idleBots = statuses.filter((s: any) => s.state === 'IDLE').length;
      const workingBots = statuses.filter((s: any) => s.state === 'EXECUTING_TASK').length;

      const stateBreakdown: Record<string, number> = {};
      for (const s of statuses) {
        const state = (s as any).state || 'UNKNOWN';
        stateBreakdown[state] = (stateBreakdown[state] || 0) + 1;
      }

      const personalityBreakdown: Record<string, number> = {};
      for (const s of statuses) {
        const p = (s as any).personality || 'unknown';
        personalityBreakdown[p] = (personalityBreakdown[p] || 0) + 1;
      }

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
          commandMetrics.successRate = commandMetrics.total > 0 ? Math.round((commandMetrics.succeeded / commandMetrics.total) * 100) : 0;
        }
      } catch { /* ignore */ }

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
          missionMetrics.completionRate = missionMetrics.total > 0 ? Math.round((missionMetrics.completed / missionMetrics.total) * 100) : 0;
          for (const m of missions) {
            const t = m.type || 'unknown';
            missionMetrics.byType[t] = (missionMetrics.byType[t] || 0) + 1;
          }
        }
      } catch { /* ignore */ }

      let commanderMetrics = { parseCount: 0, avgConfidence: 0, failureRate: 0 };
      try {
        const csMetrics = commanderService.getMetrics();
        commanderMetrics.parseCount = csMetrics.totalParses;
        commanderMetrics.avgConfidence = csMetrics.averageConfidence ? Math.round(csMetrics.averageConfidence * 100) : 0;
        commanderMetrics.failureRate = csMetrics.totalParses > 0 ? Math.round((csMetrics.failedParses / csMetrics.totalParses) * 100) : 0;
      } catch {
        try {
          const cmdPath = path.join(process.cwd(), 'data', 'commands.json');
          if (fs.existsSync(cmdPath)) {
            const cmdData = JSON.parse(fs.readFileSync(cmdPath, 'utf-8'));
            const commands = Array.isArray(cmdData) ? cmdData : (cmdData.commands || []);
            const parsed = commands.filter((c: any) => c.source === 'commander' || c.parsedPlan);
            commanderMetrics.parseCount = parsed.length;
            const confidences = parsed.map((c: any) => c.confidence ?? c.parsedPlan?.confidence).filter((c: any) => typeof c === 'number');
            commanderMetrics.avgConfidence = confidences.length > 0 ? Math.round(confidences.reduce((a: number, b: number) => a + b, 0) / confidences.length) : 0;
            const cmdFailed = parsed.filter((c: any) => c.status === 'failed').length;
            commanderMetrics.failureRate = parsed.length > 0 ? Math.round((cmdFailed / parsed.length) * 100) : 0;
          }
        } catch { /* ignore */ }
      }

      let fleetMetrics = { botsByRole: {} as Record<string, number>, overrideCount: 0, activeSquads: 0, totalSquads: 0 };
      try {
        const rolesPath = path.join(process.cwd(), 'data', 'roles.json');
        if (fs.existsSync(rolesPath)) {
          const rolesData = JSON.parse(fs.readFileSync(rolesPath, 'utf-8'));
          const assignments = Array.isArray(rolesData) ? rolesData : (rolesData.assignments || []);
          for (const a of assignments) {
            const role = a.role || 'unassigned';
            fleetMetrics.botsByRole[role] = (fleetMetrics.botsByRole[role] || 0) + 1;
          }
        }
      } catch { /* ignore */ }
      try {
        const squadsPath = path.join(process.cwd(), 'data', 'squads.json');
        if (fs.existsSync(squadsPath)) {
          const squadsData = JSON.parse(fs.readFileSync(squadsPath, 'utf-8'));
          const squads = Array.isArray(squadsData) ? squadsData : (squadsData.squads || []);
          fleetMetrics.totalSquads = squads.length;
          fleetMetrics.activeSquads = squads.filter((s: any) => (s.botNames || s.members || []).length > 0).length;
        }
      } catch { /* ignore */ }

      let skillCount = 0;
      try {
        const indexPath = path.join(process.cwd(), 'skills', 'index.json');
        if (fs.existsSync(indexPath)) {
          const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
          skillCount = Object.keys(index).length;
        }
      } catch { /* ignore */ }

      const healthStats: Array<{ name: string; health: number; food: number }> = [];
      for (const w of workers) {
        const detailed = w.getCachedDetailedStatus();
        if (detailed) {
          healthStats.push({ name: w.botName, health: detailed.health ?? 20, food: detailed.food ?? 20 });
        }
      }

      const payload = {
        timestamp: Date.now(),
        bots: { total: totalBots, alive: aliveBots, idle: idleBots, working: workingBots, stateBreakdown, personalityBreakdown, healthStats },
        tasks: { totalCompleted, totalFailed, totalQueued, activeTasks, successRate: taskSuccessRate, botTaskStats },
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
  let civMetricsCache: { at: number; payload: any } | null = null;
  app.get('/api/metrics/civilization', (_req: Request, res: Response) => {
    try {
      if (civMetricsCache && Date.now() - civMetricsCache.at < METRICS_TTL_MS) {
        res.json(civMetricsCache.payload);
        return;
      }
      const fleetNames = botManager.getAllWorkers().map((w) => w.botName);

      let allStats: Record<string, BotActionStats> = {};
      try {
        const statsPath = path.join(process.cwd(), 'data', 'stats.json');
        if (fs.existsSync(statsPath)) {
          allStats = JSON.parse(fs.readFileSync(statsPath, 'utf-8')) as Record<string, BotActionStats>;
        }
      } catch {
        allStats = {};
      }

      const statsByBot: Record<string, BotActionStats> = {};
      const observedRoles: string[] = [];
      for (const name of fleetNames) {
        const row = allStats[name] ?? {};
        statsByBot[name] = row;
        observedRoles.push(inferObservedRole(row).observedRole);
      }

      const metrics = computeCivilizationMetrics(observedRoles, statsByBot);
      const payload = { timestamp: Date.now(), fleetSize: fleetNames.length, ...metrics };
      civMetricsCache = { at: Date.now(), payload };
      res.json(payload);
    } catch (err) {
      logger.error({ err }, 'Failed to gather civilization metrics');
      res.status(500).json({ error: 'Failed to gather civilization metrics' });
    }
  });
}
