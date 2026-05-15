import type { Application, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import v8 from 'v8';
import { spawn } from 'child_process';
import { logger } from '../util/logger';

/**
 * Shutdown hook signature — the index.ts caller wires a function that flushes
 * persistent stores (token ledger, event log, supply chain, campaigns, affinity,
 * blackboard, etc.) before the process exits.
 */
export type AdminShutdownHook = () => Promise<void> | void;

export interface RegisterAdminOptions {
  /** Path to the log file to tail. Defaults to /tmp/dyobot.log per CLAUDE.md. */
  logPath?: string;
  /** Called before process.exit on graceful restart. */
  onRestart?: AdminShutdownHook;
}

/**
 * Register operational/admin API routes:
 *   GET  /api/admin/logs/stream   (SSE log tail)
 *   GET  /api/admin/backup        (tar.gz of data + skills + config)
 *   POST /api/admin/restart       (flush + process.exit, supervisor respawns)
 *   POST /api/admin/heap-snapshot (v8.writeHeapSnapshot)
 *   GET  /api/admin/info          (uptime, memory, bot count)
 *
 * These routes intentionally have NO auth — the auth-agent's middleware will
 * gate them naturally once that lands.
 */
export function registerAdminRoutes(
  app: Application,
  options: RegisterAdminOptions = {},
): void {
  const logPath = options.logPath ?? '/tmp/dyobot.log';

  // ── GET /api/admin/logs/stream — SSE log tail ────────────────────────────
  app.get('/api/admin/logs/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    let watcher: fs.FSWatcher | null = null;
    let lastSize = 0;
    let reading = false;
    let buffered = '';

    const sendLine = (line: string) => {
      if (closed) return;
      // SSE framing — replace any embedded newlines so each event is one record.
      const safe = line.replace(/\r?\n/g, ' ');
      res.write(`data: ${safe}\n\n`);
    };

    const sendComment = (text: string) => {
      if (closed) return;
      res.write(`: ${text}\n\n`);
    };

    const initialise = () => {
      try {
        if (fs.existsSync(logPath)) {
          const stat = fs.statSync(logPath);
          lastSize = stat.size;
        } else {
          lastSize = 0;
          sendComment(`log file ${logPath} does not exist yet — waiting`);
        }
      } catch (err: any) {
        sendComment(`stat failed: ${err?.message ?? String(err)}`);
        lastSize = 0;
      }
    };

    const readNew = async () => {
      if (closed || reading) return;
      reading = true;
      try {
        if (!fs.existsSync(logPath)) {
          lastSize = 0;
          return;
        }
        const stat = fs.statSync(logPath);
        if (stat.size < lastSize) {
          // File was truncated/rotated — read from start.
          lastSize = 0;
        }
        if (stat.size === lastSize) return;
        const stream = fs.createReadStream(logPath, {
          start: lastSize,
          end: stat.size - 1,
          encoding: 'utf8',
        });
        for await (const chunk of stream) {
          if (closed) return;
          buffered += chunk;
          let idx = buffered.indexOf('\n');
          while (idx !== -1) {
            const line = buffered.slice(0, idx);
            buffered = buffered.slice(idx + 1);
            if (line.length > 0) sendLine(line);
            idx = buffered.indexOf('\n');
          }
        }
        lastSize = stat.size;
      } catch (err: any) {
        sendComment(`read failed: ${err?.message ?? String(err)}`);
      } finally {
        reading = false;
      }
    };

    const startWatching = () => {
      try {
        watcher = fs.watch(logPath, { persistent: false }, () => {
          void readNew();
        });
        watcher.on('error', (err: any) => {
          sendComment(`watch error: ${err?.message ?? String(err)}`);
        });
      } catch (err: any) {
        sendComment(`watch failed: ${err?.message ?? String(err)}`);
      }
    };

    initialise();
    sendComment('connected');

    // Poll every 2s in addition to fs.watch — covers cases where the watcher
    // misses events (e.g. on certain filesystems or after rotation).
    const pollInterval = setInterval(() => {
      void readNew();
    }, 2000);

    // Keep-alive ping every 30s so proxies don't drop the connection.
    const pingInterval = setInterval(() => {
      sendComment('ping');
    }, 30000);

    if (fs.existsSync(logPath)) startWatching();

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(pollInterval);
      clearInterval(pingInterval);
      if (watcher) {
        try { watcher.close(); } catch { /* ignore */ }
        watcher = null;
      }
      try { res.end(); } catch { /* ignore */ }
    };

    req.on('close', cleanup);
    req.on('aborted', cleanup);
    res.on('error', cleanup);
  });

  // ── GET /api/admin/backup — streaming tar.gz of data + skills + config ───
  app.get('/api/admin/backup', (req: Request, res: Response) => {
    const cwd = process.cwd();
    const candidates = ['data', 'skills', 'config.yml', path.join('data', 'llm-settings.json')];
    // De-dup and filter to existing entries. `data` already covers
    // `data/llm-settings.json`, but the spec lists it explicitly so we
    // dedupe defensively rather than passing the same entry twice to tar.
    const seen = new Set<string>();
    const includes: string[] = [];
    for (const entry of candidates) {
      const abs = path.resolve(cwd, entry);
      if (seen.has(abs)) continue;
      // Skip child paths whose parent is already included.
      const parentIncluded = includes.some(
        (existing) => abs === path.resolve(cwd, existing) || abs.startsWith(path.resolve(cwd, existing) + path.sep),
      );
      if (parentIncluded) continue;
      if (fs.existsSync(abs)) {
        seen.add(abs);
        includes.push(entry);
      }
    }

    if (includes.length === 0) {
      res.status(404).json({ error: 'No backup sources found' });
      return;
    }

    const timestamp = new Date().toISOString().replace(/[.:]/g, '-');
    const filename = `dyobot-backup-${timestamp}.tar.gz`;
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const tarProc = spawn('tar', ['-czf', '-', ...includes], { cwd });
    let stderrBuf = '';
    tarProc.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
    });
    tarProc.on('error', (err) => {
      logger.error({ err: err.message }, 'tar process failed to spawn');
      if (!res.headersSent) {
        res.status(500).json({ error: `tar failed: ${err.message}` });
      } else {
        try { res.end(); } catch { /* ignore */ }
      }
    });
    tarProc.stdout.pipe(res);
    tarProc.on('close', (code) => {
      if (code !== 0) {
        logger.warn({ code, stderr: stderrBuf.slice(0, 500) }, 'tar exited non-zero');
        // Stream may already be partially flushed — best we can do is end.
        try { res.end(); } catch { /* ignore */ }
      }
    });
    req.on('close', () => {
      if (!tarProc.killed) {
        try { tarProc.kill('SIGTERM'); } catch { /* ignore */ }
      }
    });
  });

  // ── POST /api/admin/restart — flush stores, then process.exit(0) ─────────
  app.post('/api/admin/restart', async (_req: Request, res: Response) => {
    logger.warn('Admin restart requested via /api/admin/restart');
    res.status(202).json({ accepted: true, message: 'Server is restarting' });
    try {
      if (options.onRestart) {
        await options.onRestart();
      }
    } catch (err: any) {
      logger.error({ err: err?.message ?? String(err) }, 'onRestart hook threw');
    }
    setTimeout(() => {
      logger.warn('Process exiting now for restart — supervisor should respawn');
      process.exit(0);
    }, 200);
  });

  // ── POST /api/admin/heap-snapshot — v8.writeHeapSnapshot ─────────────────
  app.post('/api/admin/heap-snapshot', (_req: Request, res: Response) => {
    try {
      const snapshotDir = path.join(process.cwd(), 'diagnostics', 'heapsnapshots');
      if (!fs.existsSync(snapshotDir)) {
        fs.mkdirSync(snapshotDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[.:]/g, '-');
      const filePath = path.join(snapshotDir, `heap-manual-${timestamp}.heapsnapshot`);
      const written = v8.writeHeapSnapshot(filePath);
      logger.warn({ filePath: written }, 'Manual heap snapshot captured via /api/admin/heap-snapshot');
      res.json({ success: true, filePath: written });
    } catch (err: any) {
      logger.error({ err: err?.message ?? String(err) }, 'Failed to capture manual heap snapshot');
      res.status(500).json({ success: false, error: err?.message ?? String(err) });
    }
  });

  // ── GET /api/admin/info — basic process info for the sidebar ─────────────
  app.get('/api/admin/info', (_req: Request, res: Response) => {
    const mem = process.memoryUsage();
    res.json({
      uptimeSec: Math.round(process.uptime()),
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
      },
      logPath,
    });
  });
}
