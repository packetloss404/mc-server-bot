import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Vec3 } from 'vec3';
import { BotManager } from '../bot/BotManager';
import { BotState } from '../bot/BotState';
import { Server as SocketIOServer } from 'socket.io';
import { EventLog } from '../server/EventLog';
import { logger } from '../util/logger';

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
}

interface BlockEntry {
  // Store as raw numbers instead of Vec3 to save memory
  wx: number; wy: number; wz: number; // world position
  name: string;
  stateStr: string; // pre-computed block state string
  localY: number;
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

  constructor(botManager: BotManager, io: SocketIOServer, eventLog: EventLog) {
    this.botManager = botManager;
    this.io = io;
    this.eventLog = eventLog;
    this.schematicsDir = path.join(process.cwd(), 'schematics');
  }

  // ── Schematic listing ───────────────────────────────────

  private getBotVersion(): string {
    const bots = this.botManager.getAllWorkers() as any[];
    const connected = bots.find((b) => b.bot);
    return connected?.bot?.version ?? '1.21.11';
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
    const { Schematic } = require('prismarine-schematic');
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

    let schematic: any;
    try {
      const buffer = fs.readFileSync(fullPath);
      schematic = await Schematic.read(buffer, this.getBotVersion());
    } catch (err: any) {
      logger.warn({ filename, err: err.message }, 'Failed to parse schematic');
      return { filename, size: { x: 0, y: 0, z: 0 }, blockCount: 0 };
    }

    const size = schematic.size;
    const volume = size.x * size.y * size.z;

    // For large schematics, estimate block count and skip iteration
    if (volume > 200_000) {
      schematic = null; // release memory
      return { filename, size: { x: size.x, y: size.y, z: size.z }, blockCount: Math.round(volume * 0.15) };
    }

    // For smaller schematics, count actual blocks
    const start = schematic.start();
    const end = schematic.end();
    let blockCount = 0;
    const tempPos = new Vec3(0, 0, 0);
    for (let y = start.y; y <= end.y; y++) {
      for (let z = start.z; z <= end.z; z++) {
        for (let x = start.x; x <= end.x; x++) {
          tempPos.x = x; tempPos.y = y; tempPos.z = z;
          const block = schematic.getBlock(tempPos);
          if (block && block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air') {
            blockCount++;
          }
        }
      }
    }
    schematic = null; // release memory

    return { filename, size: { x: size.x, y: size.y, z: size.z }, blockCount };
  }

  async getSchematicInfoAsync(filename: string): Promise<SchematicInfo | null> {
    return this.getSchematicInfoSafe(filename);
  }

  // ── Build job management ────────────────────────────────

