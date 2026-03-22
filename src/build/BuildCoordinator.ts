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
  pos: Vec3;
  name: string;
  properties: Record<string, string>;
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
    const bots = this.botManager.getAllBots();
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
        const info = await this.getSchematicInfoAsync(filename);
        if (info) results.push(info);
      } catch (err: any) {
        logger.warn({ filename, err: err.message }, 'Failed to read schematic metadata');
        results.push({ filename, size: { x: 0, y: 0, z: 0 }, blockCount: 0 });
      }
    }
    return results;
  }

  async getSchematicInfoAsync(filename: string): Promise<SchematicInfo | null> {
    const { Schematic } = require('prismarine-schematic');
    const fullPath = path.join(this.schematicsDir, filename);

    if (!fs.existsSync(fullPath)) return null;

    const buffer = fs.readFileSync(fullPath);
    const schematic = await Schematic.read(buffer, this.getBotVersion());
    const size = schematic.size;
    const start = schematic.start();
    const end = schematic.end();

    let blockCount = 0;
    for (let y = start.y; y <= end.y; y++) {
      for (let z = start.z; z <= end.z; z++) {
        for (let x = start.x; x <= end.x; x++) {
          const block = schematic.getBlock(new Vec3(x, y, z));
          if (block && block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air') {
            blockCount++;
          }
        }
      }
    }

    return { filename, size: { x: size.x, y: size.y, z: size.z }, blockCount };
  }

  // ── Build job management ────────────────────────────────

  async startBuild(
    schematicFile: string,
    origin: { x: number; y: number; z: number },
    botNames: string[],
  ): Promise<BuildJob> {
    const { Schematic } = require('prismarine-schematic');
    const fullPath = path.join(this.schematicsDir, schematicFile);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Schematic file not found: ${schematicFile}`);
    }

    // Validate bots exist and are connected
    for (const name of botNames) {
      const instance = this.botManager.getBot(name);
      if (!instance) throw new Error(`Bot not found: ${name}`);
      if (!instance.bot) throw new Error(`Bot not connected: ${name}`);
    }

    // Load schematic
    const buffer = fs.readFileSync(fullPath);
    const schematic = await Schematic.read(buffer);
    const basePos = new Vec3(origin.x, origin.y, origin.z);
    const start = schematic.start();
    const end = schematic.end();

    // Collect all non-air blocks sorted by Y
    const blocks: BlockEntry[] = [];
    for (let y = start.y; y <= end.y; y++) {
      for (let z = start.z; z <= end.z; z++) {
        for (let x = start.x; x <= end.x; x++) {
          const localPos = new Vec3(x, y, z);
          const block = schematic.getBlock(localPos);
          if (block && block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air') {
            blocks.push({
              pos: basePos.plus(localPos).minus(start),
              name: block.name,
              properties: block.getProperties ? block.getProperties() : {},
              localY: y - start.y,
            });
          }
        }
      }
    }

    if (blocks.length === 0) {
      throw new Error('Schematic contains no blocks');
    }

    // Determine Y range
    const minLocalY = 0;
    const maxLocalY = end.y - start.y;
    const totalYLayers = maxLocalY - minLocalY + 1;

    // Partition Y layers across bots
    const layersPerBot = Math.ceil(totalYLayers / botNames.length);
    const assignments: BotAssignment[] = botNames.map((botName, idx) => {
      const yMin = minLocalY + idx * layersPerBot;
      const yMax = Math.min(yMin + layersPerBot - 1, maxLocalY);
      const botBlocks = blocks.filter((b) => b.localY >= yMin && b.localY <= yMax);
      return {
        botName,
        yMin,
        yMax,
        status: idx === 0 ? 'waiting' : 'waiting',
        blocksTotal: botBlocks.length,
        blocksPlaced: 0,
        currentY: yMin,
      } as BotAssignment;
    });

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
    };

    this.jobs.set(jobId, job);

    // Emit started event
    this.io.emit('build:started', { job });
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
      this.io.emit('build:completed', { job, error: err.message });
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
        const instance = this.botManager.getBot(assignment.botName);
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

    // Execute each assignment sequentially (bottom bot first, then next waits)
    for (let i = 0; i < assignments.length; i++) {
      const assignment = assignments[i];

      // Check for cancellation before starting this bot
      if (this.cancelledJobs.has(jobId)) return;

      // If not the first bot, the previous bot must be completed
      if (i > 0) {
        const prev = assignments[i - 1];
        if (prev.status !== 'completed') {
          assignment.status = 'failed';
          logger.warn(
            { jobId, bot: assignment.botName },
            'Previous bot did not complete; skipping',
          );
          continue;
        }
      }

      // Get the mineflayer bot instance
      const instance = this.botManager.getBot(assignment.botName);
      if (!instance || !instance.bot) {
        assignment.status = 'failed';
        logger.error({ jobId, bot: assignment.botName }, 'Bot not available for building');
        continue;
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

      try {
        await this.executeBotAssignment(jobId, job, assignment, instance.bot, botBlocks);
        assignment.status = 'completed';
      } catch (err: any) {
        assignment.status = 'failed';
        logger.error({ jobId, bot: assignment.botName, err: err.message }, 'Bot assignment failed');
      }

      // Reset bot state
      instance.state = BotState.IDLE;

      this.io.emit('build:bot-status', {
        jobId,
        botName: assignment.botName,
        status: assignment.status,
        blocksPlaced: assignment.blocksPlaced,
      });
    }

    // Final status
    if (!this.cancelledJobs.has(jobId)) {
      const allCompleted = assignments.every((a) => a.status === 'completed');
      job.status = allCompleted ? 'completed' : 'failed';

      this.io.emit('build:completed', { job });
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

      // Build the block state string (mirrors buildSchematic.ts lines 94-98)
      const stateStr = Object.entries(block.properties)
        .map(([k, v]) => `${k}=${v}`)
        .join(',');
      const blockSpec = stateStr ? `${block.name}[${stateStr}]` : block.name;

      // Place block using /setblock command
      bot.chat(
        `/setblock ${block.pos.x} ${block.pos.y} ${block.pos.z} minecraft:${blockSpec} replace`,
      );

      // 50ms delay between blocks
      await this.sleep(50);

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
