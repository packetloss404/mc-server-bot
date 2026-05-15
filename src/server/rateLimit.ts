import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Simple in-memory token-bucket rate limiter keyed by `req.ip`.
 *
 * - Each IP gets its own bucket with `capacity` tokens.
 * - Tokens refill at `refillPerSec` per second, capped at `capacity`.
 * - Each request costs 1 token. If the bucket is empty, respond 429 with
 *   a `Retry-After` header (whole seconds, rounded up).
 *
 * Buckets are stored in-memory and garbage-collected lazily — entries
 * untouched for >5 minutes are dropped on next access. This is sufficient
 * for the local-network deployment this is built for; if we ever serve a
 * larger audience, swap for a shared-store implementation.
 */

export interface RateLimitOptions {
  capacity: number;
  refillPerSec: number;
}

interface Bucket {
  tokens: number;
  updated: number; // ms epoch
}

const BUCKET_TTL_MS = 5 * 60 * 1000;

export function rateLimit(opts: RateLimitOptions): RequestHandler {
  const { capacity, refillPerSec } = opts;
  if (!(capacity > 0) || !(refillPerSec > 0)) {
    throw new Error('rateLimit: capacity and refillPerSec must be positive');
  }
  const buckets = new Map<string, Bucket>();
  let lastGc = Date.now();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    // Lazy GC every minute or so to keep the map bounded.
    if (now - lastGc > 60_000) {
      for (const [k, b] of buckets) {
        if (now - b.updated > BUCKET_TTL_MS) buckets.delete(k);
      }
      lastGc = now;
    }

    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: capacity, updated: now };
      buckets.set(key, bucket);
    } else {
      const elapsedSec = (now - bucket.updated) / 1000;
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillPerSec);
      bucket.updated = now;
    }

    if (bucket.tokens < 1) {
      const need = 1 - bucket.tokens;
      const retryAfterSec = Math.max(1, Math.ceil(need / refillPerSec));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({ error: 'rate limit exceeded' });
      return;
    }

    bucket.tokens -= 1;
    next();
  };
}
