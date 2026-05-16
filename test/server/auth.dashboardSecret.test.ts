/**
 * Followup #69 — integration test for the dashboard-secret-only login path.
 *
 * Phase 9 (followup #58) added a second cookie (`pid` — player identity)
 * to `POST /api/auth/login` alongside the legacy `auth` (dashboard secret)
 * cookie. This test pins the legacy single-secret path so a regression
 * can't silently break dashboards that authenticate with just the
 * dashboard secret (no playerName).
 *
 * Coverage:
 *   1. DASHBOARD_AUTH_SECRET set + correct secret + no playerName
 *      → 200, sets `auth` cookie, does NOT set `pid` cookie.
 *   2. DASHBOARD_AUTH_SECRET set + wrong secret → 401.
 *   3. DASHBOARD_AUTH_SECRET unset → succeeds, no auth cookie required.
 *   4. DASHBOARD_AUTH_SECRET set + correct secret + playerName → sets BOTH
 *      cookies.
 *
 * Strategy: spin up a fresh `express()` app per test, mount the auth
 * routes via `registerAuthRoutes`, and hit it with a hand-rolled HTTP
 * client using Node's built-in `http` module. No supertest dependency
 * (it isn't in the repo). Each test cleans the env var afterwards so
 * the tests don't pollute each other.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';
import { registerAuthRoutes, setAuthConfig } from '../../src/server/auth';

interface LoginResponse {
  status: number;
  body: any;
  setCookies: string[];
}

/** Hand-rolled fetch — we only need POST JSON + raw Set-Cookie headers. */
function postLogin(port: number, payload: Record<string, unknown>): Promise<LoginResponse> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/auth/login',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(data),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let body: any = null;
          try {
            body = raw ? JSON.parse(raw) : null;
          } catch {
            body = raw;
          }
          const setCookieHeader = res.headers['set-cookie'];
          const setCookies = Array.isArray(setCookieHeader)
            ? setCookieHeader
            : setCookieHeader
            ? [setCookieHeader]
            : [];
          resolve({ status: res.statusCode ?? 0, body, setCookies });
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function startApp(): Promise<{ port: number; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  registerAuthRoutes(app);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo | null;
      if (!addr) {
        reject(new Error('failed to bind ephemeral port'));
        return;
      }
      resolve({
        port: addr.port,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}

function hasCookieNamed(setCookies: string[], name: string): boolean {
  // The buildCookie helper emits `<name>=<value>; Path=/; ...`. A logout
  // produces the same name with `Max-Age=0`. A "set" is any line whose
  // first key matches `name` AND whose Max-Age is non-zero.
  for (const line of setCookies) {
    const firstSegment = line.split(';')[0];
    const eq = firstSegment.indexOf('=');
    if (eq < 0) continue;
    const k = firstSegment.slice(0, eq).trim();
    if (k !== name) continue;
    if (/Max-Age=0(?:;|$)/i.test(line)) continue; // explicit clear, not a "set"
    return true;
  }
  return false;
}

describe('POST /api/auth/login — dashboard-secret-only path (followup #69)', () => {
  let app: { port: number; close: () => Promise<void> };
  const ORIGINAL_DASH_SECRET = process.env.DASHBOARD_AUTH_SECRET;
  const ORIGINAL_DEV_SECRET = process.env.DASHBOARD_AUTH_DEV_SECRET;

  beforeEach(async () => {
    // Wipe env between tests so the four cases are truly independent.
    delete process.env.DASHBOARD_AUTH_SECRET;
    delete process.env.DASHBOARD_AUTH_DEV_SECRET;
    setAuthConfig(null);
    app = await startApp();
  });

  afterEach(async () => {
    await app.close();
    if (ORIGINAL_DASH_SECRET === undefined) delete process.env.DASHBOARD_AUTH_SECRET;
    else process.env.DASHBOARD_AUTH_SECRET = ORIGINAL_DASH_SECRET;
    if (ORIGINAL_DEV_SECRET === undefined) delete process.env.DASHBOARD_AUTH_DEV_SECRET;
    else process.env.DASHBOARD_AUTH_DEV_SECRET = ORIGINAL_DEV_SECRET;
  });

  it('with DASHBOARD_AUTH_SECRET set + correct secret + no playerName: sets auth, not pid', async () => {
    process.env.DASHBOARD_AUTH_SECRET = 'topsecret';

    const res = await postLogin(app.port, { secret: 'topsecret' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(hasCookieNamed(res.setCookies, 'auth')).toBe(true);
    expect(hasCookieNamed(res.setCookies, 'pid')).toBe(false);
  });

  it('with DASHBOARD_AUTH_SECRET set + wrong secret: returns 401', async () => {
    process.env.DASHBOARD_AUTH_SECRET = 'topsecret';

    const res = await postLogin(app.port, { secret: 'WRONG' });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'invalid secret' });
    expect(hasCookieNamed(res.setCookies, 'auth')).toBe(false);
    expect(hasCookieNamed(res.setCookies, 'pid')).toBe(false);
  });

  it('with DASHBOARD_AUTH_SECRET unset: login succeeds without any secret check (single-user dev)', async () => {
    // No env var set → the dashboard-secret gate is fully bypassed and the
    // body's `secret` field is irrelevant.
    const res = await postLogin(app.port, {});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, enabled: false });
    expect(hasCookieNamed(res.setCookies, 'auth')).toBe(false);
    expect(hasCookieNamed(res.setCookies, 'pid')).toBe(false);
  });

  it('with DASHBOARD_AUTH_SECRET + playerName + correct secret: sets BOTH cookies', async () => {
    process.env.DASHBOARD_AUTH_SECRET = 'topsecret';

    const res = await postLogin(app.port, {
      secret: 'topsecret',
      playerName: 'Steve',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, playerName: 'Steve' });
    expect(hasCookieNamed(res.setCookies, 'auth')).toBe(true);
    expect(hasCookieNamed(res.setCookies, 'pid')).toBe(true);
  });
});
