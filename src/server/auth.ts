import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Lightweight dashboard auth + plugin auth.
 *
 * Behavior:
 *  - `DASHBOARD_AUTH_SECRET` env var, when set, gates all `/api/*` routes
 *    except the explicit allowlist (`/api/auth/*`, `/api/health`, `/api/status`,
 *    `/api/events/*`) via `requireDashboardAuth`. When unset, auth is disabled
 *    (current behavior preserved — single-user local-dev case).
 *  - `PLUGIN_AUTH_TOKEN` env var, when set, gates `/api/events/*` via
 *    `requirePluginAuth`. When unset, the wide-open behavior is preserved.
 *
 * Cookies are parsed inline (no `cookie-parser` dependency) since we only
 * need to read one cookie name.
 */

const COOKIE_NAME = 'auth';
const COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

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
  if (bearer && bearer === secret) return true;
  const cookie = readCookie(req, COOKIE_NAME);
  if (cookie && cookie === secret) return true;
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
 * Build the Set-Cookie header value for the auth cookie. Always httpOnly,
 * samesite=lax, 30d max-age. `Secure` is added when the request looks like
 * it came over HTTPS (so plain-HTTP local dev still works).
 */
function buildAuthCookie(req: Request, value: string, clear: boolean): string {
  const parts: string[] = [];
  parts.push(`${COOKIE_NAME}=${encodeURIComponent(value)}`);
  parts.push('Path=/');
  parts.push('HttpOnly');
  parts.push('SameSite=Lax');
  if (clear) {
    parts.push('Max-Age=0');
  } else {
    parts.push(`Max-Age=${Math.floor(COOKIE_MAX_AGE_MS / 1000)}`);
  }
  const xfproto = req.headers['x-forwarded-proto'];
  const isHttps = req.secure || (typeof xfproto === 'string' && xfproto.split(',')[0].trim() === 'https');
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Register the three auth endpoints (`/api/auth/login`, `/api/auth/logout`,
 * `/api/auth/status`) on an Express app. These MUST be wired before the
 * `requireDashboardAuth` middleware so they remain reachable.
 */
export function registerAuthRoutes(app: import('express').Application): void {
  app.post('/api/auth/login', (req: Request, res: Response): void => {
    const secret = process.env.DASHBOARD_AUTH_SECRET;
    if (!secret) {
      // Auth disabled — login is a no-op success.
      res.json({ ok: true, enabled: false });
      return;
    }
    const provided = req.body?.secret;
    if (typeof provided !== 'string' || provided !== secret) {
      res.status(401).json({ error: 'invalid secret' });
      return;
    }
    res.setHeader('Set-Cookie', buildAuthCookie(req, secret, false));
    res.json({ ok: true });
  });

  app.post('/api/auth/logout', (req: Request, res: Response): void => {
    res.setHeader('Set-Cookie', buildAuthCookie(req, '', true));
    res.json({ ok: true });
  });

  app.get('/api/auth/status', (req: Request, res: Response): void => {
    res.json({
      enabled: isDashboardAuthEnabled(),
      authenticated: isDashboardAuthenticated(req),
      pluginAuthEnabled: isPluginAuthEnabled(),
    });
  });
}
