import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Vec3 } from 'vec3';
import { BotManager } from '../bot/BotManager';
import { BotState } from '../bot/BotState';
import { Server as SocketIOServer } from 'socket.io';
import { EventLog } from '../server/EventLog';
import { logger } from '../util/logger';
import { atomicWriteJsonSync } from '../util/atomicWrite';

// ── Interfaces ──────────────────────────────────────────────

export interface SchematicInfo {
  filename: string;
  size: { x: number; y: number; z: number };
  blockCount: number;
}

export interface BuildJob {
  id: string;
  schematicFile: string;
  origin: { x: number; y: number; z: number };
  status: 'pending' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
  createdAt: number;
  totalBlocks: number;
  placedBlocks: number;
  assignments: BotAssignment[];
  /** Bot names to remove when the build finishes (created specifically for this build) */
  cleanupBotNames?: string[];
}

export interface BotAssignment {
  botName: string;
  yMin: number;
  yMax: number;
  status: 'waiting' | 'building' | 'completed' | 'failed';
  blocksTotal: number;
  blocksPlaced: number;
  currentY: number;
  /** Count of blocks that failed placement verification after all retry attempts. */
  failedBlocks: number;
}

interface BlockEntry {
  // Store as raw numbers instead of Vec3 to save memory
  wx: number; wy: number; wz: number; // world position
  name: string;
  stateStr: string; // pre-computed block state string
  localY: number;
}

interface CachedSchematic {
  size: { x: number; y: number; z: number };
  /** Blocks in schematic-local coordinates (relative to start). */
  blocks: Array<{ rx: number; ry: number; rz: number; name: string; stateStr: string }>;
}

// ── Build Coordinator ───────────────────────────────────────

export class BuildCoordinator {
  private botManager: BotManager;
  private io: SocketIOServer;
  private eventLog: EventLog;
  private jobs: Map<string, BuildJob> = new Map();
  private cancelledJobs: Set<string> = new Set();
  private pausedJobs: Set<string> = new Set();
  private schematicsDir: string;
  private persistPath: string;
  private persistTimer: NodeJS.Timeout | null = null;
  /** Original options for each job, kept for resume. */
  private jobOptions = new Map<string, { fillFoundation?: boolean; snapToGround?: boolean; clearSite?: boolean }>();
  /**
   * Per-job queue of extra blocks that need to be absorbed by an alive bot whose
   * original assignment has completed. Keyed by the receiving bot name.
   */
  private reassignQueues = new Map<string, Map<string, BlockEntry[]>>();
  /** Parsed-schematic cache, keyed by filename. Invalidated when file mtime changes. */
  private schematicCache = new Map<string, { mtimeMs: number; data: CachedSchematic }>();

  constructor(botManager: BotManager, io: SocketIOServer, eventLog: EventLog) {
    this.botManager = botManager;
    this.io = io;
    this.eventLog = eventLog;
    this.schematicsDir = path.join(process.cwd(), 'schematics');
    this.persistPath = path.join(process.cwd(), 'data', 'builds.json');
    this.loadPersistedJobs();
  }

  // ── Persistence ────────────────────────────────────────

