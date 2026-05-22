import crypto from 'crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Config } from '../config';
import { logger } from '../util/logger';

/**
 * Followup #66 — Legacy auth fallback sunset.
 *
 * The Town's `requireMayor` (in `src/server/api.ts`) optionally accepts a
 * body-field `mayorPlayerName` when the URL carries `?legacyAuth=true`.
 * That fallback exists to give external scripts a migration window to adopt
 * the cookie-based session flow (POST /api/auth/login → signed `pid` cookie).
 *
 * After this date callers must use the session cookie; the legacy body-field
 * path will be removed entirely. Update CLAUDE.md ("Auth migration notes")
 * if this date changes.
 */
export const LEGACY_AUTH_SUNSET_DATE = '2026-08-15';

/**
 * Lightweight dashboard auth + plugin auth + player-identity session.
 *
 * Behavior:
 *  - `DASHBOARD_AUTH_SECRET` env var, when set, gates all `/api/*` routes
 *    except the explicit allowlist (`/api/auth/*`, `/api/health`, `/api/status`,
 *    `/api/events/*`) via `requireDashboardAuth`. When unset, auth is disabled
 *    (current behavior preserved — single-user local-dev case).
 *  - `PLUGIN_AUTH_TOKEN` env var, when set, gates `/api/events/*` via
 *    `requirePluginAuth`. When unset, the wide-open behavior is preserved.
 *  - Followup #58 — a separate player-identity session lives in the `pid`
 *    cookie. `POST /api/auth/login` accepts `{ playerName, secret }` and
 *    issues a signed `pid` cookie binding the request to that player.
 *    `getSessionPlayerName(req)` reads it back. The Town's `requireMayor`
 *    helper compares this to `town.config.mayor.playerName` instead of the
 *    old honor-system body field.
 *
 * Cookies are parsed inline (no `cookie-parser` dependency) since we only
 * need to read one cookie name.
 */

const COOKIE_NAME = 'auth';
const COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
/** Player-identity session cookie. Separate from the dashboard secret cookie. */
const PID_COOKIE_NAME = 'pid';
const PID_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/**
 * Per-process random fallback used to sign `pid` cookies when no devSecret is
 * configured. Replaces the previous hardcoded string `'dyobot-session-fallback'`,
 * which let anyone with the source forge a valid pid cookie. The new key is
 * regenerated each restart, so unauthenticated single-user local dev still
 * works but cookies don't survive a process restart (which is the safer
 * default — set `auth.devSecret` in config.yml for stable sessions).
 */
const FALLBACK_SIGNING_KEY = crypto.randomBytes(32).toString('hex');

/**
 * Constant-time comparison for secret-equality checks. Wraps
 * `crypto.timingSafeEqual` so length-mismatched inputs don't crash and
 * undefined operands return false. Use everywhere a `===` would compare
 * an attacker-controlled string against a server secret.
 */
function secretsEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ── Login rate limiter ────────────────────────────────────────────────
// Per-IP sliding window. Only failed attempts count. Successful logins
// neither increment nor clear (so a successful login under attack is
// still counted only against legitimate misuses). 5 failures / 15 min,
// 429 with Retry-After header above that.
const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_RATE_LIMIT_MAX_FAILURES = 5;
const loginFailures = new Map<string, number[]>();

function loginRateLimitState(ip: string): { allowed: true } | { allowed: false; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - LOGIN_RATE_LIMIT_WINDOW_MS;
  const attempts = (loginFailures.get(ip) ?? []).filter((t) => t > cutoff);
  if (attempts.length === 0) {
    loginFailures.delete(ip);
    return { allowed: true };
  }
  loginFailures.set(ip, attempts);
  if (attempts.length >= LOGIN_RATE_LIMIT_MAX_FAILURES) {
    const oldest = attempts[0];
    const retryAfterMs = oldest + LOGIN_RATE_LIMIT_WINDOW_MS - now;
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }
  return { allowed: true };
}