  async startBuild(
    schematicFile: string,
    origin: { x: number; y: number; z: number },
    botNames: string[],
    options?: { cleanupBotNames?: string[]; fillFoundation?: boolean; snapToGround?: boolean },
  ): Promise<BuildJob> {
    const { Schematic } = require('prismarine-schematic');
    const fullPath = path.join(this.schematicsDir, schematicFile);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Schematic file not found: ${schematicFile}`);
    }

    // Validate bots exist and are connected
    for (const name of botNames) {
      const instance = this.botManager.getWorker(name) as any;
      if (!instance) throw new Error(`Bot not found: ${name}`);
      if (!instance.bot) throw new Error(`Bot not connected: ${name}`);
    }

    // Check file size before loading to prevent OOM
    const fileStat = fs.statSync(fullPath);
    if (fileStat.size > 10_000_000) {
      throw new Error(`Schematic file too large (${(fileStat.size / 1_000_000).toFixed(1)}MB). Max file size: 10MB.`);
    }

    // Load schematic
    const buffer = fs.readFileSync(fullPath);
    const schematic = await Schematic.read(buffer, this.getBotVersion());

    // Check volume before iterating — reject if too large
    const schSize = schematic.size;
    const volume = schSize.x * schSize.y * schSize.z;
    if (volume > 2_000_000) {
      throw new Error(`Schematic volume too large (${schSize.x}x${schSize.y}x${schSize.z} = ${volume.toLocaleString()} voxels). Max 2M voxels.`);
    }

    const ox = origin.x, oy = origin.y, oz = origin.z;
    const start = schematic.start();
    const end = schematic.end();
    const sx = start.x, sy = start.y, sz = start.z;

    // Collect all non-air blocks as lightweight objects (no Vec3 to save memory)
    const blocks: BlockEntry[] = [];
    const tempPos = new Vec3(0, 0, 0); // reuse single Vec3
    for (let y = start.y; y <= end.y; y++) {
      for (let z = start.z; z <= end.z; z++) {
        for (let x = start.x; x <= end.x; x++) {
          tempPos.x = x; tempPos.y = y; tempPos.z = z;
          const block = schematic.getBlock(tempPos);
          if (block && block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air') {
            const props = block.getProperties ? block.getProperties() : {};
            const stateStr = Object.entries(props).map(([k, v]) => `${k}=${v}`).join(',');
            blocks.push({
              wx: ox + x - sx, wy: oy + y - sy, wz: oz + z - sz,
              name: block.name,
              stateStr,
              localY: y - sy,
            });
          }
        }
      }
    }
    // Free schematic from memory
    // @ts-ignore
    buffer.fill(0);

    if (blocks.length === 0) {
      throw new Error('Schematic contains no blocks');
    }

    // ── Snap-to-ground: adjust origin Y to average terrain height ──
    const fillFoundation = options?.fillFoundation !== false; // default true
    const snapToGround = options?.snapToGround === true; // default false

    // Find a connected bot to query world blocks
    const probeInstance = (botNames
      .map((n) => this.botManager.getWorker(n)) as any[])
      .find((inst: any) => inst?.bot);
    const probeBot = probeInstance?.bot;

    if (snapToGround && probeBot) {
      // Build a grid of sample points across the footprint
      const footprintXZ = new Map<string, { wx: number; wz: number }>();
      for (const b of blocks) {
        const key = `${b.wx},${b.wz}`;
        if (!footprintXZ.has(key)) footprintXZ.set(key, { wx: b.wx, wz: b.wz });
      }

      // Sample up to 50 evenly-spaced columns
      const allColumns = [...footprintXZ.values()];
      const sampleStep = Math.max(1, Math.floor(allColumns.length / 50));
      const samples: number[] = [];
      for (let i = 0; i < allColumns.length; i += sampleStep) {
        const col = allColumns[i];
        // Scan downward from origin Y + 10 to find the first solid block
        for (let y = oy + 10; y >= oy - 30; y--) {
          const wb = probeBot.blockAt(new Vec3(col.wx, y, col.wz));
          if (wb && wb.name !== 'air' && wb.name !== 'cave_air' && wb.name !== 'void_air') {
            samples.push(y + 1); // ground surface is top of this block
            break;
          }
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
    if (fillFoundation && probeBot) {
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

      for (const [key, minBlockY] of columnMinY) {
        const [wxStr, wzStr] = key.split(',');
        const wx = parseInt(wxStr, 10);
        const wz = parseInt(wzStr, 10);

        // Scan downward from minBlockY - 1 to find ground
        let filledCount = 0;
        for (let y = minBlockY - 1; y >= minBlockY - MAX_FILL_DEPTH; y--) {
          const wb = probeBot.blockAt(new Vec3(wx, y, wz));
          if (!wb) {
            // Bot too far to query — skip this column
            skippedOutOfRange++;
            break;
          }

          if (wb.name === 'air' || wb.name === 'cave_air' || wb.name === 'void_air') {
            // Air gap — fill with stone
            foundationBlocks.push({
              wx, wy: y, wz,
              name: 'stone',
              stateStr: '',
              localY: -1 - filledCount, // negative localY so they sort before schematic blocks
            });
            filledCount++;
          } else if (wb.name === 'water' || wb.name === 'lava'
            || wb.name === 'flowing_water' || wb.name === 'flowing_lava') {
            logger.warn(
              { wx, y, wz, liquid: wb.name },
              'Foundation fill: liquid detected under schematic, skipping column',
            );
            skippedLiquid++;
            break;
          } else {
            // Hit solid ground — done with this column
            break;
          }
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
    } else if (fillFoundation && !probeBot) {
      logger.warn('Foundation fill requested but no connected bot available to probe terrain');
    }

    // Safety limit on actual block count to prevent OOM
    const MAX_BLOCKS = 500000;
    if (blocks.length > MAX_BLOCKS) {
      throw new Error(`Schematic has ${blocks.length.toLocaleString()} blocks. Max supported: ${MAX_BLOCKS.toLocaleString()}.`);
    }

    // Determine Y range
    const minLocalY = 0;
    const maxLocalY = end.y - start.y;

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

    // Reset bot states
    for (const assignment of job.assignments) {
      if (assignment.status === 'building' || assignment.status === 'waiting') {
        assignment.status = 'failed';
        const instance = this.botManager.getWorker(assignment.botName) as any;
        if (instance) instance.state = BotState.IDLE;
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

    this.io.emit('build:bot-status', { jobId, status: 'paused' });
    logger.info({ jobId }, 'Build paused');
    return true;
  }

  resumeBuild(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'paused') return false;

    this.pausedJobs.delete(jobId);
    job.status = 'running';

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

    // Execute all bot assignments in parallel — each bot works on its Y range
    const promises = assignments.map(async (assignment, i) => {
      // Check for cancellation
      if (this.cancelledJobs.has(jobId)) return;

      // Get the mineflayer bot instance
      const instance = this.botManager.getWorker(assignment.botName) as any;
      if (!instance || !instance.bot) {
        assignment.status = 'failed';
        logger.error({ jobId, bot: assignment.botName }, 'Bot not available for building');
        return;
      }

      // Pause voyager loop so the bot doesn't wander off
      const voyager = instance.getVoyagerLoop();
      if (voyager) voyager.pause('building');

      // Stop any current pathfinding/movement
      try {
        instance.bot.pathfinder.stop();
        instance.bot.clearControlStates();
      } catch {}

      // Set creative mode so bot can't die during build, then teleport to site
      try {
        const opBot = (this.botManager.getAllWorkers() as any[]).find((b: any) => b.bot && b.name !== assignment.botName);
        const cmds = [
          `/gamemode creative ${assignment.botName}`,
          `/tp ${assignment.botName} ${job.origin.x} ${job.origin.y + 50} ${job.origin.z}`,
        ];
        for (const cmd of cmds) {
          if (opBot?.bot) opBot.bot.chat(cmd);
          instance.bot.chat(cmd);
          await this.sleep(500);
        }
        await this.sleep(1000);
        logger.info({ bot: assignment.botName }, 'Set creative mode and teleported to build site');
      } catch (e) {
        logger.warn({ bot: assignment.botName }, 'Failed to prepare bot for building');
      }

      // Set bot state to BUILDING
      instance.state = BotState.BUILDING;
      assignment.status = 'building';

      this.io.emit('build:bot-status', {
        jobId,
        botName: assignment.botName,
        status: 'building',
        yMin: assignment.yMin,
        yMax: assignment.yMax,
      });

      // Get blocks for this assignment's Y range
      const botBlocks = blocks.filter(
        (b) => b.localY >= assignment.yMin && b.localY <= assignment.yMax,
      );

      // Stagger start by 2s per bot to avoid overwhelming server
      if (i > 0) await new Promise((r) => setTimeout(r, i * 2000));

      try {
        await this.executeBotAssignment(jobId, job, assignment, instance.bot, botBlocks);
        assignment.status = 'completed';
      } catch (err: any) {
        assignment.status = 'failed';
        logger.error({ jobId, bot: assignment.botName, err: err.message }, 'Bot assignment failed');
      }

      // Switch back to survival and reset bot state
      try {
        instance.bot.chat(`/gamemode survival ${assignment.botName}`);
      } catch {}
      instance.state = BotState.IDLE;
      if (voyager) voyager.resume();

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

    // Cleanup cancellation tracking
    this.cancelledJobs.delete(jobId);
  }

  private async executeBotAssignment(
    jobId: string,
    job: BuildJob,
    assignment: BotAssignment,
    bot: any,
    blocks: BlockEntry[],
  ): Promise<void> {
    for (const block of blocks) {
      // Check cancellation
      if (this.cancelledJobs.has(jobId)) return;

      // Check pause — spin-wait with sleep
      while (this.pausedJobs.has(jobId)) {
        if (this.cancelledJobs.has(jobId)) return;
        await this.sleep(500);
      }

      // Place block using /setblock command
      const blockSpec = block.stateStr ? `${block.name}[${block.stateStr}]` : block.name;
      bot.chat(
        `/setblock ${block.wx} ${block.wy} ${block.wz} minecraft:${blockSpec} replace`,
      );

      // 250ms delay between blocks to avoid server spam kick
      await this.sleep(250);

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
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
