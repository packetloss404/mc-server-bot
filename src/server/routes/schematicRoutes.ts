/**
 * Schematic list/upload/metadata endpoints, extracted from createAPIServer
 * (review: api.ts decomposition). Registered via registerSchematicRoutes(app,
 * { buildCoordinator, schematicMatcher, schematicsDir }).
 */
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import type { Express, Request, Response } from 'express';
import type { BuildCoordinator } from '../../build/BuildCoordinator';
import type { SchematicMatcher } from '../../build/SchematicMatcher';
import { logger } from '../../util/logger';
import { isSafeFilename, sanitizeErrorMessage } from './helpers';

export function registerSchematicRoutes(
  app: Express,
  deps: { buildCoordinator: BuildCoordinator; schematicMatcher: SchematicMatcher; schematicsDir: string },
): void {
  const { buildCoordinator, schematicMatcher, schematicsDir } = deps;

  // List available schematics
  app.get('/api/schematics', async (_req: Request, res: Response) => {
    try {
      const schematics = await buildCoordinator.listSchematics();
      res.json({ schematics });
    } catch (err: any) {
      logger.error({ err }, 'Failed to list schematics');
      res.status(500).json({ error: err.message });
    }
  });

  // Upload a schematic file (multipart/form-data, field name "file").
  // Accepts .schem and .schematic only; cap at 10MB.
  const SCHEM_MAX_BYTES = 10 * 1024 * 1024;
  const schematicUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: SCHEM_MAX_BYTES, files: 1 },
  });
  app.post(
    '/api/schematics/upload',
    (req: Request, res: Response, next) => {
      schematicUpload.single('file')(req, res, (err: any) => {
        if (err) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            res.status(400).json({ error: `File too large; max ${SCHEM_MAX_BYTES} bytes` });
            return;
          }
          res.status(400).json({ error: err.message || 'Upload failed' });
          return;
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      try {
        const file = (req as any).file as Express.Multer.File | undefined;
        if (!file) {
          res.status(400).json({ error: 'No file uploaded (use field name "file")' });
          return;
        }
        // Sanitize: only allow extension + a safe basename. Strip directory components.
        const rawName = path.basename(file.originalname || '').replace(/[^a-zA-Z0-9._-]/g, '_');
        const ext = path.extname(rawName).toLowerCase();
        if (ext !== '.schem' && ext !== '.schematic') {
          res.status(400).json({ error: 'Only .schem or .schematic files are allowed' });
          return;
        }
        if (!rawName || rawName === ext) {
          res.status(400).json({ error: 'Invalid filename' });
          return;
        }
        const destPath = path.join(schematicsDir, rawName);
        if (!fs.existsSync(schematicsDir)) {
          fs.mkdirSync(schematicsDir, { recursive: true });
        }
        // Reject overwrite rather than risk a torn file under a concurrent read.
        if (fs.existsSync(destPath)) {
          res.status(409).json({ error: `Schematic '${rawName}' already exists. Delete it first if you want to replace it.` });
          return;
        }
        // Atomic write: .tmp then rename so readers see all-or-nothing.
        const tmpPath = `${destPath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
        fs.writeFileSync(tmpPath, file.buffer);
        fs.renameSync(tmpPath, destPath);
        schematicMatcher.refresh();
        const info = await buildCoordinator.getSchematicInfoAsync(rawName);
        res.status(201).json({
          schematic: info ?? { filename: rawName, size: { x: 0, y: 0, z: 0 }, blockCount: 0 },
        });
      } catch (err: any) {
        logger.error({ err: err?.message }, 'Schematic upload failed');
        res.status(500).json({ error: err?.message || 'Upload failed' });
      }
    },
  );

  // Get a single schematic's metadata
  app.get('/api/schematics/:filename', async (req: Request, res: Response) => {
    try {
      const filename = decodeURIComponent(req.params.filename as string);
      if (!isSafeFilename(filename)) {
        res.status(400).json({ error: 'invalid schematic filename' });
        return;
      }
      const info = await buildCoordinator.getSchematicInfoAsync(filename);
      if (!info) {
        res.status(404).json({ error: 'Schematic not found' });
        return;
      }
      res.json({ schematic: info });
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to fetch schematic');
      res.status(500).json({ error: sanitizeErrorMessage(err, 'Failed to fetch schematic') });
    }
  });
}