function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const cutoff = now - LOGIN_RATE_LIMIT_WINDOW_MS;
  const attempts = (loginFailures.get(ip) ?? []).filter((t) => t > cutoff);
  attempts.push(now);
  loginFailures.set(ip, attempts);
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const parts = header.split(';');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k !== name) continue;
    const v = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  }
  return undefined;
}

function readBearer(req: Request): string | undefined {
  const h = req.headers.authorization;
  if (!h || typeof h !== 'string') return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : undefined;
}

/**
 * True when the request carries a valid dashboard auth credential
 * (Bearer header OR the `auth` cookie). When `DASHBOARD_AUTH_SECRET`
 * is unset, this returns true unconditionally.
 */
export function isDashboardAuthenticated(req: Request): boolean {
  const secret = process.env.DASHBOARD_AUTH_SECRET;
  if (!secret) return true;
  const bearer = readBearer(req);
  if (bearer && secretsEqual(bearer, secret)) return true;
  const cookie = readCookie(req, COOKIE_NAME);
  if (cookie && secretsEqual(cookie, secret)) return true;
  return false;
}

/** True when `DASHBOARD_AUTH_SECRET` is set. */
export function isDashboardAuthEnabled(): boolean {
  return Boolean(process.env.DASHBOARD_AUTH_SECRET);
}

/** True when `PLUGIN_AUTH_TOKEN` is set. */
export function isPluginAuthEnabled(): boolean {
  return Boolean(process.env.PLUGIN_AUTH_TOKEN);
}

/** Paths under `/api` that bypass dashboard auth. */
const DASHBOARD_AUTH_EXEMPT_PREFIXES = [
  '/api/auth/',
  '/api/events/',
  '/api/health',
  '/api/status',
];

function isExemptPath(p: string): boolean {
  for (const prefix of DASHBOARD_AUTH_EXEMPT_PREFIXES) {
    if (p === prefix || p.startsWith(prefix)) return true;
    // Also handle the no-trailing-slash variant (e.g. `/api/auth`).
    if (prefix.endsWith('/') && p === prefix.slice(0, -1)) return true;
  }
  return false;
}

/**
 * Dashboard auth middleware. 401 on miss. No-op when secret is unset.
 * Exempts `/api/auth/*`, `/api/events/*`, `/api/health`, and `/api/status`.
 */
export const requireDashboardAuth: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!process.env.DASHBOARD_AUTH_SECRET) {
    next();
    return;
  }
  // `req.path` is relative to the mount point, so when this is mounted with
  // `app.use('/api', requireDashboardAuth)` we get e.g. `/bots`. Use the full
  // url instead for stable exempt-path matching.
  const fullPath = req.originalUrl.split('?')[0];
  if (isExemptPath(fullPath)) {
    next();
    return;
  }
  if (isDashboardAuthenticated(req)) {
    next();
    return;
  }
  res.status(401).json({ error: 'unauthorized' });
};

/**
 * Plugin auth middleware. Checks `X-Plugin-Token` header. 401 on miss.
 * No-op when `PLUGIN_AUTH_TOKEN` is unset.
 */
export const requirePluginAuth: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const token = process.env.PLUGIN_AUTH_TOKEN;
  if (!token) {
    next();
    return;
  }
  const provided = req.headers['x-plugin-token'];
  if (typeof provided === 'string' && provided === token) {
    next();
    return;
  }
  res.status(401).json({ error: 'plugin unauthorized' });
};

/**
 * Task #72 — dev-only endpoint gate.
 *
 * Returns true when the runtime is in "developer mode": either
 * `NODE_ENV === 'development'` OR `config.auth.devSecret` is set (via
 * `setAuthConfig`). When neither signal is present (production-secret-absent
 * mode), endpoints gated by `requireDev` should reject with 403.
 *
 * Intentionally separate from `isPlayerAuthEnforced` — that helper tracks
 * whether the player-login flow enforces a secret; this one tracks whether
 * we're permitted to expose dev-only conveniences like `/grant`.
 */
