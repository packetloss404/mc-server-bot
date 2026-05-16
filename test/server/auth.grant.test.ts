/**
 * Task #72 — `POST /api/bots/:name/grant` dev-only item-seeding endpoint.
 *
 * Strategy mirrors `auth.dashboardSecret.test.ts`: spin up a fresh
 * `express()` per test, mount only what we need (the `requireDev`
 * middleware + the `createGrantHandler` factory) and hit it with Node's
 * built-in `http` client. No supertest dependency.
 *
 * Coverage:
 *  - dev-gate REJECTS in production-secret-absent mode (NODE_ENV !== 'development'
 *    AND no `auth.devSecret`).
 *  - dev-gate ALLOWS when NODE_ENV === 'development'.
 *  - dev-gate ALLOWS when `auth.devSecret` is configured.
 *  - normalizes `minecraft:cobblestone` and `cobblestone` to the same
 *    `/give <bot> minecraft:cobblestone <count>` chat command.
 *  - polls the worker's inventory and reports granted+missing arrays.
 *  - returns 207 when some items land and some don't.
 *  - includes the `hint` (likely-not-OP) when items fail to land.
 *  - returns 404 when the bot isn't connected.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';
import { requireDev, setAuthConfig } from '../../src/server/auth';
import { createGrantHandler, type GrantWorkerHandle } from '../../src/server/api';

interface JsonResponse {
  status: number;
  body: any;
}

function postJSON(port: number, path: string, payload: unknown): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
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
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * Stub WorkerHandle. Each call to `chat(/give ...)` schedules a
 * synthetic inventory bump after `landAfterMs` (default 50ms) so the
 * handler's poll observes the bump within its budget. Pass
 * `landAfterMs: Infinity` to simulate a not-opped bot that never gets
 * the items.
 */
function makeStubHandle(opts: {
  alive?: boolean;
  initialInventory?: Array<{ name: string; count: number }>;
  landAfterMs?: number;
  /** When true, returned chat lines are captured in `chats`. */
  chats?: string[];
} = {}): GrantWorkerHandle & {
  chats: string[];
  inventory: Array<{ name: string; count: number }>;
} {
  const inventory: Array<{ name: string; count: number }> = (
    opts.initialInventory ?? []
  ).map((s) => ({ ...s }));
  const chats: string[] = opts.chats ?? [];
  const landAfterMs = opts.landAfterMs ?? 50;

  const handle = {
    chats,
    inventory,
    isAlive: () => opts.alive !== false,
    chat: (message: string) => {
      chats.push(message);
      if (!Number.isFinite(landAfterMs)) return; // never lands (not opped)
      // Parse `/give <bot> minecraft:<name> <count>` and credit the
      // inventory after `landAfterMs` so the handler's poll sees the bump.
      const m = /^\/give\s+\S+\s+minecraft:(\S+)\s+(\d+)\s*$/.exec(message);
      if (!m) return;
      const name = m[1];
      const count = Number(m[2]);
      setTimeout(() => {
        const existing = inventory.find((s) => s.name === name);
        if (existing) existing.count += count;
        else inventory.push({ name, count, slot: inventory.length } as any);
      }, landAfterMs);
    },
    sendRequest: async (type: string) => {
      if (type === 'getDetailedStatus') {
        return { inventory: inventory.map((s) => ({ ...s })) };
      }
      throw new Error(`unexpected request type: ${type}`);
    },
    getCachedDetailedStatus: () => ({ inventory: inventory.map((s) => ({ ...s })) }),
  };
  return handle as any;
}