  private loadPersistedJobs(): void {
    try {
      if (!fs.existsSync(this.persistPath)) return;
      const raw = fs.readFileSync(this.persistPath, 'utf-8');
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.jobs)) return;
      for (const entry of data.jobs) {
        const job = entry.job as BuildJob;
        // Backfill failedBlocks for jobs persisted before this field existed
        for (const a of job.assignments ?? []) {
          if (typeof a.failedBlocks !== 'number') a.failedBlocks = 0;
        }
        this.jobs.set(job.id, job);
        if (entry.options) this.jobOptions.set(job.id, entry.options);
      }
      logger.info({ count: data.jobs.length }, 'Loaded persisted build jobs');
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to load persisted build jobs');
    }
  }

  private persistJobs(): void {
    try {
      const jobs = [...this.jobs.values()].map((job) => ({
        job,
        options: this.jobOptions.get(job.id) || {},
      }));
      atomicWriteJsonSync(this.persistPath, { jobs });
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to persist build jobs');
    }
  }

  /** Throttled persist — call frequently, writes at most once per 2s. */
  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistJobs();
    }, 2000);
  }

  /**
   * Resume any jobs that were running/paused when the process was last killed.
   * Must be called after the bot workers have had time to connect.
   */
  async resumePendingJobs(): Promise<void> {
    const toResume = [...this.jobs.values()].filter(
      (j) => j.status === 'running' || j.status === 'paused',
    );
    for (const job of toResume) {
      try {
        logger.info(
          { jobId: job.id, schematic: job.schematicFile, placed: job.placedBlocks, total: job.totalBlocks },
          'Resuming persisted build job',
        );
        await this.resumeJob(job);
      } catch (err: any) {
        logger.error({ jobId: job.id, err: err.message }, 'Failed to resume build job');
        job.status = 'failed';
        this.schedulePersist();
      }
    }
  }

  private async resumeJob(job: BuildJob): Promise<void> {
    const fullPath = path.join(this.schematicsDir, job.schematicFile);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Schematic file missing for resume: ${job.schematicFile}`);
    }
    const cached = await this.loadSchematicCached(job.schematicFile);
    const ox = job.origin.x, oy = job.origin.y, oz = job.origin.z;
    const blocks: BlockEntry[] = cached.blocks.map((b) => ({
      wx: ox + b.rx, wy: oy + b.ry, wz: oz + b.rz,
      name: b.name,
      stateStr: b.stateStr,
      localY: b.ry,
    }));

    job.status = 'running';
    this.io.emit('build:started', job);
    this.executeBuild(job.id, blocks, job.assignments).catch((err) => {
      logger.error({ jobId: job.id, err }, 'Resumed build execution failed');
      job.status = 'failed';
      this.io.emit('build:completed', { ...job, error: err.message });
      this.schedulePersist();
    });
  }

  // ── Schematic parsing & cache ──────────────────────────

  /**
   * Load a schematic, returning blocks in schematic-local coords.
   * Result is cached by filename+mtime so repeated startBuild/resumeJob calls
   * for the same file skip the NBT parse + triple-nested iteration.
   */
  private async loadSchematicCached(filename: string): Promise<CachedSchematic> {
    const fullPath = path.join(this.schematicsDir, filename);
    const mtimeMs = fs.statSync(fullPath).mtimeMs;
    const cached = this.schematicCache.get(filename);
    if (cached && cached.mtimeMs === mtimeMs) return cached.data;

    const { Schematic } = require('prismarine-schematic');
    const buffer = fs.readFileSync(fullPath);
    const schematic = await Schematic.read(buffer, await this.getBotVersion());
    const start = schematic.start();
    const end = schematic.end();
    const sx = start.x, sy = start.y, sz = start.z;
    const size = schematic.size;

    const blocks: CachedSchematic['blocks'] = [];
    const tempPos = new Vec3(0, 0, 0);
    for (let y = start.y; y <= end.y; y++) {
      for (let z = start.z; z <= end.z; z++) {
        for (let x = start.x; x <= end.x; x++) {
          tempPos.x = x; tempPos.y = y; tempPos.z = z;
          const block = schematic.getBlock(tempPos);
          if (block && block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air') {
            const props = block.getProperties ? block.getProperties() : {};
            const stateStr = Object.entries(props).map(([k, v]) => `${k}=${v}`).join(',');
            blocks.push({ rx: x - sx, ry: y - sy, rz: z - sz, name: block.name, stateStr });
          }
        }
      }
    }

    const data: CachedSchematic = { size: { x: size.x, y: size.y, z: size.z }, blocks };
    this.schematicCache.set(filename, { mtimeMs, data });
    return data;
  }

  // ── Schematic listing ───────────────────────────────────

  private async getBotVersion(): Promise<string> {
    const bots = this.botManager.getAllWorkers() as any[];
    for (const b of bots) {
      if (typeof b.getBotVersion === 'function') {
        const v = await b.getBotVersion();
        if (v) return v;
      }
    }
    return '1.21.11';
  }

  async listSchematics(): Promise<SchematicInfo[]> {
    if (!fs.existsSync(this.schematicsDir)) return [];

    const files = fs.readdirSync(this.schematicsDir).filter(
      (f) => f.endsWith('.schem') || f.endsWith('.schematic'),
    );

    const results: SchematicInfo[] = [];
    for (const filename of files) {
      try {
        // Skip files larger than 1MB to avoid OOM on huge schematics
        const filePath = path.join(this.schematicsDir, filename);
        const stat = fs.statSync(filePath);
        if (stat.size > 10_000_000) {
          results.push({ filename, size: { x: 0, y: 0, z: 0 }, blockCount: 0 });
          logger.info({ filename, sizeBytes: stat.size }, 'Skipping large schematic metadata load');
          continue;
        }
        const info = await this.getSchematicInfoSafe(filename);
        if (info) results.push(info);
      } catch (err: any) {
        logger.warn({ filename, err: err.message }, 'Failed to read schematic metadata');
        results.push({ filename, size: { x: 0, y: 0, z: 0 }, blockCount: 0 });
      }
    }
    return results;
  }

  /** Safe metadata loader — gets dimensions without holding the full schematic in memory */
  private async getSchematicInfoSafe(filename: string): Promise<SchematicInfo | null> {
    const fullPath = path.join(this.schematicsDir, filename);
    if (!fs.existsSync(fullPath)) return null;

    // Heuristic: compressed .schem files typically have ~100:1 to ~200:1 ratio.
    // Files over 50KB compressed likely decompress to millions of voxels — skip parsing entirely.
    const fileSize = fs.statSync(fullPath).size;
    if (fileSize > 50_000) {
      logger.info({ filename, fileSize }, 'Large schematic — estimating dimensions from file size');
      // Rough estimate: compressed size * 150 gives approx total voxels, cube-root for dimensions
      const estVoxels = fileSize * 150;
      const estDim = Math.round(Math.cbrt(estVoxels));
      return { filename, size: { x: estDim, y: Math.round(estDim * 0.6), z: estDim }, blockCount: Math.round(estVoxels * 0.15) };
    }

    try {
      const cached = await this.loadSchematicCached(filename);
      const size = cached.size;
      const volume = size.x * size.y * size.z;
      // For very large schematics, estimate block count and skip iteration
      if (volume > 200_000) {
        return { filename, size, blockCount: Math.round(volume * 0.15) };
      }
      return { filename, size, blockCount: cached.blocks.length };
    } catch (err: any) {
      logger.warn({ filename, err: err.message }, 'Failed to parse schematic');
      return { filename, size: { x: 0, y: 0, z: 0 }, blockCount: 0 };
    }
  }

  async getSchematicInfoAsync(filename: string): Promise<SchematicInfo | null> {
    return this.getSchematicInfoSafe(filename);
  }

  // ── Build job management ────────────────────────────────

  async startBuild(
    schematicFile: string,
    origin: { x: number; y: number; z: number },
    botNames: string[],
    options?: { cleanupBotNames?: string[]; fillFoundation?: boolean; snapToGround?: boolean; clearSite?: boolean },
  ): Promise<BuildJob> {
    const fullPath = path.join(this.schematicsDir, schematicFile);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Schematic file not found: ${schematicFile}`);
    }

    // Validate bots exist and are connected (via worker IPC)
    for (const name of botNames) {
      const handle = this.botManager.getWorker(name) as any;
      if (!handle) throw new Error(`Bot not found: ${name}`);
      const connected = await handle.isBotConnected();
      if (!connected) throw new Error(`Bot not connected: ${name}`);
    }

    // Check file size before loading to prevent OOM
    const fileStat = fs.statSync(fullPath);
    if (fileStat.size > 10_000_000) {
      throw new Error(`Schematic file too large (${(fileStat.size / 1_000_000).toFixed(1)}MB). Max file size: 10MB.`);
    }

    const cached = await this.loadSchematicCached(schematicFile);
    const schSize = cached.size;
    const volume = schSize.x * schSize.y * schSize.z;
    if (volume > 2_000_000) {
      throw new Error(`Schematic volume too large (${schSize.x}x${schSize.y}x${schSize.z} = ${volume.toLocaleString()} voxels). Max 2M voxels.`);
    }

    const ox = origin.x, oy = origin.y, oz = origin.z;
    const blocks: BlockEntry[] = cached.blocks.map((b) => ({
      wx: ox + b.rx, wy: oy + b.ry, wz: oz + b.rz,
      name: b.name,
      stateStr: b.stateStr,
      localY: b.ry,
    }));

    if (blocks.length === 0) {
      throw new Error('Schematic contains no blocks');
    }

    // ── Snap-to-ground: adjust origin Y to average terrain height ──
    const fillFoundation = options?.fillFoundation !== false; // default true
    const snapToGround = options?.snapToGround === true; // default false
    const clearSiteEnabled = options?.clearSite !== false; // default true

    // Find a connected bot handle to query world blocks via IPC
    let probeHandle: any = null;
    for (const n of botNames) {
      const h = this.botManager.getWorker(n) as any;
      if (h && typeof h.isBotConnected === 'function' && (await h.isBotConnected())) {
        probeHandle = h;
        break;
      }
    }

    // ── Pre-build site-prep: clear the footprint before any placement ──
    // Runs BEFORE snap-to-ground because leveling/terrain probes should see
    // a clean slate (no trees, no grass tufts, no water interfering).
    if (clearSiteEnabled && probeHandle) {
      const footprintMin = {
        x: origin.x,
        y: origin.y,
        z: origin.z,
      };
      const footprintMax = {
        x: origin.x + schSize.x - 1,
        y: origin.y + schSize.y - 1,
        z: origin.z + schSize.z - 1,
      };
      try {
        const clearResult = await this.runClearSite(probeHandle, {
          footprintMin,
          footprintMax,
          clearanceHeight: schSize.y,
        });
        logger.info(
          { clearedSlabs: clearResult.cleared, errors: clearResult.errors.length },
          'Site-prep: cleared footprint ahead of snap-to-ground',
        );
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Site-prep: clear failed — continuing with build');
      }
    } else if (clearSiteEnabled && !probeHandle) {
      logger.warn('Site-prep requested but no connected bot available to issue /fill');
    }

    if (snapToGround && probeHandle) {
      // Build a grid of sample points across the footprint
      const footprintXZ = new Map<string, { wx: number; wz: number }>();
      for (const b of blocks) {
        const key = `${b.wx},${b.wz}`;
        if (!footprintXZ.has(key)) footprintXZ.set(key, { wx: b.wx, wz: b.wz });
      }

      // Sample up to 50 evenly-spaced columns. Probe columns in parallel chunks
      // so we issue ~10 concurrent IPC scans instead of one at a time.
      const allColumns = [...footprintXZ.values()];
      const sampleStep = Math.max(1, Math.floor(allColumns.length / 50));
      const sampledColumns: { wx: number; wz: number }[] = [];
      for (let i = 0; i < allColumns.length; i += sampleStep) {
        sampledColumns.push(allColumns[i]);
      }
      const samples: number[] = [];
      const PROBE_CONCURRENCY = 10;
      for (let i = 0; i < sampledColumns.length; i += PROBE_CONCURRENCY) {
        const chunk = sampledColumns.slice(i, i + PROBE_CONCURRENCY);
        const results = await Promise.all(chunk.map(async (col) => {
          for (let y = oy + 10; y >= oy - 30; y--) {
            const wb = await probeHandle.getBlockAt(col.wx, y, col.wz);
            if (wb && wb.name !== 'air' && wb.name !== 'cave_air' && wb.name !== 'void_air') {
              return y + 1;
            }
          }
          return null;
        }));
        for (const r of results) {
          if (r !== null) samples.push(r);
        }
      }

      if (samples.length > 0) {
        // Use median ground level
        samples.sort((a, b) => a - b);
        const medianGround = samples[Math.floor(samples.length / 2)];
        const diff = medianGround - oy;
        if (Math.abs(diff) <= 5 && diff !== 0) {
          logger.info(
            { oldY: oy, newY: medianGround, diff, samples: samples.length },
            'Snap-to-ground: adjusting origin Y to median terrain height',
          );
          // Shift all block world-Y positions by the difference
          for (const b of blocks) {
            b.wy += diff;
          }
          origin.y = medianGround;
        } else if (Math.abs(diff) > 5) {
          logger.info(
            { originY: oy, medianGround, diff },
            'Snap-to-ground: terrain difference too large, skipping adjustment',
          );
        }
      }
    }

    // ── Foundation filling: add support blocks under schematic footprint ──
    if (fillFoundation && probeHandle) {
      const MAX_FILL_DEPTH = 20;

      // For each (wx, wz) column, find the lowest schematic block Y
      const columnMinY = new Map<string, number>();
      for (const b of blocks) {
        const key = `${b.wx},${b.wz}`;
        const prev = columnMinY.get(key);
        if (prev === undefined || b.wy < prev) {
          columnMinY.set(key, b.wy);
        }
      }

      const foundationBlocks: BlockEntry[] = [];
      let skippedLiquid = 0;
      let skippedOutOfRange = 0;

      const columnEntries = [...columnMinY.entries()];
      const FOUNDATION_CONCURRENCY = 10;
      for (let ci = 0; ci < columnEntries.length; ci += FOUNDATION_CONCURRENCY) {
        const chunk = columnEntries.slice(ci, ci + FOUNDATION_CONCURRENCY);
        const results = await Promise.all(chunk.map(async ([key, minBlockY]) => {
          const [wxStr, wzStr] = key.split(',');
          const wx = parseInt(wxStr, 10);
          const wz = parseInt(wzStr, 10);
          const fills: BlockEntry[] = [];
          let outcome: 'ok' | 'liquid' | 'out_of_range' = 'ok';
          let liquidName = '';
          let liquidY = 0;
          for (let y = minBlockY - 1; y >= minBlockY - MAX_FILL_DEPTH; y--) {
            const wb = await probeHandle.getBlockAt(wx, y, wz);
            if (!wb) { outcome = 'out_of_range'; break; }
            if (wb.name === 'air' || wb.name === 'cave_air' || wb.name === 'void_air') {
              fills.push({
                wx, wy: y, wz,
                name: 'stone',
                stateStr: '',
                localY: -1 - fills.length,
              });
            } else if (wb.name === 'water' || wb.name === 'lava'
              || wb.name === 'flowing_water' || wb.name === 'flowing_lava') {
              outcome = 'liquid'; liquidName = wb.name; liquidY = y; break;
            } else {
              break;
            }
          }
          return { wx, wz, fills, outcome, liquidName, liquidY };
        }));
        for (const r of results) {
          if (r.outcome === 'out_of_range') {
            skippedOutOfRange++;
          } else if (r.outcome === 'liquid') {
            logger.warn(
              { wx: r.wx, y: r.liquidY, wz: r.wz, liquid: r.liquidName },
              'Foundation fill: liquid detected under schematic, skipping column',
            );
            skippedLiquid++;
          }
          for (const f of r.fills) foundationBlocks.push(f);
        }
      }

      if (foundationBlocks.length > 0) {
        logger.info(
          { foundationBlocks: foundationBlocks.length, columns: columnMinY.size, skippedLiquid, skippedOutOfRange },
          'Foundation fill: adding support blocks under schematic',
        );
        // Sort foundation blocks bottom-up so they build from ground level
        foundationBlocks.sort((a, b) => a.wy - b.wy);
        // Prepend foundation blocks before schematic blocks
        blocks.unshift(...foundationBlocks);
      } else {
        logger.info('Foundation fill: no gaps detected, no fill needed');
      }
    } else if (fillFoundation && !probeHandle) {
      logger.warn('Foundation fill requested but no connected bot available to probe terrain');
    }

    // Safety limit on actual block count to prevent OOM
    const MAX_BLOCKS = 500000;
    if (blocks.length > MAX_BLOCKS) {
      throw new Error(`Schematic has ${blocks.length.toLocaleString()} blocks. Max supported: ${MAX_BLOCKS.toLocaleString()}.`);
    }

    // Determine Y range
    const minLocalY = 0;
    const maxLocalY = schSize.y - 1;

    // Partition by block count so each bot gets roughly equal work
    // Group blocks by Y layer, then assign layers to bots greedily
    const blocksPerY = new Map<number, number>();
    for (const b of blocks) {
      blocksPerY.set(b.localY, (blocksPerY.get(b.localY) || 0) + 1);
    }
    const yLevels = [...blocksPerY.keys()].sort((a, b) => a - b);
    const targetPerBot = Math.ceil(blocks.length / botNames.length);

    // Assign contiguous Y ranges to each bot, splitting when block count target is reached
    const botRanges: { yMin: number; yMax: number; count: number }[] = [];
    let currentCount = 0;
    let rangeStart = yLevels[0] ?? 0;

    for (let i = 0; i < yLevels.length; i++) {
      currentCount += blocksPerY.get(yLevels[i])!;
      const isLast = i === yLevels.length - 1;
      const reachedTarget = currentCount >= targetPerBot && botRanges.length < botNames.length - 1;

      if (reachedTarget || isLast) {
        botRanges.push({ yMin: rangeStart, yMax: yLevels[i], count: currentCount });
        currentCount = 0;
        if (i < yLevels.length - 1) rangeStart = yLevels[i + 1];
      }
    }

    // If fewer ranges than bots (very flat schematic), only use needed bots
    const assignments: BotAssignment[] = botNames.slice(0, botRanges.length).map((botName, idx) => {
      const range = botRanges[idx];
      const botBlocks = blocks.filter((b) => b.localY >= range.yMin && b.localY <= range.yMax);
      return {
        botName,
        yMin: range.yMin,
        yMax: range.yMax,
        status: 'waiting' as const,
        blocksTotal: botBlocks.length,
        blocksPlaced: 0,
        currentY: range.yMin,
        failedBlocks: 0,
      } as BotAssignment;
    });

    logger.info(
      { assignments: assignments.map(a => ({ bot: a.botName, yMin: a.yMin, yMax: a.yMax, blocks: a.blocksTotal })) },
      'Build work partitioned by block count',
    );

    const jobId = crypto.randomUUID();
    const job: BuildJob = {
      id: jobId,
      schematicFile,
      origin,
      status: 'running',
      createdAt: Date.now(),
      totalBlocks: blocks.length,
      placedBlocks: 0,
      assignments,
      cleanupBotNames: options?.cleanupBotNames,
    };

    this.jobs.set(jobId, job);
    this.jobOptions.set(jobId, {
      fillFoundation: options?.fillFoundation,
      snapToGround: options?.snapToGround,
      clearSite: options?.clearSite,
    });
    this.persistJobs();

    // Emit started event
    this.io.emit('build:started', job);
    this.eventLog.push({
      type: 'build:started',
      botName: botNames.join(', '),
      description: `Build started: ${schematicFile} with ${botNames.length} bot(s)`,
      metadata: { jobId, schematicFile, origin, botNames },
    });

    logger.info(
      { jobId, schematicFile, origin, bots: botNames, totalBlocks: blocks.length },
      'Multi-bot build started',
    );

    // Start execution in background (non-blocking)
    this.executeBuild(jobId, blocks, assignments).catch((err) => {
      logger.error({ jobId, err }, 'Build execution failed');
      job.status = 'failed';
      this.io.emit('build:completed', { ...job, error: err.message });
    });

    return job;
  }

  cancelBuild(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status === 'completed' || job.status === 'cancelled') return false;

    this.cancelledJobs.add(jobId);
    job.status = 'cancelled';
    this.schedulePersist();

    // Reset bot states
    for (const assignment of job.assignments) {
      if (assignment.status === 'building' || assignment.status === 'waiting') {
        assignment.status = 'failed';
        const handle = this.botManager.getWorker(assignment.botName) as any;
        if (handle && typeof handle.setBotState === 'function') handle.setBotState(BotState.IDLE);
      }
    }

    this.io.emit('build:cancelled', { jobId });
    this.eventLog.push({
      type: 'build:cancelled',
      botName: job.assignments.map((a) => a.botName).join(', '),
      description: `Build cancelled: ${job.schematicFile}`,
      metadata: { jobId },
    });

    logger.info({ jobId }, 'Build cancelled');
    return true;
  }

  pauseBuild(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'running') return false;

    this.pausedJobs.add(jobId);
    job.status = 'paused';
    this.schedulePersist();

    this.io.emit('build:bot-status', { jobId, status: 'paused' });
    logger.info({ jobId }, 'Build paused');
    return true;
  }

  resumeBuild(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'paused') return false;

    this.pausedJobs.delete(jobId);
    job.status = 'running';
    this.schedulePersist();

    this.io.emit('build:bot-status', { jobId, status: 'running' });
    logger.info({ jobId }, 'Build resumed');
    return true;
  }

  getBuildJob(jobId: string): BuildJob | undefined {
    return this.jobs.get(jobId);
  }

  getAllBuildJobs(): BuildJob[] {
    return [...this.jobs.values()];
  }

  // ── Execution engine ────────────────────────────────────

  private async executeBuild(
    jobId: string,
    blocks: BlockEntry[],
    assignments: BotAssignment[],
  ): Promise<void> {
    const job = this.jobs.get(jobId)!;

    // Pre-partition blocks by bot in a single pass so each parallel worker
    // doesn't re-filter the full block array.
    const blocksByBot = new Map<string, BlockEntry[]>();
    for (const a of assignments) blocksByBot.set(a.botName, []);
    for (const b of blocks) {
      for (const a of assignments) {
        if (b.localY >= a.yMin && b.localY <= a.yMax) {
          blocksByBot.get(a.botName)!.push(b);
          break;
        }
      }
    }

    // Execute all bot assignments in parallel — each bot works on its Y range
    const promises = assignments.map(async (assignment, i) => {
      // Check for cancellation
      if (this.cancelledJobs.has(jobId)) return;

      // Get the worker handle (worker thread is the source of truth for the mineflayer bot)
      const handle = this.botManager.getWorker(assignment.botName) as any;
      const connected = handle ? await handle.isBotConnected() : false;
      if (!handle || !connected) {
        assignment.status = 'failed';
        logger.error({ jobId, bot: assignment.botName }, 'Bot not available for building');
        return;
      }

      // Pause voyager loop so the bot doesn't wander off
      handle.pauseVoyager('building');

      // Stop any current pathfinding/movement
      handle.stopMovement();

      // Set creative mode so bot can't die during build, then teleport to site
      try {
        const opHandles = (this.botManager.getAllWorkers() as any[])
          .filter((h: any) => h && h.botName !== assignment.botName);
        let opHandle: any = null;
        for (const oh of opHandles) {
          if (typeof oh.isBotConnected === 'function' && (await oh.isBotConnected())) {
            opHandle = oh;
            break;
          }
        }
        const cmds = [
          `/gamemode creative ${assignment.botName}`,
          `/tp ${assignment.botName} ${job.origin.x} ${job.origin.y + 50} ${job.origin.z}`,
        ];
        for (const cmd of cmds) {
          if (opHandle) opHandle.chat(cmd);
          handle.chat(cmd);
          await this.sleep(500);
        }
        await this.sleep(1000);
        logger.info({ bot: assignment.botName }, 'Set creative mode and teleported to build site');
      } catch (e) {
        logger.warn({ bot: assignment.botName }, 'Failed to prepare bot for building');
      }

      // Set bot state to BUILDING
      handle.setBotState(BotState.BUILDING);
      assignment.status = 'building';

      this.io.emit('build:bot-status', {
        jobId,
        botName: assignment.botName,
        status: 'building',
        yMin: assignment.yMin,
        yMax: assignment.yMax,
      });

      // Pre-partitioned slice for this bot.
      const botBlocks = blocksByBot.get(assignment.botName) ?? [];

      // Stagger start by 2s per bot to avoid overwhelming server
      if (i > 0) await new Promise((r) => setTimeout(r, i * 2000));

      try {
        await this.executeBotAssignment(jobId, job, assignment, handle, botBlocks);
        assignment.status = 'completed';
      } catch (err: any) {
        assignment.status = 'failed';
        logger.error({ jobId, bot: assignment.botName, err: err.message }, 'Bot assignment failed');
      }

      // Switch back to survival and reset bot state
      try {
        handle.chat(`/gamemode survival ${assignment.botName}`);
      } catch {}
      handle.setBotState(BotState.IDLE);
      handle.resumeVoyager();

      this.io.emit('build:bot-status', {
        jobId,
        botName: assignment.botName,
        status: assignment.status,
        blocksPlaced: assignment.blocksPlaced,
      });
    });

    await Promise.all(promises);

    // Final status
    if (!this.cancelledJobs.has(jobId)) {
      const allCompleted = assignments.every((a) => a.status === 'completed');
      job.status = allCompleted ? 'completed' : 'failed';

      this.io.emit('build:completed', job);
      this.eventLog.push({
        type: 'build:completed',
        botName: assignments.map((a) => a.botName).join(', '),
        description: `Build ${job.status}: ${job.schematicFile} (${job.placedBlocks}/${job.totalBlocks} blocks)`,
        metadata: { jobId, status: job.status },
      });

      logger.info(
        { jobId, status: job.status, placed: job.placedBlocks, total: job.totalBlocks },
        'Build finished',
      );
      this.persistJobs();

      // Remove bots that were created specifically for this build
      if (job.cleanupBotNames && job.cleanupBotNames.length > 0) {
        for (const botName of job.cleanupBotNames) {
          try {
            const removed = await this.botManager.removeBot(botName);
            if (removed) {
              logger.info({ botName, jobId }, 'Cleaned up build bot');
              this.io.emit('bot:disconnect', { bot: botName });
            }
          } catch (err) {
            logger.warn({ botName, jobId, err }, 'Failed to cleanup build bot');
          }
        }
      }
    }

    // Cleanup cancellation & reassignment tracking
    this.cancelledJobs.delete(jobId);
    this.reassignQueues.delete(jobId);
  }

  private async executeBotAssignment(
    jobId: string,
    job: BuildJob,
    assignment: BotAssignment,
    handle: any,
    blocks: BlockEntry[],
  ): Promise<void> {
    // Resume: skip blocks already placed in a prior run.
    const startIdx = Math.min(assignment.blocksPlaced, blocks.length);
    if (startIdx > 0) {
      logger.info(
        { jobId, bot: assignment.botName, skipping: startIdx, remaining: blocks.length - startIdx },
        'Resuming bot assignment — skipping already-placed blocks',
      );
    }

    // Helper: place a single block with verification + retry.
    const placeOne = async (block: BlockEntry): Promise<void> => {
      const blockSpec = block.stateStr ? `${block.name}[${block.stateStr}]` : block.name;
      const MAX_ATTEMPTS = 3;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        handle.chat(`/setblock ${block.wx} ${block.wy} ${block.wz} minecraft:${blockSpec} replace`);
        await this.sleep(250);

        // Verify placement via IPC probe on the bot's own handle.
        let placed: { name: string } | null = null;
        try {
          placed = typeof handle.getBlockAt === 'function'
            ? await handle.getBlockAt(block.wx, block.wy, block.wz)
            : null;
        } catch {
          placed = null;
        }

        // If probe returned nothing (chunk not loaded / transient IPC error),
        // accept the placement optimistically — further retry without evidence
        // risks doubling up server load for every block.
        if (!placed) return;

        const placedName = placed.name?.startsWith('minecraft:')
          ? placed.name.slice('minecraft:'.length)
          : placed.name;
        if (placedName === block.name) return;

        if (attempt < MAX_ATTEMPTS) {
          logger.warn(
            { jobId, bot: assignment.botName, at: { x: block.wx, y: block.wy, z: block.wz }, want: block.name, got: placedName, attempt },
            'Block verify failed — retrying /setblock',
          );
        } else {
          assignment.failedBlocks++;
          logger.warn(
            { jobId, bot: assignment.botName, at: { x: block.wx, y: block.wy, z: block.wz }, want: block.name, got: placedName },
            'Block verify failed after max retries — counting as failed',
          );
        }
      }
    };

    let bi = startIdx;
    while (bi < blocks.length) {
      const block = blocks[bi];
      // Check cancellation
      if (this.cancelledJobs.has(jobId)) return;

      // Check pause — spin-wait with sleep
      while (this.pausedJobs.has(jobId)) {
        if (this.cancelledJobs.has(jobId)) return;
        await this.sleep(500);
      }

      // Bot-death check BEFORE each placement: if the worker handle is
      // dead or the mineflayer bot is disconnected, hand off remaining
      // blocks to any spare bot whose assignment has completed.
      const alive = typeof handle.isAlive === 'function' ? handle.isAlive() : true;
      let connected = true;
      if (alive && typeof handle.isBotConnected === 'function') {
        try {
          connected = await handle.isBotConnected();
        } catch {
          connected = false;
        }
      }
      if (!alive || !connected) {
        const remaining = blocks.slice(bi);
        assignment.status = 'failed';
        logger.error(
          { jobId, bot: assignment.botName, remaining: remaining.length, placed: assignment.blocksPlaced },
          'Bot disconnected mid-build — attempting reassignment',
        );
        this.reassignRemaining(jobId, job, assignment, remaining);
        throw new Error('bot disconnected');
      }

      await placeOne(block);

      assignment.blocksPlaced++;
      assignment.currentY = block.localY;
      job.placedBlocks++;

      // Emit progress every 20 blocks
      if (job.placedBlocks % 20 === 0) {
        this.io.emit('build:progress', {
          jobId,
          placedBlocks: job.placedBlocks,
          totalBlocks: job.totalBlocks,
          percentage: Math.round((job.placedBlocks / job.totalBlocks) * 100),
          botName: assignment.botName,
          botBlocksPlaced: assignment.blocksPlaced,
          botBlocksTotal: assignment.blocksTotal,
        });
        // Throttled persist so a crash loses at most ~2s of progress
        this.schedulePersist();
      }
      bi++;

      // Between placements, absorb any reassigned blocks handed to this bot.
      if (bi >= blocks.length) {
        const extras = this.drainReassignedBlocks(jobId, assignment.botName);
        if (extras.length > 0) {
          logger.info(
            { jobId, bot: assignment.botName, absorbing: extras.length },
            'Absorbing reassigned blocks from a dead bot',
          );
          blocks.push(...extras);
          assignment.blocksTotal += extras.length;
        }
      }
    }
  }

  /**
   * Try to hand off the `remaining` blocks of a dead bot's assignment to
   * another bot in the same job whose worker is still alive + connected.
   * Prefers a bot that has already completed its own slice (spec-preferred),
   * but falls back to any still-alive bot so blocks are not lost when a
   * death happens mid-build. Each recipient drains the reassign queue after
   * finishing its own blocks. Single-pass — no full re-balancing.
   */
  private reassignRemaining(
    jobId: string,
    job: BuildJob,
    deadAssignment: BotAssignment,
    remaining: BlockEntry[],
  ): void {
    if (remaining.length === 0) return;

    const candidates = job.assignments.filter((a) => {
      if (a === deadAssignment) return false;
      if (a.status === 'failed') return false;
      const h = this.botManager.getWorker(a.botName) as any;
      if (!h) return false;
      if (typeof h.isAlive === 'function' && !h.isAlive()) return false;
      return true;
    });
    // Prefer completed (now-idle) bots over still-building ones.
    candidates.sort((a, b) => {
      const rank = (s: string) => (s === 'completed' ? 0 : s === 'building' ? 1 : 2);
      return rank(a.status) - rank(b.status);
    });
    const target = candidates[0];
    if (!target) {
      logger.warn(
        { jobId, from: deadAssignment.botName, blocks: remaining.length },
        'No spare bot available — dead bot\'s remaining blocks will be lost',
      );
      return;
    }

    let jobQueues = this.reassignQueues.get(jobId);
    if (!jobQueues) {
      jobQueues = new Map();
      this.reassignQueues.set(jobId, jobQueues);
    }
    const existing = jobQueues.get(target.botName) ?? [];
    existing.push(...remaining);
    jobQueues.set(target.botName, existing);

    this.io.emit('build:reassign', {
      jobId,
      from: deadAssignment.botName,
      to: target.botName,
      blocks: remaining.length,
    });
    logger.info(
      { jobId, from: deadAssignment.botName, to: target.botName, blocks: remaining.length, targetStatus: target.status },
      'Reassigning remaining blocks to alive bot',
    );
  }

  /** Drain and return any pending reassigned blocks for a given bot. */
  private drainReassignedBlocks(jobId: string, botName: string): BlockEntry[] {
    const jobQueues = this.reassignQueues.get(jobId);
    if (!jobQueues) return [];
    const queue = jobQueues.get(botName);
    if (!queue || queue.length === 0) return [];
    jobQueues.set(botName, []);
    return queue;
  }

  /**
   * Clear the world volume enclosing the schematic footprint by issuing
   * `/fill ... air destroy` commands from the probe bot. Commands are issued
   * one Y-slab at a time so we never exceed Minecraft's 32768-block fill cap.
   */
  private async runClearSite(
    probeHandle: any,
    opts: {
      footprintMin: { x: number; y: number; z: number };
      footprintMax: { x: number; y: number; z: number };
      clearanceHeight?: number;
    },
  ): Promise<{ cleared: number; errors: string[] }> {
    const errors: string[] = [];
    const { footprintMin, footprintMax } = opts;
    const x1 = Math.min(footprintMin.x, footprintMax.x);
    const x2 = Math.max(footprintMin.x, footprintMax.x);
    const z1 = Math.min(footprintMin.z, footprintMax.z);
    const z2 = Math.max(footprintMin.z, footprintMax.z);
    const yBase = Math.min(footprintMin.y, footprintMax.y);
    const height = opts.clearanceHeight ?? (Math.abs(footprintMax.y - footprintMin.y) + 1);
    const yTop = yBase + height - 1;

    const area = (x2 - x1 + 1) * (z2 - z1 + 1);
    if (area <= 0) return { cleared: 0, errors };

    // Fill cap is 32768 blocks. Slab size per Y is `area` — slice Y to stay under cap.
    const slabThickness = Math.max(1, Math.floor(32768 / Math.max(1, area)));
    let slabs = 0;

    for (let ySlabStart = yBase; ySlabStart <= yTop; ySlabStart += slabThickness) {
      const ySlabEnd = Math.min(ySlabStart + slabThickness - 1, yTop);
      const cmd = `/fill ${x1} ${ySlabStart} ${z1} ${x2} ${ySlabEnd} ${z2} air destroy`;
      try {
        probeHandle.chat(cmd);
        slabs++;
      } catch (err: any) {
        errors.push(err?.message ?? String(err));
      }
      // Small delay between fill commands to avoid overrunning the server tick.
      await this.sleep(200);
    }

    return { cleared: slabs, errors };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