export function isDevModeEnabled(): boolean {
  if (process.env.NODE_ENV === 'development') return true;
  if (authConfig?.devSecret) return true;
  return false;
}

/**
 * Describe the dev-mode gate for inclusion in 403 responses. Useful so a
 * caller hitting `/grant` in production can see at a glance why it was
 * rejected without having to read the source.
 */
export function describeDevGate(): {
  enabled: boolean;
  nodeEnv: string | undefined;
  devSecretSet: boolean;
} {
  return {
    enabled: isDevModeEnabled(),
    nodeEnv: process.env.NODE_ENV,
    devSecretSet: Boolean(authConfig?.devSecret),
  };
}

/**
 * Middleware: rejects with 403 when neither dev-mode signal is present.
 * Mirrors the style of `requireDashboardAuth` / `requirePluginAuth`.
 * The 403 body includes the exact gating logic so the caller knows why.
 */
export const requireDev: RequestHandler = (
  _req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (isDevModeEnabled()) {
    next();
    return;
  }
  res.status(403).json({
    error: 'dev-mode required',
    message:
      "This endpoint is dev-only. Enable it by setting NODE_ENV='development' " +
      'OR configuring `auth.devSecret` in config.yml.',
    gate: describeDevGate(),
  });
};

/**
 * Build the Set-Cookie header value for the auth cookie. Always httpOnly,
 * samesite=lax, 30d max-age. `Secure` is added when the request looks like
 * it came over HTTPS (so plain-HTTP local dev still works).
 */
function buildAuthCookie(req: Request, value: string, clear: boolean): string {
  return buildCookie(req, COOKIE_NAME, value, clear, COOKIE_MAX_AGE_MS);
}

