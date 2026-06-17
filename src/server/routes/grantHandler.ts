/**
 * POST /api/bots/:name/grant handler factory, lifted out of api.ts (review:
 * createAPIServer decomposition) so the bots route module can use it without an
 * import cycle. Re-exported from api.ts for back-compat (auth.grant.test.ts).
 */
import type { Request, Response } from 'express';

export interface GrantWorkerHandle {
  isAlive(): boolean;
  chat(message: string): void;
  sendRequest(type: string, args?: unknown[]): Promise<any>;
  getCachedDetailedStatus?(): { inventory?: Array<{ name: string; count: number }> } | null;
}

export interface GrantHandlerDeps {
  /** Resolve a bot name to a worker handle, or null/undefined when not found. */
  getWorker(name: string): GrantWorkerHandle | null | undefined;
  /** Override for the poll interval (default 200ms). Tests use a tiny value. */
  pollIntervalMs?: number;
  /** Override for the total poll budget (default 3000ms). Tests use a tiny value. */
  pollTimeoutMs?: number;
}

/**
 * Builds the express handler for `POST /api/bots/:name/grant`.
 *
 * Behavior:
 *  - Validates `items` is a non-empty array of `{ name: string, count: int }`.
 *  - Normalizes item names by stripping any `namespace:` prefix so callers
 *    can pass either `cobblestone` or `minecraft:cobblestone`.
 *  - Issues `/give <botName> minecraft:<name> <count>` per item via the
 *    worker handle's `chat()` method.
 *  - Polls the inventory (200ms x 15 = ~3s) to see which items actually
 *    landed; returns granted/missing arrays so the caller knows what worked.
 *  - 200 on full success, 207 on partial, 502 on nothing-landed, 400 on
 *    validation error, 404 when the bot isn't alive.
 *  - Adds a `hint` field to the body when items fail to appear — the most
 *    likely cause is that the bot isn't opped on the server.
 *
 * Caveat: this endpoint wraps the in-game `/give` command, so the bot must
 * be opped server-side. The endpoint deliberately does NOT op anyone.
 */
export function createGrantHandler(deps: GrantHandlerDeps) {
  const pollIntervalMs = deps.pollIntervalMs ?? 200;
  const pollTimeoutMs = deps.pollTimeoutMs ?? 3000;

  return async (req: Request, res: Response): Promise<void> => {
    const { items } = (req.body ?? {}) as {
      items?: Array<{ name?: unknown; count?: unknown }>;
    };
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({
        error: 'items must be a non-empty array of { name, count }',
      });
      return;
    }

    // Normalize + validate every item up-front so we never half-issue /give.
    const normalized: Array<{ name: string; count: number }> = [];
    for (const it of items) {
      const rawName = typeof it.name === 'string' ? it.name.trim() : '';
      const count = Number(it.count);
      if (!rawName) {
        res.status(400).json({ error: 'each item requires a string name' });
        return;
      }
      if (!Number.isFinite(count) || count <= 0 || !Number.isInteger(count)) {
        res.status(400).json({
          error: `item '${rawName}' requires a positive integer count`,
        });
        return;
      }
      // Strip an optional `minecraft:` (or any namespace:) prefix so callers
      // can pass either shape. Critical: the in-game /give command REQUIRES
      // the `minecraft:` prefix, so we always re-add it on the way out.
      const colon = rawName.indexOf(':');
      const name = colon >= 0 ? rawName.slice(colon + 1) : rawName;
      if (!name) {
        res.status(400).json({
          error: `item name '${rawName}' is empty after normalization`,
        });
        return;
      }
      normalized.push({ name, count });
    }

    const botName = req.params.name as string;
    const handle = deps.getWorker(botName);
    if (!handle || !handle.isAlive()) {
      res.status(404).json({ error: 'Bot not found or not connected' });
      return;
    }
    if (typeof handle.chat !== 'function') {
      res.status(500).json({ error: 'Bot handle does not support chat' });
      return;
    }

    // Snapshot the inventory before issuing /give so we can attribute each
    // delta to this grant call (vs items the bot already had).
    const snapshotCounts = (
      inv: Array<{ name: string; count: number }> | undefined,
    ): Record<string, number> => {
      const map: Record<string, number> = {};
      if (!Array.isArray(inv)) return map;
      for (const stack of inv) {
        if (!stack || typeof stack.name !== 'string') continue;
        map[stack.name] = (map[stack.name] ?? 0) + (Number(stack.count) || 0);
      }
      return map;
    };

    // Force a fresh detailed-status pull so the baseline isn't off-by-a-tick
    // from the periodic push. Falls back to cached status on IPC failure.
    const fetchInventory = async (): Promise<Array<{ name: string; count: number }>> => {
      try {
        const fresh = await handle.sendRequest('getDetailedStatus', []);
        if (fresh && Array.isArray(fresh.inventory)) return fresh.inventory;
      } catch {
        // fall through to cached
      }
      const cached = handle.getCachedDetailedStatus?.();
      return Array.isArray(cached?.inventory) ? cached!.inventory! : [];
    };

    const baselineCounts = snapshotCounts(await fetchInventory());

    // Issue one `/give` per item. The bot's chat channel queues these
    // server-side; mineflayer typically delivers them within ~50ms each.
    for (const { name, count } of normalized) {
      handle.chat(`/give ${botName} minecraft:${name} ${count}`);
    }

    // Poll the inventory for up to ~pollTimeoutMs (in pollIntervalMs steps)
    // to see what landed. Stop early once every expected delta is reached.
    const deadline = Date.now() + pollTimeoutMs;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    const remaining = new Map<string, number>();
    for (const { name, count } of normalized) {
      remaining.set(name, (remaining.get(name) ?? 0) + count);
    }

    let granted: Record<string, number> = {};
    do {
      await sleep(pollIntervalMs);
      const currentCounts = snapshotCounts(await fetchInventory());
      granted = {};
      let allLanded = true;
      for (const [name, target] of remaining.entries()) {
        const delta = (currentCounts[name] ?? 0) - (baselineCounts[name] ?? 0);
        granted[name] = Math.max(0, Math.min(delta, target));
        if (granted[name] < target) allLanded = false;
      }
      if (allLanded) break;
    } while (Date.now() < deadline);

    // Aggregate by item name in the response — when the caller passes
    // multiple entries for the same item, the response collapses them so
    // counts aren't double-reported.
    const grantedArr: Array<{ name: string; count: number }> = [];
    const missingArr: Array<{ name: string; count: number }> = [];
    for (const [name, target] of remaining.entries()) {
      const got = granted[name] ?? 0;
      if (got > 0) grantedArr.push({ name, count: got });
      if (got < target) missingArr.push({ name, count: target - got });
    }

    const payload: {
      success: boolean;
      granted: Array<{ name: string; count: number }>;
      missing: Array<{ name: string; count: number }>;
      hint?: string;
    } = {
      success: missingArr.length === 0,
      granted: grantedArr,
      missing: missingArr,
    };
    if (missingArr.length > 0) {
      payload.hint =
        `Some items did not appear in ${botName}'s inventory within ` +
        `${pollTimeoutMs}ms. The most likely cause is that the bot is not ` +
        `opped on the server (/give requires OP). Verify with \`/op ${botName}\` ` +
        'in the server console.';
    }

    // 200 when everything landed, 207 when partial, 502 when nothing landed
    // at all (chat went out but no items materialized).
    let status = 200;
    if (grantedArr.length === 0) status = 502;
    else if (missingArr.length > 0) status = 207;
    res.status(status).json(payload);
  };
}
