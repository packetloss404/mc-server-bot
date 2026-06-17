/**
 * Skill library endpoints (list/stats/get/edit/delete), extracted from
 * createAPIServer (review: api.ts decomposition). Fully filesystem-backed
 * (skills/index.json + per-skill .js), so it takes no dependency object — just
 * registerSkillRoutes(app). Keeps its own mtime-keyed list cache.
 */
import fs from 'fs';
import path from 'path';
import type { Express, Request, Response } from 'express';
import { atomicWriteJsonSync, atomicWriteTextSync } from '../../util/atomicWrite';
import { logger } from '../../util/logger';

export function registerSkillRoutes(app: Express): void {
  // mtime-keyed cache for GET /api/skills; invalidated by writeSkillIndex.
  let skillsCache: { mtimeMs: number; payload: { skills: any[]; count: number } } | null = null;

  app.get('/api/skills', (_req: Request, res: Response) => {
    try {
      const indexPath = path.join(process.cwd(), 'skills', 'index.json');
      if (!fs.existsSync(indexPath)) {
        res.json({ skills: [], count: 0 });
        return;
      }
      const indexMtime = fs.statSync(indexPath).mtimeMs;
      if (skillsCache && skillsCache.mtimeMs === indexMtime) {
        res.json(skillsCache.payload);
        return;
      }
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      const entries: any[] = Array.isArray(index) ? index : Object.values(index);
      const skills = entries.map((entry: any) => {
        const name: string = entry?.name ?? '';
        const fileName: string = entry?.file ?? `${name}.js`;
        const skillPath = path.join(process.cwd(), 'skills', fileName);
        const code = fs.existsSync(skillPath) ? fs.readFileSync(skillPath, 'utf-8').slice(0, 2000) : null;
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
      skillsCache = { mtimeMs: indexMtime, payload };
      res.json(payload);
    } catch {
      res.json({ skills: [], count: 0 });
    }
  });

  // Registered before /api/skills/:name so 'stats' isn't matched as a skill name.
  app.get('/api/skills/stats', (_req: Request, res: Response) => {
    try {
      const indexPath = path.join(process.cwd(), 'skills', 'index.json');
      if (!fs.existsSync(indexPath)) {
        res.json({ total: 0, totalSuccesses: 0, totalFailures: 0, averageQuality: 0, topPerformers: [], topFailures: [], neverUsed: 0 });
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
        if (quality !== null) { qualitySum += quality; qualityCount += 1; }
        if (successCount === 0 && failureCount === 0) neverUsed += 1;
        return { name: entry?.name ?? '', description: entry?.description ?? null, successCount, failureCount, quality };
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

  app.get('/api/skills/:name', (req: Request, res: Response) => {
    const skillName = req.params.name as string;
    // Path-traversal guard: req.params is URL-decoded.
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

  // ── Helpers for PUT/DELETE — load/save index.json without disturbing
  //    per-skill metadata (embeddings, success counts) we don't own. ──
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
    skillsCache = null; // invalidate the GET /api/skills cache
  };

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
}