function buildCookie(
  req: Request,
  name: string,
  value: string,
  clear: boolean,
  maxAgeMs: number,
): string {
  const parts: string[] = [];
  parts.push(`${name}=${encodeURIComponent(value)}`);
  parts.push('Path=/');
  parts.push('HttpOnly');
  parts.push('SameSite=Lax');
  if (clear) {
    parts.push('Max-Age=0');
  } else {
    parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  }
  const xfproto = req.headers['x-forwarded-proto'];
  const isHttps = req.secure || (typeof xfproto === 'string' && xfproto.split(',')[0].trim() === 'https');
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

// ──────────────────────────────────────────────────────────────────────
//  Followup #58 — player-identity session
//
//  Separate from the dashboard secret cookie. Stores `playerName` in a
//  signed `pid` cookie. The signing key is derived from the config's
//  `auth.devSecret` (or the env var `DASHBOARD_AUTH_SECRET` if that's
//  not set), so an attacker can't mint cookies without the secret.
//
//  Session contract: `pid=<playerName>.<hmac>` — both pieces are needed
//  to validate. We reject any cookie whose HMAC doesn't match.
// ──────────────────────────────────────────────────────────────────────

let authConfig: { devSecret?: string | null } | null = null;

/** Wire the runtime config into the auth module. Idempotent. */
export function setAuthConfig(config: Pick<Config, 'auth'> | null | undefined): void {
  authConfig = (config?.auth as { devSecret?: string | null } | undefined) ?? null;
}

/**
 * Resolve the dev secret used to validate player logins. Order of
 * precedence: explicit env var `DASHBOARD_AUTH_DEV_SECRET` > `config.auth.devSecret`
 * > the dashboard secret env var > none.
 *
 * Returns null when no secret is configured at all — in that mode any
 * playerName logs in successfully (single-user local dev).
 */
function getDevSecret(): string | null {
  if (process.env.DASHBOARD_AUTH_DEV_SECRET) return process.env.DASHBOARD_AUTH_DEV_SECRET;
  if (authConfig?.devSecret) return String(authConfig.devSecret);
  if (process.env.DASHBOARD_AUTH_SECRET) return process.env.DASHBOARD_AUTH_SECRET;
  return null;
}

/** True when a dev secret is configured (player login enforces it). */
export function isPlayerAuthEnforced(): boolean {
  return getDevSecret() !== null;
}

/** Derive the signing key for the `pid` cookie HMAC. */
function getSessionSigningKey(): string {
  // Mix in a stable suffix so a leaked dev secret alone can't be used as a
  // session signing key for other purposes. When no devSecret is configured
  // we fall back to a per-process random key (FALLBACK_SIGNING_KEY) — the
  // previous hardcoded literal let anyone with the source forge cookies.
  const base = getDevSecret() ?? FALLBACK_SIGNING_KEY;
  return `${base}::pid`;
}

function signPid(playerName: string): string {
  const h = crypto.createHmac('sha256', getSessionSigningKey());
  h.update(playerName);
  return h.digest('hex').slice(0, 32);
}

function makePidValue(playerName: string): string {
  return `${playerName}.${signPid(playerName)}`;
}

function parsePidValue(value: string | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const dot = value.lastIndexOf('.');
  if (dot < 1 || dot >= value.length - 1) return null;
  const name = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = signPid(name);
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return name;
}

/**
 * Returns the playerName bound to the current request via the `pid`
 * cookie, or null when no valid session cookie is present.
 *
 * The Town's `requireMayor` helper uses this as the source of truth
 * for "is the caller the mayor of <town>?"
 */
export function getSessionPlayerName(req: Request): string | null {
  const raw = readCookie(req, PID_COOKIE_NAME);
  return parsePidValue(raw);
}

/**
 * Followup #66 — Legacy auth fallback detector.
 *
 * The Town's `requireMayor` helper (in `src/server/api.ts`) consults this
 * to decide whether to honor the legacy honor-system body field
 * `mayorPlayerName`. The fallback is gated on the URL query parameter
 * `?legacyAuth=true` and exists ONLY as a migration knob: any caller still
 * relying on it should switch to the session-cookie flow before the sunset
 * date (see `LEGACY_AUTH_SUNSET_DATE`).
 *
 * Behavior:
 *  - Returns true when the request carries `?legacyAuth=true`.
 *  - Emits a `warn` log line each time the legacy path is exercised, so
 *    production logs surface a clear "this is still happening" signal that
 *    we can grep for ahead of the sunset cutover.
 *
 * Migration path for callers: POST `/api/auth/login` with
 * `{ playerName, secret }` to mint a `pid` cookie, then drop the
 * `?legacyAuth=true` query param and the `mayorPlayerName` body field.
 */
export function isLegacyAuthRequested(req: Request): boolean {
  const requested = String((req.query as Record<string, unknown>)?.legacyAuth ?? '') === 'true';
  if (!requested) return false;

  // Followup #66 — past the sunset date the fallback is dead. Callers must
  // switch to the cookie-based session flow. We still log so production
  // can spot late-migrating callers.
  const sunsetMs = Date.parse(LEGACY_AUTH_SUNSET_DATE);
  if (Number.isFinite(sunsetMs) && Date.now() > sunsetMs) {
    logger.warn(
      {
        path: req.originalUrl?.split('?')[0] ?? req.path,
        sunsetDate: LEGACY_AUTH_SUNSET_DATE,
      },
      'auth: legacy ?legacyAuth=true REJECTED — sunset date has passed; caller must use /api/auth/login session cookie',
    );
    return false;
  }

  logger.warn(
    {
      path: req.originalUrl?.split('?')[0] ?? req.path,
      sunsetDate: LEGACY_AUTH_SUNSET_DATE,
    },
    'auth: legacy ?legacyAuth=true fallback exercised — caller should migrate to /api/auth/login session cookie',
  );
  return true;
}

function buildPidCookie(req: Request, value: string, clear: boolean): string {
  return buildCookie(req, PID_COOKIE_NAME, value, clear, PID_COOKIE_MAX_AGE_MS);
}

/**
 * Register the three auth endpoints (`/api/auth/login`, `/api/auth/logout`,
 * `/api/auth/status`) on an Express app. These MUST be wired before the
 * `requireDashboardAuth` middleware so they remain reachable.
 */
export function registerAuthRoutes(app: import('express').Application): void {
  app.post('/api/auth/login', (req: Request, res: Response): void => {
    const ip = req.ip || (req.socket.remoteAddress ?? 'unknown');

    // ── Rate limit: 5 failed attempts per IP per 15 min ───────────────
    const rl = loginRateLimitState(ip);
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfterSec));
      res.status(429).json({
        error: 'too many login attempts',
        retryAfterSec: rl.retryAfterSec,
      });
      return;
    }

    const body = (req.body ?? {}) as { secret?: unknown; playerName?: unknown };
    const provided = typeof body.secret === 'string' ? body.secret : undefined;
    const playerName = typeof body.playerName === 'string' ? body.playerName.trim() : '';

    // Set-Cookie can include multiple headers. We accumulate them so a
    // single login call can mint both the dashboard cookie AND the pid
    // cookie when appropriate.
    const cookies: string[] = [];

    // ── Dashboard-secret gate (legacy + dashboard auth) ──────────────
    const dashSecret = process.env.DASHBOARD_AUTH_SECRET;
    if (dashSecret) {
      if (!secretsEqual(provided, dashSecret)) {
        recordLoginFailure(ip);
        res.status(401).json({ error: 'invalid secret' });
        return;
      }
      cookies.push(buildAuthCookie(req, dashSecret, false));
    }

    // ── Followup #58: player-identity session ─────────────────────────
    // When a playerName is provided we attempt to mint a `pid` cookie.
    // A dev secret (config.auth.devSecret or env) is required when set;
    // when no secret is configured at all, any playerName succeeds
    // (local dev convenience).
    let player: string | null = null;
    if (playerName) {
      if (playerName.length > 64) {
        res.status(400).json({ error: 'playerName too long' });
        return;
      }
      const devSecret = getDevSecret();
      if (devSecret) {
        if (!secretsEqual(provided, devSecret)) {
          recordLoginFailure(ip);
          res.status(401).json({ error: 'invalid secret' });
          return;
        }
      }
      cookies.push(buildPidCookie(req, makePidValue(playerName), false));
      player = playerName;
    }

    if (cookies.length === 0 && !dashSecret) {
      // Auth disabled, no playerName supplied → preserve legacy behavior.
      res.json({ ok: true, enabled: false });
      return;
    }
    if (cookies.length > 0) {
      res.setHeader('Set-Cookie', cookies);
    }
    res.json({ ok: true, playerName: player });
  });

  app.post('/api/auth/logout', (req: Request, res: Response): void => {
    // Clear both the dashboard cookie and the player-identity cookie.
    res.setHeader('Set-Cookie', [
      buildAuthCookie(req, '', true),
      buildPidCookie(req, '', true),
    ]);
    res.json({ ok: true });
  });

  app.get('/api/auth/status', (req: Request, res: Response): void => {
    res.json({
      enabled: isDashboardAuthEnabled(),
      authenticated: isDashboardAuthenticated(req),
      pluginAuthEnabled: isPluginAuthEnabled(),
      playerAuthEnforced: isPlayerAuthEnforced(),
      playerName: getSessionPlayerName(req),
    });
  });

  // Followup #58 — convenience accessor for the frontend's "who am I?"
  app.get('/api/auth/me', (req: Request, res: Response): void => {
    res.json({ playerName: getSessionPlayerName(req) });
  });
}
