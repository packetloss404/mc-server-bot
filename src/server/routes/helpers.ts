/**
 * Shared route helpers, lifted out of api.ts (review: createAPIServer
 * decomposition) so the extracted per-domain route modules can use them
 * without importing back from api.ts (which would create an import cycle).
 */
import path from 'path';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Bot names become filenames (e.g. `data/<name>.json`) and worker-thread names;
// Minecraft usernames are `[A-Za-z0-9_]{3,16}` so we enforce that.
const BOT_NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
export function isSafeBotName(name: unknown): name is string {
  return typeof name === 'string' && BOT_NAME_RE.test(name);
}

// Filenames used in `path.join(dir, name)` — reject anything that would escape
// the directory (path separators, `..`, NUL bytes, etc.).
export function isSafeFilename(name: unknown): name is string {
  if (typeof name !== 'string' || name.length === 0 || name.length > 128) return false;
  if (name.includes('\0') || name.includes('..')) return false;
  return path.basename(name) === name;
}

/**
 * Wrap an async Express handler so a rejected promise is forwarded to the
 * error middleware instead of crashing the process.
 */
export const asyncH = (
  fn: (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>,
): RequestHandler => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Strip absolute file paths / stack-trace noise out of an error message before
 * returning it to the client, so server filesystem layout doesn't leak.
 */
export function sanitizeErrorMessage(input: unknown, fallback = 'Internal error'): string {
  const raw = input instanceof Error
    ? input.message
    : (typeof input === 'string' ? input : (input != null ? String(input) : ''));
  if (!raw) return fallback;
  let cleaned = raw.replace(/\/(?:[\w.@+-]+\/)+[\w.@+-]+/g, '<path>');
  cleaned = cleaned.split('\n')[0]!.trim();
  return cleaned || fallback;
}
