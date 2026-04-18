import { BotManager } from '../bot/BotManager';

export interface CrewSelectionOptions {
  /** Required number of bots */
  count: number;
  /** Bots that are off-limits (already assigned to another active job) */
  exclude?: Set<string>;
  /** Optional anchor point — pick bots closest to this position */
  near?: { x: number; y: number; z: number };
}

/** States that mean a bot is free to be assigned to a new build. */
const ELIGIBLE_STATES = new Set<string>(['IDLE', 'WANDERING']);

/**
 * Select a crew of idle bots from the manager's worker pool.
 *
 * Logic:
 *  1. Look at every `WorkerHandle`
 *  2. Reject dead workers, bots in `exclude`, and bots whose cached state is
 *     not IDLE / WANDERING.
 *  3. If `near` is set, sort by 3D distance from the bot's cached position.
 *  4. Return up to `count` names, or `[]` if fewer than `count` eligible.
 */
export function selectCrew(botManager: BotManager, opts: CrewSelectionOptions): string[] {
  const exclude = opts.exclude ?? new Set<string>();
  const workers = botManager.getAllWorkers();

  interface Candidate {
    name: string;
    distance: number;
  }
  const candidates: Candidate[] = [];

  for (const worker of workers) {
    if (typeof worker.isAlive === 'function' && !worker.isAlive()) continue;
    if (exclude.has(worker.botName)) continue;

    // Prefer detailed status if available, fall back to basic cached status.
    const detailed = typeof worker.getCachedDetailedStatus === 'function'
      ? worker.getCachedDetailedStatus()
      : null;
    const basic = typeof worker.getCachedStatus === 'function'
      ? worker.getCachedStatus()
      : null;
    const status = detailed ?? basic;

    const state = status?.state;
    if (!state || !ELIGIBLE_STATES.has(state)) continue;

    let distance = 0;
    if (opts.near) {
      const pos = status?.position ?? detailed?.position ?? basic?.position;
      if (pos && typeof pos.x === 'number' && typeof pos.y === 'number' && typeof pos.z === 'number') {
        const dx = pos.x - opts.near.x;
        const dy = pos.y - opts.near.y;
        const dz = pos.z - opts.near.z;
        distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      } else {
        // Bots without a known position sort to the end when a near-anchor is provided.
        distance = Number.POSITIVE_INFINITY;
      }
    }

    candidates.push({ name: worker.botName, distance });
  }

  if (opts.near) {
    candidates.sort((a, b) => a.distance - b.distance);
  }

  if (candidates.length < opts.count) return [];
  return candidates.slice(0, opts.count).map((c) => c.name);
}
