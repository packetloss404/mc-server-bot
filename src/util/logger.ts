import pino from 'pino';
import type { Logger } from 'pino';
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';

function getConfigLogLevel(): string {
  try {
    const configPath = path.join(process.cwd(), 'config.yml');
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = yaml.load(raw) as any;
    if (config?.logging?.level) {
      return config.logging.level;
    }
  } catch {
    // Config not available yet — fall back to env or default
  }
  return process.env.LOG_LEVEL || 'info';
}

// pino-pretty defaults to sync writes; force async (`sync: false`) so heavy
// serialization on high-frequency events doesn't block the event loop. Pino
// transports already run in a worker thread, so the transport layer is async
// too. Production logs are captured via systemd's StandardOutput, so stdout
// behaviour is preserved — only the per-write sync flag changes.
export const logger: Logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      sync: false,
    },
  },
  level: getConfigLogLevel(),
});

/**
 * A subset of the pino logger surface intended for sampled, low-severity
 * call-sites. Only the non-fatal levels are exposed so sampling cannot
 * accidentally drop error/warn/fatal events.
 */
export interface SampledLogger {
  trace: Logger['trace'];
  debug: Logger['debug'];
  info: Logger['info'];
}

/**
 * Returns a wrapper that forwards `trace`/`debug`/`info` calls to the shared
 * `logger` at the given probability. `rate=1` always logs; `rate=0` never
 * logs; `rate=0.02` logs roughly 1 in 50 calls. Useful for hot paths
 * (pathfinder ticks, position updates) where full logging would flood.
 *
 * The wrapper intentionally does not expose `warn`/`error`/`fatal` — those
 * should always log unconditionally.
 */
export function loggerSampled(rate: number): SampledLogger {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(rate) ? rate : 0));
  const shouldEmit = (): boolean => {
    if (clamped <= 0) return false;
    if (clamped >= 1) return true;
    return Math.random() < clamped;
  };
  const wrap = <L extends 'trace' | 'debug' | 'info'>(level: L): Logger[L] => {
    const fn = ((...args: unknown[]) => {
      if (!shouldEmit()) return;
      // pino's level methods accept varied overload shapes; forward as-is.
      (logger[level] as (...a: unknown[]) => void)(...args);
    }) as unknown as Logger[L];
    return fn;
  };
  return {
    trace: wrap('trace'),
    debug: wrap('debug'),
    info: wrap('info'),
  };
}

/**
 * Masks the middle of a secret-like string so it can be safely logged.
 *
 * Keeps a short prefix and suffix visible to aid debugging (e.g. matching
 * against a known key fragment) and replaces the middle with `***`.
 *
 * Examples:
 * - `redactSecret('sk-abcd1234xR_x')` → `'sk-***xR_x'`
 * - `redactSecret('short')` → `'***'` (too short to safely reveal anything)
 * - `redactSecret('')` → `''`
 *
 * Strings of 8 characters or fewer are fully masked. Longer strings keep up
 * to 3 chars at the start and 4 chars at the end visible.
 */
export function redactSecret(s: string): string {
  if (typeof s !== 'string' || s.length === 0) return '';
  if (s.length <= 8) return '***';
  const prefix = s.slice(0, 3);
  const suffix = s.slice(-4);
  return `${prefix}***${suffix}`;
}

/**
 * Truncates a string to at most `max` characters, appending a marker that
 * records how many additional characters were dropped. Intended for logging
 * LLM responses or other unbounded text without flooding the log.
 *
 * Examples:
 * - `truncate('hello', 200)` → `'hello'`
 * - `truncate('x'.repeat(250), 200)` → `'xxx...xxx…[+50 more]'` (200 chars + suffix)
 *
 * Non-string input is coerced via `String(...)`. `max` is clamped to be at
 * least 1.
 */
export function truncate(s: string, max = 200): string {
  const str = typeof s === 'string' ? s : String(s);
  const limit = Math.max(1, Math.floor(max));
  if (str.length <= limit) return str;
  const dropped = str.length - limit;
  return `${str.slice(0, limit)}…[+${dropped} more]`;
}

/**
 * Common structured-log fields that show up across DyoBot subsystems. Adding
 * a typed wrapper around `logger.child(...)` keeps key names consistent
 * across call-sites (so dashboards / log filters can rely on stable fields).
 *
 * Unknown extra fields are allowed — anything passed beyond the typed keys
 * is forwarded to pino as-is.
 */
export interface LogContext {
  botName?: string;
  taskId?: string;
  missionId?: string;
  squadId?: string;
  buildId?: string;
  chainId?: string;
  playerName?: string;
  [extra: string]: unknown;
}

/**
 * Returns a child logger pre-loaded with the given structured context.
 *
 * Example:
 * ```ts
 * const log = withContext({ botName: 'Alice', taskId: 't-42' });
 * log.info('starting task'); // includes botName + taskId in the JSON output
 * ```
 *
 * The returned value is a normal pino `Logger`, so all standard methods
 * (`debug`, `info`, `warn`, `error`, `fatal`, `child`, `level`, ...) work
 * unchanged.
 */
export function withContext(ctx: LogContext): Logger {
  return logger.child(ctx ?? {});
}