function startApp(opts: {
  worker?: GrantWorkerHandle | null;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}): Promise<{ port: number; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.post(
    '/api/bots/:name/grant',
    requireDev,
    createGrantHandler({
      getWorker: () => opts.worker ?? null,
      pollIntervalMs: opts.pollIntervalMs ?? 20,
      pollTimeoutMs: opts.pollTimeoutMs ?? 400,
    }),
  );
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

describe('POST /api/bots/:name/grant — Task #72', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    // Default to production-ish: no NODE_ENV=development, no devSecret.
    delete process.env.NODE_ENV;
    setAuthConfig(null);
  });

  afterEach(() => {
    if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    setAuthConfig(null);
  });

  it('rejects with 403 when neither NODE_ENV=development nor auth.devSecret is set', async () => {
    const handle = makeStubHandle();
    const app = await startApp({ worker: handle });
    try {
      const res = await postJSON(app.port, '/api/bots/Sam/grant', {
        items: [{ name: 'cobblestone', count: 64 }],
      });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: 'dev-mode required' });
      expect(res.body.gate).toMatchObject({
        enabled: false,
        devSecretSet: false,
      });
      // chat should NOT have been issued — the gate fires before the handler.
      expect(handle.chats).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('allows the call when NODE_ENV === "development" and grants items', async () => {
    process.env.NODE_ENV = 'development';
    const handle = makeStubHandle({ landAfterMs: 10 });
    const app = await startApp({ worker: handle });
    try {
      const res = await postJSON(app.port, '/api/bots/Sam/grant', {
        items: [{ name: 'cobblestone', count: 64 }],
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        granted: [{ name: 'cobblestone', count: 64 }],
        missing: [],
      });
      expect(handle.chats).toEqual(['/give Sam minecraft:cobblestone 64']);
    } finally {
      await app.close();
    }
  });

  it('allows the call when auth.devSecret is configured (no NODE_ENV)', async () => {
    setAuthConfig({ auth: { devSecret: 'shh' } });
    const handle = makeStubHandle({ landAfterMs: 10 });
    const app = await startApp({ worker: handle });
    try {
      const res = await postJSON(app.port, '/api/bots/Sam/grant', {
        items: [{ name: 'oak_log', count: 8 }],
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(handle.chats).toEqual(['/give Sam minecraft:oak_log 8']);
    } finally {
      await app.close();
    }
  });

  it('normalizes `minecraft:<name>` and `<name>` to the same /give command', async () => {
    process.env.NODE_ENV = 'development';
    const handle = makeStubHandle({ landAfterMs: 10 });
    const app = await startApp({ worker: handle });
    try {
      const res = await postJSON(app.port, '/api/bots/Sam/grant', {
        items: [
          { name: 'minecraft:cobblestone', count: 32 },
          { name: 'cobblestone', count: 16 },
        ],
      });
      expect(res.status).toBe(200);
      // Both should normalize to `minecraft:cobblestone`.
      expect(handle.chats).toEqual([
        '/give Sam minecraft:cobblestone 32',
        '/give Sam minecraft:cobblestone 16',
      ]);
      // Net delta is 48 cobblestone; granted array reflects what landed.
      const totalGranted = (res.body.granted as Array<{ name: string; count: number }>)
        .filter((g) => g.name === 'cobblestone')
        .reduce((acc, g) => acc + g.count, 0);
      expect(totalGranted).toBe(48);
    } finally {
      await app.close();
    }
  });

  it('returns 207 + hint when some items land and some do not (partial)', async () => {
    process.env.NODE_ENV = 'development';
    // Custom handle: cobblestone lands, but `super_unobtanium` never does
    // (simulated by intercepting just that item's chat).
    const chats: string[] = [];
    const inventory: Array<{ name: string; count: number }> = [];
    const handle: GrantWorkerHandle & { chats: string[] } = {
      chats,
      isAlive: () => true,
      chat: (message: string) => {
        chats.push(message);
        const m = /^\/give\s+\S+\s+minecraft:(\S+)\s+(\d+)/.exec(message);
        if (!m) return;
        const name = m[1];
        const count = Number(m[2]);
        if (name === 'super_unobtanium') return; // never appears
        setTimeout(() => {
          const existing = inventory.find((s) => s.name === name);
          if (existing) existing.count += count;
          else inventory.push({ name, count });
        }, 10);
      },
      sendRequest: async () => ({ inventory: inventory.map((s) => ({ ...s })) }),
      getCachedDetailedStatus: () => ({ inventory: inventory.map((s) => ({ ...s })) }),
    } as any;
    const app = await startApp({ worker: handle });
    try {
      const res = await postJSON(app.port, '/api/bots/Sam/grant', {
        items: [
          { name: 'cobblestone', count: 8 },
          { name: 'super_unobtanium', count: 1 },
        ],
      });
      expect(res.status).toBe(207);
      expect(res.body.success).toBe(false);
      expect(res.body.granted).toEqual([{ name: 'cobblestone', count: 8 }]);
      expect(res.body.missing).toEqual([{ name: 'super_unobtanium', count: 1 }]);
      expect(res.body.hint).toMatch(/not opped/i);
      expect(res.body.hint).toContain('/op Sam');
    } finally {
      await app.close();
    }
  });

  it('returns 404 when the bot is not connected', async () => {
    process.env.NODE_ENV = 'development';
    const app = await startApp({ worker: null });
    try {
      const res = await postJSON(app.port, '/api/bots/Ghost/grant', {
        items: [{ name: 'cobblestone', count: 1 }],
      });
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: expect.stringMatching(/not found/i) });
    } finally {
      await app.close();
    }
  });

  it('returns 400 when items is missing or empty', async () => {
    process.env.NODE_ENV = 'development';
    const handle = makeStubHandle();
    const app = await startApp({ worker: handle });
    try {
      const res1 = await postJSON(app.port, '/api/bots/Sam/grant', {});
      expect(res1.status).toBe(400);
      const res2 = await postJSON(app.port, '/api/bots/Sam/grant', { items: [] });
      expect(res2.status).toBe(400);
      const res3 = await postJSON(app.port, '/api/bots/Sam/grant', {
        items: [{ name: 'cobblestone', count: 0 }],
      });
      expect(res3.status).toBe(400);
      const res4 = await postJSON(app.port, '/api/bots/Sam/grant', {
        items: [{ name: '', count: 1 }],
      });
      expect(res4.status).toBe(400);
      // None of the validation failures should have issued chat commands.
      expect(handle.chats).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
