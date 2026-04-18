import fs from 'fs';
import path from 'path';

/**
 * Write JSON data to a file atomically by first writing to a .tmp file
 * then renaming. This prevents partial/corrupt writes on crash.
 *
 * Use this when you need the write to complete before returning (e.g. on shutdown).
 * For debounced periodic saves, prefer {@link atomicWriteJson}.
 */
export function atomicWriteJsonSync(filePath: string, data: any): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
}

/**
 * Async sibling of {@link atomicWriteJsonSync}. Same atomic semantics, but
 * doesn't block the event loop on JSON serialization or disk I/O. Prefer this
 * for periodic/debounced saves; use the sync variant only when shutdown
 * requires the write to flush before exit.
 */
export async function atomicWriteJson(filePath: string, data: any): Promise<void> {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }
  const tmpPath = filePath + '.tmp';
  await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2));
  await fs.promises.rename(tmpPath, filePath);
}
